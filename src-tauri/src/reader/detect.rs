//! Format detection from file content (magic bytes), image type sniffing and
//! the rules for which archive/folder entries count as pages.

use std::io::Read;
use std::path::Path;

use super::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Zip,
    SevenZ,
    Rar,
    Pdf,
    Folder,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Zip => "zip",
            Kind::SevenZ => "7z",
            Kind::Rar => "rar",
            Kind::Pdf => "pdf",
            Kind::Folder => "folder",
        }
    }
}

/// What a path on disk is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Detected {
    Comic(Kind),
    /// A single image file: open its folder at this image.
    Image,
    Unknown,
}

/// Looks at the first bytes of `path` (or sees it is a folder).
pub fn detect(path: &Path) -> Result<Detected> {
    let meta = std::fs::metadata(path)?;
    if meta.is_dir() {
        return Ok(Detected::Comic(Kind::Folder));
    }
    let mut head = Vec::with_capacity(1024);
    std::fs::File::open(path)?.take(1024).read_to_end(&mut head)?;
    Ok(detect_bytes(&head))
}

pub fn detect_bytes(head: &[u8]) -> Detected {
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        Detected::Comic(Kind::Zip)
    } else if head.starts_with(b"Rar!\x1a\x07") {
        Detected::Comic(Kind::Rar)
    } else if head.starts_with(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]) {
        Detected::Comic(Kind::SevenZ)
    } else if find(head, b"%PDF-").is_some() {
        Detected::Comic(Kind::Pdf)
    } else if image_mime(head).is_some() {
        Detected::Image
    } else {
        Detected::Unknown
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// MIME type of an image from its first bytes, for the formats WebView2 can show.
pub fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else if b.len() >= 12 && &b[4..8] == b"ftyp" && is_avif_brand(b) {
        Some("image/avif")
    } else if b.starts_with(b"BM") && b.len() >= 26 {
        Some("image/bmp")
    } else {
        None
    }
}

fn is_avif_brand(b: &[u8]) -> bool {
    let box_len = u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize;
    let end = box_len.clamp(12, 64).min(b.len());
    b[8..end].as_chunks::<4>().0.iter().any(|c| c == b"avif" || c == b"avis")
}

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "jpe", "jfif", "png", "gif", "webp", "avif", "bmp"];

/// True for entries that may be pages: an image extension, not hidden, not macOS metadata.
/// `path` uses `/` (or `\`) separators.
pub fn is_page_name(path: &str) -> bool {
    let parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    let Some(file) = parts.last() else { return false };
    if parts.iter().any(|p| p.starts_with('.') || p.eq_ignore_ascii_case("__MACOSX")) {
        return false;
    }
    match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => IMAGE_EXTS.iter().any(|e| ext.eq_ignore_ascii_case(e)),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_names() {
        assert!(is_page_name("001.JPG"));
        assert!(is_page_name("ch1/p 2.webp"));
        assert!(is_page_name("ch1\\p2.avif"));
        assert!(!is_page_name("__MACOSX/ch1/._p2.png"));
        assert!(!is_page_name("ch1/._p2.png"));
        assert!(!is_page_name(".hidden/p.png"));
        assert!(!is_page_name("ComicInfo.xml"));
        assert!(!is_page_name("Thumbs.db"));
        assert!(!is_page_name("ch1/"));
        assert!(!is_page_name("inner.cbz"));
        assert!(!is_page_name(".png"));
    }

    #[test]
    fn magic_bytes() {
        assert_eq!(detect_bytes(b"PK\x03\x04rest"), Detected::Comic(Kind::Zip));
        assert_eq!(detect_bytes(b"Rar!\x1a\x07\x01\x00"), Detected::Comic(Kind::Rar));
        assert_eq!(detect_bytes(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C, 0, 4]), Detected::Comic(Kind::SevenZ));
        assert_eq!(detect_bytes(b"\xEF\xBB\xBF%PDF-1.7"), Detected::Comic(Kind::Pdf));
        assert_eq!(detect_bytes(&[0xFF, 0xD8, 0xFF, 0xE0]), Detected::Image);
        assert_eq!(detect_bytes(b"hello world"), Detected::Unknown);
        assert_eq!(detect_bytes(b""), Detected::Unknown);
    }

    #[test]
    fn mime_sniffing() {
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_mime(b"\0\0\0\x1cftypavif\0\0\0\0avifmif1"), Some("image/avif"));
        assert_eq!(image_mime(b"\0\0\0\x18ftypmp42\0\0\0\0mp42isom"), None);
        assert_eq!(image_mime(b"GIF89a.."), Some("image/gif"));
        assert_eq!(image_mime(b"<html>"), None);
    }
}
