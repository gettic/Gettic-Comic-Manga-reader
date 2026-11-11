//! `--smoke-test`: start without showing a window, open a generated tiny test comic,
//! check the web page loads, clean up and exit. Exit codes: 0 ok, 1 error, 2 timeout.
//!
//! Usage: `--smoke-test [data-dir]` (temp data under data-dir, default `smoke-data` next to the exe).
//! The parent (`--smoke-test`) starts the same exe as a child (`--smoke-test-child <dir>`)
//! that does the work, then deletes the temp folder once the child and its WebView2
//! processes have released it (WebView2 keeps its data folder locked until the app exits).
//!
//! For now the "comic" is a folder of two 1x1 PNG pages, read back and checked.
//! Later (reader-core): generate a tiny .cbz and open/decode it through reader-core;
//! (panels): run panel detection on one page.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::{Duration, Instant};

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// Whole smoke test, including cleanup.
const TIMEOUT: Duration = Duration::from_secs(30);
/// The child gets a bit less, so cleanup still fits in the 30 s.
const CHILD_TIMEOUT: Duration = Duration::from_secs(25);

/// Smallest valid PNG: 1x1 pixel, greyscale.
const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B,
    0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x60, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x01, 0x48, 0xAF, 0xA4, 0x71, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];
const PNG_SIGNATURE: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

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
    check_test_comic(&comic)?;

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

/// Writes a tiny two-page "comic" folder. Placeholder until reader-core can build a .cbz.
fn make_test_comic(root: &Path) -> std::io::Result<PathBuf> {
    let comic = root.join("comic");
    std::fs::create_dir_all(&comic)?;
    for name in ["001.png", "002.png"] {
        std::fs::write(comic.join(name), TINY_PNG)?;
    }
    Ok(comic)
}

fn check_test_comic(comic: &Path) -> Result<(), String> {
    let mut pages: Vec<_> = std::fs::read_dir(comic)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    pages.sort();
    if pages.len() != 2 {
        return Err(format!("expected 2 pages, found {}", pages.len()));
    }
    for p in &pages {
        let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
        if !bytes.starts_with(PNG_SIGNATURE) {
            return Err(format!("{} is not a PNG", p.display()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comic_is_written_and_valid() {
        let root = std::env::temp_dir().join(format!("gcmr-unittest-{}", std::process::id()));
        let comic = make_test_comic(&root).unwrap();
        assert!(check_test_comic(&comic).is_ok());
        std::fs::remove_dir_all(&root).unwrap();
    }
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
