//! Small app data files: `progress.json` (last page + view per comic) and `settings.json`.
//! Written atomically (temp file + rename). Progress writes are debounced: `set_progress`
//! only marks the data dirty; `flush_if_due` (called by a 1 s ticker) and `flush` write it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::{CoreError, Result};

pub const MAX_ENTRIES: usize = 1000;
pub const MAX_VIEW_BYTES: usize = 8 * 1024;
pub const MAX_SETTINGS_BYTES: usize = 64 * 1024;
const DEBOUNCE: Duration = Duration::from_secs(1);

const PROGRESS_FILE: &str = "progress.json";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub page: usize,
    pub page_count: usize,
    pub title: String,
    /// unix ms
    pub updated: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentComic {
    pub path: String,
    pub title: String,
    pub page: usize,
    pub page_count: usize,
    pub updated: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
}

pub struct Store {
    dir: PathBuf,
    inner: Mutex<Inner>,
}

struct Inner {
    progress: HashMap<String, Entry>,
    dirty: bool,
    last_write: Option<Instant>,
}

impl Store {
    /// Loads the files in `dir` (created if missing). A damaged file is renamed to `*.bad`
    /// and starts empty, so a bad write can never stop the app from opening.
    pub fn open(dir: &Path) -> Store {
        let _ = std::fs::create_dir_all(dir);
        let progress = read_json::<HashMap<String, Entry>>(&dir.join(PROGRESS_FILE)).unwrap_or_default();
        Store {
            dir: dir.to_path_buf(),
            inner: Mutex::new(Inner { progress, dirty: false, last_write: None }),
        }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn get(&self, key: &str) -> Option<Entry> {
        self.lock().progress.get(key).cloned()
    }

    pub fn set_progress(&self, key: &str, title: &str, page: usize, page_count: usize) {
        let mut g = self.lock();
        let e = g.progress.entry(key.to_string()).or_default();
        e.page = page;
        e.page_count = page_count;
        e.title = title.to_string();
        e.updated = now_ms();
        g.dirty = true;
        trim(&mut g.progress);
    }

    pub fn set_view(&self, key: &str, title: &str, page_count: usize, view: Value) -> Result<()> {
        let size = serde_json::to_vec(&view).map(|v| v.len()).unwrap_or(usize::MAX);
        if size > MAX_VIEW_BYTES {
            return Err(CoreError::invalid(format!("View settings too large ({size} bytes, max {MAX_VIEW_BYTES}).")));
        }
        let mut g = self.lock();
        let e = g.progress.entry(key.to_string()).or_default();
        e.view = Some(view);
        e.title = title.to_string();
        e.page_count = page_count;
        e.updated = now_ms();
        g.dirty = true;
        trim(&mut g.progress);
        Ok(())
    }

    pub fn recent(&self, limit: usize) -> Vec<RecentComic> {
        let g = self.lock();
        let mut v: Vec<RecentComic> = g
            .progress
            .iter()
            .map(|(path, e)| RecentComic {
                path: path.clone(),
                title: e.title.clone(),
                page: e.page,
                page_count: e.page_count,
                updated: e.updated,
                direction: view_str(&e.view, "direction"),
                layout: view_str(&e.view, "layout"),
            })
            .collect();
        v.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.path.cmp(&b.path)));
        v.truncate(limit);
        v
    }

    /// Writes progress if it changed and the last write is at least 1 s ago.
    pub fn flush_if_due(&self) -> Result<()> {
        let due = {
            let g = self.lock();
            g.dirty && g.last_write.is_none_or(|t| t.elapsed() >= DEBOUNCE)
        };
        if due {
            self.flush()
        } else {
            Ok(())
        }
    }

    /// Writes progress now if it changed.
    pub fn flush(&self) -> Result<()> {
        let mut g = self.lock();
        if !g.dirty {
            return Ok(());
        }
        let json = serde_json::to_vec(&g.progress).map_err(|e| CoreError::invalid(e.to_string()))?;
        write_atomic(&self.dir.join(PROGRESS_FILE), &json)?;
        g.dirty = false;
        g.last_write = Some(Instant::now());
        Ok(())
    }

    pub fn get_settings(&self) -> Option<Value> {
        read_json::<Value>(&self.dir.join(SETTINGS_FILE))
    }

    pub fn set_settings(&self, settings: &Value) -> Result<()> {
        let json = serde_json::to_vec(settings).map_err(|e| CoreError::invalid(e.to_string()))?;
        if json.len() > MAX_SETTINGS_BYTES {
            return Err(CoreError::invalid(format!(
                "Settings too large ({} bytes, max {MAX_SETTINGS_BYTES}).",
                json.len()
            )));
        }
        let _g = self.lock(); // one writer at a time
        write_atomic(&self.dir.join(SETTINGS_FILE), &json)
    }
}

