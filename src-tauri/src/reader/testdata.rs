//! Tiny generated comics for the unit tests and `--smoke-test` (never the user's files).

use std::io::Write;
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// Smallest valid PNG: 1x1 pixel, greyscale.
pub const TINY_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x3A, 0x7E, 0x9B,
    0x55, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x60, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x01, 0x48, 0xAF, 0xA4, 0x71, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
    0x42, 0x60, 0x82,
];

/// A PNG whose last bytes say which page it is (`TINY_PNG` + "#<n>"), so tests can check order.
pub fn page_png(n: usize) -> Vec<u8> {
    let mut v = TINY_PNG.to_vec();
    v.extend_from_slice(format!("#{n}").as_bytes());
    v
}

/// Writes a ZIP with the given entries (deflated).
pub fn write_zip(path: &Path, entries: &[(&str, Vec<u8>)]) -> std::io::Result<()> {
    write_zip_with(path, entries, CompressionMethod::Deflated)
}

pub fn write_zip_with(path: &Path, entries: &[(&str, Vec<u8>)], method: CompressionMethod) -> std::io::Result<()> {
    let mut z = ZipWriter::new(std::fs::File::create(path)?);
    let opts = SimpleFileOptions::default().compression_method(method);
    for (name, data) in entries {
        z.start_file(*name, opts).map_err(std::io::Error::other)?;
        z.write_all(data)?;
    }
    z.finish().map_err(std::io::Error::other)?;
    Ok(())
}
