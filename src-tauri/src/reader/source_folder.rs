//! A folder of images (with chapter subfolders up to `MAX_DEPTH` deep).

use std::path::{Path, PathBuf};

use super::detect::is_page_name;
use super::error::{CoreError, Result};
use super::{raster, read_limited, sorted_pages, Page, PageData, Source, MAX_ENTRIES};

const MAX_DEPTH: usize = 3;

pub struct FolderSource {
    files: Vec<PathBuf>,
}

pub fn open(root: &Path) -> Result<(Vec<Page>, FolderSource)> {
    let mut found = Vec::new();
    // The root must be readable; unreadable subfolders are skipped.
    let first = std::fs::read_dir(root)?;
    walk(first, "", 0, &mut found)?;
    let mut files = Vec::with_capacity(found.len());
    let mut list = Vec::with_capacity(found.len());
    for (rel, full) in found {
        list.push((rel, files.len()));
        files.push(full);
    }
    Ok((sorted_pages(list), FolderSource { files }))
}

fn walk(dir: std::fs::ReadDir, prefix: &str, depth: usize, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let Ok(ft) = entry.file_type() else { continue };
        let is_dir = ft.is_dir() || (ft.is_symlink() && entry.path().is_dir());
        if is_dir {
            if depth + 1 < MAX_DEPTH && !name.eq_ignore_ascii_case("__MACOSX") {
                if let Ok(sub) = std::fs::read_dir(entry.path()) {
                    walk(sub, &rel, depth + 1, out)?;
                }
            }
        } else if is_page_name(&rel) {
            if out.len() >= MAX_ENTRIES {
                return Err(CoreError::too_large(format!("Too many images in this folder (max {MAX_ENTRIES}).")));
            }
            out.push((rel, entry.path()));
        }
    }
    Ok(())
}

impl Source for FolderSource {
    fn read(&self, entry: usize, _width: Option<u32>) -> Result<PageData> {
        let path = self.files.get(entry).ok_or_else(|| CoreError::corrupt("Unknown page."))?;
        let mut f = std::fs::File::open(path)?;
        let len = f.metadata()?.len();
        raster(read_limited(&mut f, len)?)
    }
}
