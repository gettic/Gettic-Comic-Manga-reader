//! CBZ/ZIP: only the central directory is read at open; each page read decompresses one entry.
//! The archive (parsed index + positional reader) is cloned per read, so reads run in parallel.

use std::path::Path;

use zip::result::ZipError;
use zip::ZipArchive;

use super::detect::is_page_name;
use super::error::{CoreError, Result};
use super::posread::PosReader;
use super::{damaged, raster, read_limited, sorted_pages, Page, PageData, Source, MAX_ENTRIES};

pub struct ZipSource {
    archive: ZipArchive<PosReader>,
}

pub fn open(path: &Path) -> Result<(Vec<Page>, ZipSource)> {
    let archive = ZipArchive::new(PosReader::open(path)?).map_err(zip_err)?;
    if archive.len() > MAX_ENTRIES {
        return Err(CoreError::too_large(format!("Too many files in this archive (max {MAX_ENTRIES}).")));
    }
    let mut list = Vec::new();
    let mut encrypted = 0;
    for i in 0..archive.len() {
        let Ok(e) = archive.by_index_data(i) else { continue };
        if e.is_dir() {
            continue;
        }
        let name = match e.name() {
            Ok(n) => n.into_owned(),
            Err(_) => String::from_utf8_lossy(e.name_raw()).into_owned(),
        };
        let name = name.replace('\\', "/");
        if !is_page_name(&name) {
            continue;
        }
        if e.encrypted() {
            encrypted += 1;
        }
        list.push((name, i));
    }
    if !list.is_empty() && encrypted == list.len() {
        return Err(CoreError::encrypted());
    }
    Ok((sorted_pages(list), ZipSource { archive }))
}

impl Source for ZipSource {
    fn read(&self, entry: usize, _width: Option<u32>) -> Result<PageData> {
        let mut archive = self.archive.clone();
        let mut f = archive.by_index(entry).map_err(zip_err)?;
        let size = f.size();
        raster(read_limited(&mut f, size)?)
    }
}

fn zip_err(e: ZipError) -> CoreError {
    match e {
        ZipError::Io(io) => damaged(io),
        ZipError::UnsupportedArchive(m) if m == ZipError::PASSWORD_REQUIRED => CoreError::encrypted(),
        ZipError::InvalidPassword => CoreError::encrypted(),
        ZipError::UnsupportedArchive(m) => CoreError::unsupported(format!("Unsupported ZIP feature: {m}.")),
        ZipError::CompressionMethodNotSupported(m) => {
            CoreError::unsupported(format!("This ZIP uses a compression method that is not supported (method {m})."))
        }
        ZipError::InvalidArchive(m) => CoreError::corrupt(format!("The ZIP file is damaged ({m}).")),
        other => CoreError::corrupt(format!("The ZIP file could not be read ({other}).")),
    }
}
