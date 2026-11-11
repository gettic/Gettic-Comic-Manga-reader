//! Open comics, the page cache and the data store behind one object. This is what the Tauri
//! commands and the page protocol call; it has no Tauri types, so other front ends can use it.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

use super::cache::PageCache;
use super::error::{CoreError, ErrorCode, Result};
use super::store::{RecentComic, Store};
use super::{source_pdf, Comic, PageData};

/// Shared page cache size (all open comics).
pub const CACHE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub index: usize,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComicInfo {
    pub id: String,
    pub path: String,
    pub title: String,
    pub kind: &'static str,
    pub pages: Vec<PageInfo>,
    pub url_base: String,
    pub last_page: usize,
    pub is_rendered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<Value>,
}

struct Open {
    comic: Comic,
    key: String,
}

pub struct Session {
    comics: Mutex<HashMap<u64, Arc<Open>>>,
    next_id: AtomicU64,
    pub cache: PageCache,
    pub store: Store,
    /// Prefix of page URLs, e.g. "http://comic.localhost/" (id and index are appended).
    url_root: String,
}

pub fn format_id(id: u64) -> String {
    format!("c{id}")
}

pub fn parse_id(s: &str) -> Option<u64> {
    s.strip_prefix('c')?.parse().ok()
}

impl Session {
    pub fn new(data_dir: &Path, url_root: &str) -> Session {
        Session {
            comics: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            cache: PageCache::new(CACHE_BYTES),
            store: Store::open(data_dir),
            url_root: url_root.to_string(),
        }
    }

    fn get(&self, id: &str) -> Result<(u64, Arc<Open>)> {
        let n = parse_id(id).ok_or_else(CoreError::unknown_comic)?;
        let g = self.comics.lock().unwrap_or_else(|e| e.into_inner());
        g.get(&n).cloned().map(|o| (n, o)).ok_or_else(CoreError::unknown_comic)
    }

    pub fn open(&self, path: &Path) -> Result<ComicInfo> {
        let comic = Comic::open(path)?;
        let key = comic.path.to_string_lossy().into_owned();
        let saved = self.store.get(&key);
        let count = comic.pages.len();
        let last_page = comic
            .start_page
            .or(saved.as_ref().map(|e| e.page))
            .unwrap_or(0)
            .min(count - 1);
        // Opening counts as reading: it moves the comic to the top of the recent list.
        self.store.set_progress(&key, &comic.title, last_page, count);

        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let info = ComicInfo {
            id: format_id(id),
            path: key.clone(),
            title: comic.title.clone(),
            kind: comic.kind.as_str(),
            pages: comic
                .pages
                .iter()
                .enumerate()
                .map(|(index, p)| PageInfo { index, name: p.name.clone(), width: p.width, height: p.height })
                .collect(),
            url_base: format!("{}{}/", self.url_root, format_id(id)),
            last_page,
            is_rendered: comic.is_rendered,
            view: saved.and_then(|e| e.view),
        };
        self.comics.lock().unwrap_or_else(|e| e.into_inner()).insert(id, Arc::new(Open { comic, key }));
        Ok(info)
    }

    /// Closes a comic (unknown ids are ignored) and saves progress.
    pub fn close(&self, id: &str) -> Result<()> {
        if let Some(n) = parse_id(id) {
            self.comics.lock().unwrap_or_else(|e| e.into_inner()).remove(&n);
            self.cache.remove_comic(n);
        }
        self.store.flush()
    }

    pub fn set_progress(&self, id: &str, page: usize) -> Result<()> {
        let (_, o) = self.get(id)?;
        let count = o.comic.pages.len();
        self.store.set_progress(&o.key, &o.comic.title, page.min(count - 1), count);
        Ok(())
    }

    pub fn set_view(&self, id: &str, view: Value) -> Result<()> {
        let (_, o) = self.get(id)?;
        self.store.set_view(&o.key, &o.comic.title, o.comic.pages.len(), view)
    }

    pub fn recent(&self, limit: usize) -> Vec<RecentComic> {
        self.store.recent(limit.min(100))
    }

    /// One page, from the cache or read now. `width` only matters for rendered (PDF) pages.
    pub fn page(&self, id: u64, index: usize, width: Option<u32>) -> Result<Arc<PageData>> {
        let o = {
            let g = self.comics.lock().unwrap_or_else(|e| e.into_inner());
            g.get(&id).cloned().ok_or_else(CoreError::unknown_comic)?
        };
        if index >= o.comic.pages.len() {
            return Err(CoreError::new(ErrorCode::NotFound, format!("No page {index}.")));
        }
        let width = o.comic.is_rendered.then(|| source_pdf::clamp_width(width));
        let key = (id, index, width.unwrap_or(0));
        if let Some(p) = self.cache.get(key) {
            return Ok(p);
        }
        let data = Arc::new(o.comic.read_page(index, width)?);
        let still_open = self.comics.lock().unwrap_or_else(|e| e.into_inner()).contains_key(&id);
        if still_open {
            self.cache.put(key, data.clone());
        }
        Ok(data)
    }
}
