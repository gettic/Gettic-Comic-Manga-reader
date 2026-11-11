//! Reader core: opens comics (CBZ/ZIP, CB7/7z, CBR/RAR, PDF, image folders) read-only and
//! reads single pages on demand. Plain Rust, no Tauri, so a web/CLI front end can reuse it.

pub mod cache;
pub mod detect;
pub mod error;
pub mod natsort;
pub mod session;
pub mod store;
pub mod testdata;

mod posread;
mod source_7z;
mod source_folder;
pub mod source_pdf;
#[cfg(feature = "rar")]
pub(crate) mod source_rar;
mod source_zip;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub use cache::PageData;
pub use detect::Kind;
use detect::Detected;
pub use error::{CoreError, ErrorCode, Result};

/// Largest single page (declared or actual size) that is read.
pub const MAX_PAGE_BYTES: u64 = 256 * 1024 * 1024;
/// Archives with more entries are refused.
pub const MAX_ENTRIES: usize = 50_000;
/// Solid archives: how much is decoded ahead of the asked page and kept for the next requests.
const READ_AHEAD_BYTES: usize = 64 * 1024 * 1024;
const READ_AHEAD_PAGES: usize = 24;

/// One page in reading order.
#[derive(Debug, Clone)]
pub struct Page {
    /// Path inside the archive/folder (`/` separators), or "Page n" for PDF.
    pub name: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Index understood by the source (archive entry index, file index, PDF page).
    entry: usize,
}

/// A format backend. `read` gets the source's own entry index.
trait Source: Send + Sync {
    fn read(&self, entry: usize, width: Option<u32>) -> Result<PageData>;
}

pub struct Comic {
    /// Absolute path of what was opened (for a single image: its folder).
    pub path: PathBuf,
    pub title: String,
    pub kind: Kind,
    pub pages: Vec<Page>,
    /// When a single image was opened: its page index.
    pub start_page: Option<usize>,
    /// PDF: pages are rendered at a requested width.
    pub is_rendered: bool,
    source: Box<dyn Source>,
}

impl std::fmt::Debug for Comic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Comic")
            .field("path", &self.path)
            .field("kind", &self.kind)
            .field("pages", &self.pages.len())
            .finish()
    }
}

impl Comic {
    /// Opens a comic file or folder, or a single image (opens its folder at that image).
    /// Only the index is read; pages are read later with `read_page`.
    pub fn open(path: &Path) -> Result<Comic> {
        guard(|| Self::open_inner(path))
    }

    fn open_inner(path: &Path) -> Result<Comic> {
        let path = std::path::absolute(path)?;
        match detect::detect(&path)? {
            Detected::Comic(Kind::Folder) => {
                let (pages, src) = source_folder::open(&path)?;
                Comic::build(path.clone(), title_of(&path, true), Kind::Folder, pages, Box::new(src))
            }
            Detected::Image => {
                let dir = path.parent().map(Path::to_path_buf).ok_or_else(|| CoreError::unsupported("Image has no folder."))?;
                let (pages, src) = source_folder::open(&dir)?;
                let mut c = Comic::build(dir.clone(), title_of(&dir, true), Kind::Folder, pages, Box::new(src))?;
                let want = path.file_name().map(|n| n.to_string_lossy().into_owned());
                c.start_page = c.pages.iter().position(|p| Some(p.name.as_str()) == want.as_deref());
                Ok(c)
            }
            Detected::Comic(Kind::Zip) => {
                let (pages, src) = source_zip::open(&path)?;
                Comic::build(path.clone(), title_of(&path, false), Kind::Zip, pages, Box::new(src))
            }
            Detected::Comic(Kind::SevenZ) => {
                let (pages, src) = source_7z::open(&path)?;
                Comic::build(path.clone(), title_of(&path, false), Kind::SevenZ, pages, Box::new(src))
            }
            Detected::Comic(Kind::Rar) => open_rar(&path),
            Detected::Comic(Kind::Pdf) => {
                let (pages, src) = source_pdf::open(&path)?;
                let mut c = Comic::build(path.clone(), title_of(&path, false), Kind::Pdf, pages, Box::new(src))?;
                c.is_rendered = true;
                Ok(c)
            }
            Detected::Unknown => Err(CoreError::unsupported(
                "Not a supported comic: use CBZ/ZIP, CBR/RAR, CB7/7z, PDF, an image or a folder of images.",
            )),
        }
    }

    fn build(path: PathBuf, title: String, kind: Kind, pages: Vec<Page>, source: Box<dyn Source>) -> Result<Comic> {
        if pages.is_empty() {
            return Err(CoreError::no_pages());
        }
        Ok(Comic { path, title, kind, pages, start_page: None, is_rendered: false, source })
    }

