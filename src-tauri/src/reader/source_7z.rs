//! CB7/7z: the headers are read at open. Non-solid blocks are decoded per page. In solid
//! blocks every read must decode from the block start, so the pages after the asked one are
//! kept (bounded) for the next requests: reading in order costs about one pass.

use std::collections::HashSet;
use std::path::Path;

use sevenz_rust2::{Archive, BlockDecoder, Error as SzError, Password};

use super::detect::is_page_name;
use super::error::{CoreError, Result};
use super::posread::PosReader;
use super::{
    damaged, raster, read_limited, sorted_pages, AheadBuffer, Page, PageData, ReadAhead, Source, MAX_ENTRIES,
};

pub struct SevenZSource {
    reader: PosReader,
    archive: Archive,
    pages: HashSet<usize>,
    ahead: ReadAhead,
}

pub fn open(path: &Path) -> Result<(Vec<Page>, SevenZSource)> {
    let reader = PosReader::open(path)?;
    let archive = Archive::read(&mut reader.clone(), &Password::empty()).map_err(sz_err)?;
    if archive.files.len() > MAX_ENTRIES {
        return Err(CoreError::too_large(format!("Too many files in this archive (max {MAX_ENTRIES}).")));
    }
    let mut list = Vec::new();
    let mut encrypted = 0;
    for (i, f) in archive.files.iter().enumerate() {
        if f.is_directory() || !f.has_stream || f.is_anti_item {
            continue;
        }
        let name = f.name().replace('\\', "/");
        if !is_page_name(&name) {
            continue;
        }
        if archive.is_file_encrypted(i) {
            encrypted += 1;
        }
        list.push((name, i));
    }
    if !list.is_empty() && encrypted == list.len() {
        return Err(CoreError::encrypted());
    }
    let pages = list.iter().map(|(_, i)| *i).collect();
    Ok((sorted_pages(list), SevenZSource { reader, archive, pages, ahead: ReadAhead::default() }))
}

impl Source for SevenZSource {
    fn read(&self, entry: usize, _width: Option<u32>) -> Result<PageData> {
        if let Some(d) = self.ahead.take(entry) {
            return raster(d);
        }
        let _decoding = self.ahead.lock_decode();
        if let Some(d) = self.ahead.take(entry) {
            return raster(d); // decoded by a parallel request meanwhile
        }
        if entry >= self.archive.files.len() {
            return Err(CoreError::corrupt("Unknown page."));
        }
        if self.archive.is_file_encrypted(entry) {
            return Err(CoreError::encrypted());
        }
        let block = self
            .archive
            .stream_map
            .file_block_index
            .get(entry)
            .copied()
            .flatten()
            .ok_or_else(|| CoreError::corrupt("This page has no data."))?;
        let first = self.archive.stream_map.block_first_file_index.get(block).copied().unwrap_or(0);

        let password = Password::empty();
        let mut src = self.reader.clone();
        let files = &self.archive.files;
        let mut cursor = first;
        let mut result: Option<Result<Vec<u8>>> = None;
        let mut ahead = AheadBuffer::new();
        let decoded = BlockDecoder::new(1, block, &self.archive, &password, &mut src).for_each_entries(&mut |e, r| {
            // Find this entry's index (entries come in archive order from `first`).
            while cursor < files.len() && !std::ptr::eq(&files[cursor], e) {
                cursor += 1;
            }
            let idx = cursor;
            if idx < entry {
                return Ok(true); // the decoder skips data left unread
            }
            if idx == entry {
                result = Some(read_limited(r, e.size));
                return Ok(result.as_ref().is_some_and(|r| r.is_ok()) && self.archive.is_solid);
            }
            if ahead.full() {
                return Ok(false);
            }
            if self.pages.contains(&idx) {
                if let Ok(d) = read_limited(r, e.size) {
                    ahead.push(idx, d);
                }
            }
            Ok(true)
        });
        if let Err(e) = decoded {
            // A damaged block after the asked page doesn't spoil the page itself.
            if !matches!(result, Some(Ok(_))) {
                return Err(sz_err(e));
            }
        }
        self.ahead.replace(ahead.items);
        match result {
            Some(r) => raster(r?),
            None => Err(CoreError::corrupt("This page was not found in its block.")),
        }
    }
}

fn sz_err(e: SzError) -> CoreError {
    match e {
        SzError::PasswordRequired | SzError::MaybeBadPassword(_) => CoreError::encrypted(),
        SzError::UnsupportedCompressionMethod(m) => {
            CoreError::unsupported(format!("This 7z uses a compression method that is not supported ({m})."))
        }
        SzError::Unsupported(m) => CoreError::unsupported(format!("Unsupported 7z feature: {m}.")),
        SzError::ExternalUnsupported => CoreError::unsupported("Unsupported 7z feature (external data)."),
        SzError::UnsupportedVersion { major, minor } => {
            CoreError::unsupported(format!("Unsupported 7z version {major}.{minor}."))
        }
        SzError::MaxMemLimited { .. } => CoreError::too_large("This 7z needs too much memory to decode."),
        SzError::Io(io, _) | SzError::FileOpen(io, _) => damaged(io),
        other => CoreError::corrupt(format!("The 7z file is damaged ({other}).")),
    }
}
