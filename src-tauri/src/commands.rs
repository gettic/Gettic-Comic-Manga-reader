//! Tauri commands: thin wrappers over `reader::session::Session`. Contract: `COMMANDS.md`.
//! Work that touches files runs on a blocking thread, never on the UI thread.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::reader::error::{CoreError, ErrorCode, Result};
use crate::reader::session::{ComicInfo, Session};
use crate::reader::store::RecentComic;

pub struct AppState {
    pub session: Arc<Session>,
    pub startup_path: Mutex<Option<String>>,
}

/// The path given on the command line ("Open with"): the first argument that isn't a
/// `--flag`, made absolute against `cwd` (or the current folder).
pub fn startup_path_from_args<I, S>(args: I, cwd: Option<&Path>) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let arg = args.into_iter().find(|a| {
        let a = a.as_ref();
        !a.is_empty() && !a.starts_with("--")
    })?;
    let p = PathBuf::from(arg.as_ref());
    let abs = match cwd {
        Some(c) if p.is_relative() => c.join(p),
        _ => std::path::absolute(&p).unwrap_or(p),
    };
    Some(abs.to_string_lossy().into_owned())
}

async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CoreError::new(ErrorCode::Io, format!("Background task failed: {e}")))?
}

const COMIC_EXTS: &[&str] = &["cbz", "zip", "cbr", "rar", "cb7", "7z", "pdf"];
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"];

#[tauri::command]
pub async fn pick_comic(app: AppHandle, kind: String) -> Result<Option<String>> {
    blocking(move || {
        let mut d = app.dialog().file();
        if let Some(w) = app.get_webview_window("main") {
            d = d.set_parent(&w);
        }
        let picked = if kind == "folder" {
            d.set_title("Open a folder of images").blocking_pick_folder()
        } else {
            let all: Vec<&str> = COMIC_EXTS.iter().chain(IMAGE_EXTS).copied().collect();
            d.set_title("Open a comic")
                .add_filter("Comics and images", &all)
                .add_filter("All files", &["*"])
                .blocking_pick_file()
        };
        Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn open_comic(state: State<'_, AppState>, path: String) -> Result<ComicInfo> {
    let s = state.session.clone();
    blocking(move || s.open(Path::new(&path))).await
}

#[tauri::command]
pub async fn close_comic(state: State<'_, AppState>, id: String) -> Result<()> {
    let s = state.session.clone();
    blocking(move || s.close(&id)).await
}

#[tauri::command]
pub fn set_progress(state: State<'_, AppState>, id: String, page: usize) -> Result<()> {
    state.session.set_progress(&id, page)
}

#[tauri::command]
pub fn set_comic_view(state: State<'_, AppState>, id: String, view: Value) -> Result<()> {
    state.session.set_view(&id, view)
}

#[tauri::command]
pub fn recent_comics(state: State<'_, AppState>, limit: Option<usize>) -> Vec<RecentComic> {
    state.session.recent(limit.unwrap_or(5))
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Option<Value>> {
    let s = state.session.clone();
    blocking(move || Ok(s.store.get_settings())).await
}

#[tauri::command]
pub async fn set_settings(state: State<'_, AppState>, settings: Value) -> Result<()> {
    let s = state.session.clone();
    blocking(move || s.store.set_settings(&settings)).await
}

#[tauri::command]
pub fn take_startup_path(state: State<'_, AppState>) -> Option<String> {
    state.startup_path.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_path_skips_flags() {
        let cwd = std::env::temp_dir();
        assert_eq!(startup_path_from_args(["--x", "a.cbz"], Some(&cwd)), Some(cwd.join("a.cbz").to_string_lossy().into_owned()));
        assert_eq!(startup_path_from_args(Vec::<String>::new(), None), None);
        assert_eq!(startup_path_from_args(["--only-flags"], None), None);
    }
}
