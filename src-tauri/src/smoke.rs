//! `--smoke-test`: start without showing a window, open a generated tiny test comic,
//! check the web page loads, clean up and exit. Exit codes: 0 ok, 1 error, 2 timeout.
//!
//! Usage: `--smoke-test [data-dir]` (temp data under data-dir, default `smoke-data` next to the exe).
//! The parent (`--smoke-test`) starts the same exe as a child (`--smoke-test-child <dir>`)
//! that does the work, then deletes the temp folder once the child and its WebView2
//! processes have released it (WebView2 keeps its data folder locked until the app exits).
//!
//! The comic is a generated 3-page .cbz, opened and served through the reader core.
//! Later (panels): run panel detection on one page.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::protocol::Reply;
use crate::reader::session::Session;
use crate::reader::testdata::{page_png, write_zip};

/// Whole smoke test, including cleanup.
const TIMEOUT: Duration = Duration::from_secs(30);
/// The child gets a bit less, so cleanup still fits in the 30 s.
const CHILD_TIMEOUT: Duration = Duration::from_secs(25);

static EXIT_CODE: AtomicI32 = AtomicI32::new(1);

/// Parent: `--smoke-test [data-dir]`. Temp data goes under `data-dir`
/// (default: a `smoke-data` folder next to the exe), never into %TEMP%.
pub fn run(data_dir: Option<PathBuf>) {
    let start = Instant::now();
    let base = match data_dir.or_else(default_data_dir) {
        Some(d) => d,
        None => {
            eprintln!("smoke test: no folder for test data");
            std::process::exit(1);
        }
    };
    let base = std::path::absolute(&base).unwrap_or(base);
    let root = base.join(format!("gcmr-smoke-{}", std::process::id()));
    let code = match run_child(&root, start) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("smoke test failed: {e}");
            1
        }
    };
    if !cleanup(&root, start) && code == 0 {
        eprintln!("smoke test: could not delete {}", root.display());
        std::process::exit(1);
    }
    std::process::exit(code);
}

fn default_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("smoke-data"))
}

fn run_child(root: &Path, start: Instant) -> std::io::Result<i32> {
    let mut child = Command::new(std::env::current_exe()?)
        .arg("--smoke-test-child")
        .arg(root)
        .spawn()?;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status.code().unwrap_or(1));
        }
        if start.elapsed() > CHILD_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("smoke test: timed out after {}s", CHILD_TIMEOUT.as_secs());
            return Ok(2);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Child: `--smoke-test-child <dir>`.
pub fn run_as_child(root: &Path) {
    if !root.is_absolute() {
        eprintln!("smoke test: child needs an absolute temp folder");
        std::process::exit(1);
    }
    let code = match run_inner(root) {
        Ok(()) => EXIT_CODE.load(Ordering::SeqCst),
        Err(e) => {
            eprintln!("smoke test failed: {e}");
            1
        }
    };
    std::process::exit(code);
}

fn run_inner(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let comic = make_test_comic(root)?;
    check_test_comic(root, &comic)?;

    let webview_data: PathBuf = root.join("webview");
    let app = tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("smoke test")
                .visible(false)
                .skip_taskbar(true)
                .focused(false)
                .data_directory(webview_data.clone())
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        EXIT_CODE.store(0, Ordering::SeqCst);
                        window.app_handle().exit(0);
                    }
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run_return(|_, _| {});
    Ok(())
}

/// Writes a tiny three-page .cbz (pages named so natural sort matters).
fn make_test_comic(root: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(root)?;
    let comic = root.join("smoke.cbz");
    write_zip(&comic, &[("p10.png", page_png(10)), ("p2.png", page_png(2)), ("p1.png", page_png(1))])?;
    Ok(comic)
}

/// Opens the comic through the reader core and serves every page through the page protocol
/// code, with the data store in `<root>/data` (never the real data folder).
fn check_test_comic(root: &Path, comic: &Path) -> Result<(), String> {
    let session = Session::new(&root.join("data"), crate::protocol::URL_ROOT);
    let info = session.open(comic).map_err(|e| e.to_string())?;
    let names: Vec<&str> = info.pages.iter().map(|p| p.name.as_str()).collect();
    if names != ["p1.png", "p2.png", "p10.png"] {
        return Err(format!("wrong page order: {names:?}"));
    }
    let id = info.id.trim_start_matches('c');
    for i in 0..info.pages.len() {
        match crate::protocol::serve(&session, &format!("/c{id}/{i}"), None) {
            Reply::Page(p) if p.mime == "image/png" => {}
            Reply::Page(p) => return Err(format!("page {i}: unexpected type {}", p.mime)),
            Reply::Error { message, .. } => return Err(format!("page {i}: {message}")),
        }
    }
    session.set_progress(&info.id, 1).map_err(|e| e.to_string())?;
    session.close(&info.id).map_err(|e| e.to_string())?;
    Ok(())
}

/// WebView2's helper processes may hold the data folder for a moment after the child exits,
/// so retry until the overall 30 s budget is used up.
fn cleanup(root: &Path, start: Instant) -> bool {
    loop {
        if !root.exists() || std::fs::remove_dir_all(root).is_ok() {
            return true;
        }
        if start.elapsed() > TIMEOUT {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comic_is_written_and_valid() {
        let root = std::env::temp_dir().join(format!("gcmr-unittest-{}", std::process::id()));
        let comic = make_test_comic(&root).unwrap();
        check_test_comic(&root, &comic).unwrap();
        assert!(root.join("data").join("progress.json").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