fn view_str(view: &Option<Value>, field: &str) -> Option<String> {
    view.as_ref()?.get(field)?.as_str().map(str::to_string)
}

/// Keeps the newest `MAX_ENTRIES` entries.
fn trim(map: &mut HashMap<String, Entry>) {
    if map.len() <= MAX_ENTRIES {
        return;
    }
    let mut by_age: Vec<(u64, String)> = map.iter().map(|(k, e)| (e.updated, k.clone())).collect();
    by_age.sort();
    let extra = map.len() - MAX_ENTRIES;
    for (_, k) in by_age.into_iter().take(extra) {
        map.remove(&k);
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(v) => Some(v),
        Err(_) => {
            let _ = std::fs::rename(path, path.with_extension("json.bad"));
            None
        }
    }
}

/// Write to `<file>.tmp`, then rename over the file (atomic on NTFS and POSIX).
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// The data folder: `data` next to the exe if writable, else `fallback` (e.g. %APPDATA%\<id>).
pub fn resolve_data_dir(exe_dir: Option<&Path>, fallback: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(d) = exe_dir.map(|d| d.join("data")) {
        if is_writable_dir(&d) {
            return Some(d);
        }
    }
    let f = fallback?;
    let _ = std::fs::create_dir_all(&f);
    Some(f)
}

fn is_writable_dir(d: &Path) -> bool {
    if std::fs::create_dir_all(d).is_err() {
        return false;
    }
    let probe = d.join(".write-test");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gcmr-test-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn progress_round_trip_and_views() {
        let d = temp("rt");
        let s = Store::open(&d);
        s.set_progress("C:/a.cbz", "a", 5, 20);
        s.set_view("C:/a.cbz", "a", 20, json!({"direction": "rtl", "layout": "double", "zoom": 1})).unwrap();
        s.flush().unwrap();
        let s2 = Store::open(&d);
        let e = s2.get("C:/a.cbz").unwrap();
        assert_eq!((e.page, e.page_count, e.title.as_str()), (5, 20, "a"));
        let r = s2.recent(5);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].direction.as_deref(), Some("rtl"));
        assert_eq!(r[0].layout.as_deref(), Some("double"));
        assert!(!d.join("progress.json.tmp").exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn limits_and_bad_files() {
        let d = temp("lim");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("progress.json"), b"{ not json").unwrap();
        let s = Store::open(&d);
        assert!(d.join("progress.json.bad").exists());
        let big = json!({ "x": "y".repeat(MAX_VIEW_BYTES) });
        assert_eq!(s.set_view("k", "t", 1, big).unwrap_err().code, super::super::error::ErrorCode::Invalid);
        for i in 0..MAX_ENTRIES + 5 {
            s.set_progress(&format!("k{i}"), "t", 0, 1);
        }
        assert_eq!(s.recent(usize::MAX).len(), MAX_ENTRIES);
        assert!(s.get_settings().is_none());
        s.set_settings(&json!({"defaults": {"layout": "single"}})).unwrap();
        assert_eq!(s.get_settings().unwrap()["defaults"]["layout"], "single");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn data_dir_prefers_exe_folder() {
        let d = temp("dd");
        let got = resolve_data_dir(Some(&d), None).unwrap();
        assert_eq!(got, d.join("data"));
        assert!(got.is_dir() && !got.join(".write-test").exists());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
