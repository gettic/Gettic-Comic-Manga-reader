//! Byte-bounded LRU cache of page data, shared by all open comics.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// (comic id, page index, render width or 0)
pub type Key = (u64, usize, u32);

pub struct PageCache {
    limit: usize,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    map: HashMap<Key, (Arc<PageData>, u64)>,
    bytes: usize,
    tick: u64,
}

/// One page, ready to send: encoded image bytes and their MIME type.
#[derive(Debug)]
pub struct PageData {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

impl PageCache {
    pub fn new(limit_bytes: usize) -> Self {
        PageCache { limit: limit_bytes, inner: Mutex::new(Inner::default()) }
    }

    pub fn get(&self, key: Key) -> Option<Arc<PageData>> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.tick += 1;
        let tick = g.tick;
        let entry = g.map.get_mut(&key)?;
        entry.1 = tick;
        Some(entry.0.clone())
    }

    pub fn put(&self, key: Key, data: Arc<PageData>) {
        let size = data.bytes.len();
        if size > self.limit / 4 {
            return; // one huge page must not flush everything else
        }
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.tick += 1;
        let tick = g.tick;
        if let Some((old, _)) = g.map.insert(key, (data, tick)) {
            g.bytes -= old.bytes.len();
        }
        g.bytes += size;
        while g.bytes > self.limit {
            let Some(oldest) = g.map.iter().min_by_key(|(_, (_, t))| *t).map(|(k, _)| *k) else { break };
            if let Some((d, _)) = g.map.remove(&oldest) {
                g.bytes -= d.bytes.len();
            }
        }
    }

    /// Drops all pages of one comic.
    pub fn remove_comic(&self, id: u64) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut freed = 0;
        g.map.retain(|k, (d, _)| {
            let keep = k.0 != id;
            if !keep {
                freed += d.bytes.len();
            }
            keep
        });
        g.bytes -= freed;
    }

    pub fn used_bytes(&self) -> usize {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(n: usize) -> Arc<PageData> {
        Arc::new(PageData { bytes: vec![0; n], mime: "image/png" })
    }

    #[test]
    fn stays_under_limit_and_evicts_oldest() {
        let c = PageCache::new(1000);
        c.put((1, 0, 0), page(200));
        c.put((1, 1, 0), page(200));
        c.put((1, 2, 0), page(200));
        c.put((1, 3, 0), page(200));
        assert!(c.get((1, 0, 0)).is_some()); // touch 0, so 1 is the oldest
        c.put((1, 4, 0), page(250));
        c.put((1, 5, 0), page(200));
        assert!(c.used_bytes() <= 1000);
        assert!(c.get((1, 1, 0)).is_none());
        assert!(c.get((1, 0, 0)).is_some());
        assert!(c.get((1, 5, 0)).is_some());
    }

    #[test]
    fn huge_pages_are_not_cached_and_remove_comic_frees() {
        let c = PageCache::new(1000);
        c.put((1, 0, 0), page(600));
        assert!(c.get((1, 0, 0)).is_none());
        c.put((1, 1, 0), page(100));
        c.put((2, 1, 0), page(100));
        c.remove_comic(1);
        assert_eq!(c.used_bytes(), 100);
        assert!(c.get((2, 1, 0)).is_some());
    }
}
