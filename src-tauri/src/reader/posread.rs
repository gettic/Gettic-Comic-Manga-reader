//! A cloneable `Read + Seek` over a shared read-only file handle, using positional reads,
//! so several threads can read pages of the same archive at once without locks.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

#[derive(Clone, Debug)]
pub struct PosReader {
    file: Arc<File>,
    pos: u64,
    len: u64,
}

impl PosReader {
    /// Opens `path` read-only.
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Ok(PosReader { file: Arc::new(file), pos: 0, len })
    }
}

#[cfg(unix)]
fn read_at(f: &File, buf: &mut [u8], pos: u64) -> io::Result<usize> {
    std::os::unix::fs::FileExt::read_at(f, buf, pos)
}

#[cfg(windows)]
fn read_at(f: &File, buf: &mut [u8], pos: u64) -> io::Result<usize> {
    // seek_read moves the OS file cursor, but nothing here relies on it.
    std::os::windows::fs::FileExt::seek_read(f, buf, pos)
}

impl Read for PosReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let max = ((self.len - self.pos).min(buf.len() as u64)) as usize;
        let n = read_at(&self.file, &mut buf[..max], self.pos)?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for PosReader {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let new = match to {
            SeekFrom::Start(p) => Some(p),
            SeekFrom::End(d) => self.len.checked_add_signed(d),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d),
        };
        match new {
            Some(p) => {
                self.pos = p;
                Ok(p)
            }
            None => Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start of file")),
        }
    }
}
