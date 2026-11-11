//! CBR/RAR via the unRAR library (cargo feature `rar`). unRAR reads sequentially: headers are
//! listed at open; a page read walks the headers (skipping data) to the entry. In solid
//! archives skipping still decodes, so the pages after the asked one are kept (bounded).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use unrar::error::{Code, UnrarError};
use unrar::Archive;

use super::detect::is_page_name;
use super::error::{CoreError, ErrorCode, Result};
use super::{raster, sorted_pages, too_large_page, AheadBuffer, Page, PageData, ReadAhead, Source, MAX_ENTRIES, MAX_PAGE_BYTES};

pub struct RarSource {
    path: PathBuf,
    solid: bool,
    pages: HashSet<usize>,
    ahead: ReadAhead,
}

/// One header from the listing: (index in archive order, name, encrypted, unpacked size).
pub(super) type Listed = (usize, String, bool, u64);

/// Lists the file headers; returns (is solid, entries).
pub(super) fn list(path: &Path) -> Result<(bool, Vec<Listed>)> {
    let listing = Archive::new(path).open_for_listing().map_err(rar_err)?;
    if listing.has_encrypted_headers() {
        return Err(CoreError::encrypted());
    }
    let solid = listing.is_solid();
    let mut out = Vec::new();
    for (i, h) in listing.enumerate() {
        let h = h.map_err(rar_err)?;
        if i >= MAX_ENTRIES {
            return Err(CoreError::too_large(format!("Too many files in this archive (max {MAX_ENTRIES}).")));
        }
        if h.is_directory() {
            continue;
        }
        let name = h.filename.to_string_lossy().replace('\\', "/");
        out.push((i, name, h.is_encrypted(), h.unpacked_size));
    }
    Ok((solid, out))
}

pub fn open(path: &Path) -> Result<(Vec<Page>, RarSource)> {
    let (solid, entries) = list(path)?;
    let mut list = Vec::new();
    let mut encrypted = 0;
    for (i, name, enc, _) in entries {
        if !is_page_name(&name) {
            continue;
        }
        if enc {
            encrypted += 1;
        }
        list.push((name, i));
    }
    if !list.is_empty() && encrypted == list.len() {
        return Err(CoreError::encrypted());
    }
    let pages = list.iter().map(|(_, i)| *i).collect();
    let src = RarSource { path: path.to_path_buf(), solid, pages, ahead: ReadAhead::default() };
    Ok((sorted_pages(list), src))
}

impl RarSource {
    /// Test helper: every file entry counts as a page (the fixture archives hold no images).
    #[cfg(test)]
    pub(super) fn all_entries(path: &Path) -> Result<RarSource> {
        let (solid, entries) = list(path)?;
        let pages = entries.iter().map(|e| e.0).collect();
        Ok(RarSource { path: path.to_path_buf(), solid, pages, ahead: ReadAhead::default() })
    }

    #[cfg(test)]
    pub(super) fn is_solid(&self) -> bool {
        self.solid
    }

    /// Raw bytes of entry `entry` (archive order).
    pub(super) fn read_raw(&self, entry: usize) -> Result<Vec<u8>> {
        if let Some(d) = self.ahead.take(entry) {
            return Ok(d);
        }
        let _decoding = self.ahead.lock_decode();
        if let Some(d) = self.ahead.take(entry) {
            return Ok(d);
        }
        let mut cur = Archive::new(&self.path).open_for_processing().map_err(rar_err)?;
        let mut result = None;
        let mut ahead = AheadBuffer::new();
        let mut i = 0usize;
        while let Some(h) = cur.read_header().map_err(rar_err)? {
            let size = h.entry().unpacked_size;
            let is_dir = h.entry().is_directory();
            if i < entry || is_dir {
                cur = h.skip().map_err(rar_err)?;
            } else if i == entry {
                if size > MAX_PAGE_BYTES {
                    return Err(too_large_page(size));
                }
                let (data, next) = h.read().map_err(rar_err)?;
                result = Some(data);
                if !self.solid {
                    break;
                }
                cur = next;
            } else {
                if ahead.full() {
                    break;
                }
                if self.pages.contains(&i) && size <= MAX_PAGE_BYTES {
                    match h.read() {
                        Ok((data, next)) => {
                            ahead.push(i, data);
                            cur = next;
                        }
                        Err(_) => break, // damaged later entry: keep what we have
                    }
                } else {
                    cur = h.skip().map_err(rar_err)?;
                }
            }
            i += 1;
        }
        self.ahead.replace(ahead.items);
        result.ok_or_else(|| CoreError::corrupt("This page was not found in the RAR file."))
    }
}

impl Source for RarSource {
    fn read(&self, entry: usize, _width: Option<u32>) -> Result<PageData> {
        raster(self.read_raw(entry)?)
    }
}

fn rar_err(e: UnrarError) -> CoreError {
    match e.code {
        Code::MissingPassword | Code::BadPassword => CoreError::encrypted(),
        Code::NoMemory => CoreError::too_large("Not enough memory to unpack this RAR file."),
        Code::EOpen | Code::ERead => CoreError::new(ErrorCode::Io, "The RAR file could not be read."),
        Code::UnknownFormat => CoreError::unsupported("This RAR format version is not supported."),
        _ => CoreError::corrupt(format!("The RAR file is damaged ({e}).")),
    }
}