    /// Reads one page. `width` is only used by rendered formats (PDF).
    pub fn read_page(&self, index: usize, width: Option<u32>) -> Result<PageData> {
        let page = self
            .pages
            .get(index)
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, format!("No page {index}.")))?;
        guard(|| self.source.read(page.entry, width))
    }
}

#[cfg(feature = "rar")]
fn open_rar(path: &Path) -> Result<Comic> {
    let (pages, src) = source_rar::open(path)?;
    Comic::build(path.to_path_buf(), title_of(path, false), Kind::Rar, pages, Box::new(src))
}

#[cfg(not(feature = "rar"))]
fn open_rar(_path: &Path) -> Result<Comic> {
    Err(CoreError::unsupported("RAR/CBR support is not included in this build."))
}

/// Turns a library panic (a bug on an odd file) into an error instead of a crash,
/// where the build allows unwinding.
fn guard<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    catch_unwind(AssertUnwindSafe(f))
        .unwrap_or_else(|_| Err(CoreError::corrupt("This file could not be read (the decoder failed).")))
}

fn title_of(path: &Path, is_dir: bool) -> String {
    let name = if is_dir { path.file_name() } else { path.file_stem() };
    name.map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Natural-sorts `(name, entry)` pairs into pages (names must already be filtered).
fn sorted_pages(mut list: Vec<(String, usize)>) -> Vec<Page> {
    list.sort_by(|a, b| natsort::compare(&a.0, &b.0).then(a.1.cmp(&b.1)));
    list.into_iter()
        .map(|(name, entry)| Page { name, width: None, height: None, entry })
        .collect()
}

/// Wraps raw bytes as a page if they are an image WebView2 can show.
fn raster(bytes: Vec<u8>) -> Result<PageData> {
    match detect::image_mime(&bytes) {
        Some(mime) => Ok(PageData { bytes, mime }),
        None => Err(CoreError::unsupported("This page is not a supported image.")),
    }
}

/// Reads at most `MAX_PAGE_BYTES` (+1 to notice more) from `r`, so a lying size header
/// (zip bomb) can't make it allocate more.
fn read_limited(r: &mut dyn std::io::Read, declared: u64) -> Result<Vec<u8>> {
    use std::io::Read;
    if declared > MAX_PAGE_BYTES {
        return Err(too_large_page(declared));
    }
    let mut v = Vec::with_capacity(declared.min(64 * 1024 * 1024) as usize);
    r.take(MAX_PAGE_BYTES + 1).read_to_end(&mut v).map_err(damaged)?;
    if v.len() as u64 > MAX_PAGE_BYTES {
        return Err(too_large_page(v.len() as u64));
    }
    Ok(v)
}

/// Read errors inside an archive entry mean damaged data, except real I/O trouble.
fn damaged(e: std::io::Error) -> CoreError {
    match e.kind() {
        std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::Other => {
            CoreError::corrupt(format!("This page is damaged ({e})."))
        }
        _ => CoreError::from(e),
    }
}

fn too_large_page(size: u64) -> CoreError {
    CoreError::too_large(format!(
        "This page is too large ({} MB, max {} MB).",
        size / (1024 * 1024),
        MAX_PAGE_BYTES / (1024 * 1024)
    ))
}

/// Pages decoded ahead of the request in solid archives (where each read must decode from
/// the start of a block). Bounded by `READ_AHEAD_BYTES` / `READ_AHEAD_PAGES` per comic.
#[derive(Default)]
struct ReadAhead {
    pages: Mutex<HashMap<usize, Vec<u8>>>,
    /// One decode at a time per comic, so parallel requests reuse each other's work.
    decode: Mutex<()>,
}

impl ReadAhead {
    fn take(&self, entry: usize) -> Option<Vec<u8>> {
        self.pages.lock().unwrap_or_else(|e| e.into_inner()).remove(&entry)
    }

    fn replace(&self, items: Vec<(usize, Vec<u8>)>) {
        let mut g = self.pages.lock().unwrap_or_else(|e| e.into_inner());
        g.clear();
        g.extend(items);
    }

    fn lock_decode(&self) -> std::sync::MutexGuard<'_, ()> {
        self.decode.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Collects pages after the asked one while a solid block is decoded anyway.
struct AheadBuffer {
    items: Vec<(usize, Vec<u8>)>,
    bytes: usize,
}

impl AheadBuffer {
    fn new() -> Self {
        AheadBuffer { items: Vec::new(), bytes: 0 }
    }
    fn full(&self) -> bool {
        self.items.len() >= READ_AHEAD_PAGES || self.bytes >= READ_AHEAD_BYTES
    }
    fn push(&mut self, entry: usize, data: Vec<u8>) {
        self.bytes += data.len();
        self.items.push((entry, data));
    }
}
