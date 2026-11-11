//! Reader core tests. Every comic is generated in a temp folder (`gcmr-test-*`), except the
//! three tiny RAR fixtures in `tests/fixtures/rar` (RAR can't be generated without WinRAR).

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use serde_json::json;
use zip::CompressionMethod;

use super::session::Session;
use super::testdata::{page_png, write_zip, write_zip_with};
use super::*;

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> TempDir {
        let d = std::env::temp_dir().join(format!("gcmr-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        TempDir(d)
    }
    fn join(&self, p: &str) -> PathBuf {
        self.0.join(p)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// The "#n" tag written by `page_png`.
fn tag(c: &Comic, i: usize) -> String {
    let d = c.read_page(i, None).unwrap();
    assert_eq!(d.mime, "image/png");
    let pos = d.bytes.iter().rposition(|b| *b == b'#').unwrap();
    String::from_utf8_lossy(&d.bytes[pos + 1..]).into_owned()
}

fn names(c: &Comic) -> Vec<&str> {
    c.pages.iter().map(|p| p.name.as_str()).collect()
}

fn code(r: Result<Comic>) -> ErrorCode {
    r.expect_err("expected an error").code
}

// ---------- ZIP ----------

#[test]
fn zip_sorts_naturally_and_skips_junk() {
    let t = TempDir::new("zip-sort");
    let p = t.join("book.cbz");
    write_zip(
        &p,
        &[
            ("page10.png", page_png(10)),
            ("page2.PNG", page_png(2)),
            ("__MACOSX/._page1.png", b"junk".to_vec()),
            ("page1.png", page_png(1)),
            ("ComicInfo.xml", b"<x/>".to_vec()),
            ("sub/page3.png", page_png(3)),
            ("._hidden.png", b"junk".to_vec()),
        ],
    )
    .unwrap();
    let c = Comic::open(&p).unwrap();
    assert_eq!(c.kind, Kind::Zip);
    assert_eq!(c.title, "book");
    assert_eq!(names(&c), ["page1.png", "page2.PNG", "page10.png", "sub/page3.png"]);
    let tags: Vec<String> = (0..4).map(|i| tag(&c, i)).collect();
    assert_eq!(tags, ["1", "2", "10", "3"]);
    assert_eq!(c.read_page(4, None).unwrap_err().code, ErrorCode::NotFound);
}

#[test]
fn zip_with_wrong_extension_and_stored_entries() {
    let t = TempDir::new("zip-ext");
    let p = t.join("really-a-zip.cbr");
    write_zip_with(&p, &[("a.png", page_png(1))], CompressionMethod::Stored).unwrap();
    let c = Comic::open(&p).unwrap();
    assert_eq!(c.kind, Kind::Zip);
    assert_eq!(tag(&c, 0), "1");
}

#[test]
fn zip_errors() {
    let t = TempDir::new("zip-err");
    // Truncated.
    let p = t.join("cut.cbz");
    write_zip(&p, &[("a.png", page_png(1)), ("b.png", page_png(2))]).unwrap();
    let bytes = std::fs::read(&p).unwrap();
    std::fs::write(&p, &bytes[..bytes.len() / 2]).unwrap();
    assert_eq!(code(Comic::open(&p)), ErrorCode::Corrupt);

    // No images.
    let p = t.join("empty.cbz");
    write_zip(&p, &[("readme.txt", b"hi".to_vec())]).unwrap();
    assert_eq!(code(Comic::open(&p)), ErrorCode::NoPages);

    // Encrypted flag set on every entry (local + central headers).
    let p = t.join("locked.cbz");
    write_zip_with(&p, &[("a.png", page_png(1))], CompressionMethod::Stored).unwrap();
    let mut b = std::fs::read(&p).unwrap();
    patch_all(&mut b, b"PK\x01\x02", 8, |v| v | 1);
    patch_all(&mut b, b"PK\x03\x04", 6, |v| v | 1);
    std::fs::write(&p, &b).unwrap();
    assert_eq!(code(Comic::open(&p)), ErrorCode::Encrypted);

    // A "png" that is not an image: opens, but the page gives a clear error.
    let p = t.join("fake.cbz");
    write_zip(&p, &[("a.png", b"not an image".to_vec()), ("b.png", page_png(2))]).unwrap();
    let c = Comic::open(&p).unwrap();
    assert_eq!(c.read_page(0, None).unwrap_err().code, ErrorCode::Unsupported);
    assert_eq!(tag(&c, 1), "2");

    // A lying (huge) size in the central directory is refused, not allocated.
    let p = t.join("bomb.cbz");
    write_zip_with(&p, &[("a.png", page_png(1))], CompressionMethod::Stored).unwrap();
    let mut b = std::fs::read(&p).unwrap();
    let at = find(&b, b"PK\x01\x02").unwrap() + 24;
    b[at..at + 4].copy_from_slice(&0x7FFF_0000u32.to_le_bytes());
    std::fs::write(&p, &b).unwrap();
    if let Ok(c) = Comic::open(&p) {
        assert_eq!(c.read_page(0, None).unwrap_err().code, ErrorCode::TooLarge);
    }

    // Not a comic at all / missing.
    let p = t.join("notes.cbz");
    std::fs::write(&p, b"just some text").unwrap();
    assert_eq!(code(Comic::open(&p)), ErrorCode::Unsupported);
    assert_eq!(code(Comic::open(&t.join("missing.cbz"))), ErrorCode::NotFound);
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Applies `f` to the u16 at `offset` after every occurrence of `sig`.
fn patch_all(b: &mut [u8], sig: &[u8], offset: usize, f: impl Fn(u16) -> u16) {
    let mut i = 0;
    while let Some(p) = find(&b[i..], sig) {
        let at = i + p + offset;
        let v = f(u16::from_le_bytes([b[at], b[at + 1]]));
        b[at..at + 2].copy_from_slice(&v.to_le_bytes());
        i += p + sig.len();
    }
}

#[test]
fn zip_500_pages_opens_fast_and_reads_in_parallel() {
    let t = TempDir::new("zip-500");
    let p = t.join("big.cbz");
    let entries: Vec<(String, Vec<u8>)> = (1..=500).map(|i| (format!("p{i}.png"), page_png(i))).collect();
    let refs: Vec<(&str, Vec<u8>)> = entries.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
    write_zip(&p, &refs).unwrap();

    let start = Instant::now();
    let c = Comic::open(&p).unwrap();
    let took = start.elapsed();
    assert_eq!(c.pages.len(), 500);
    assert!(took.as_millis() < 200, "open took {took:?}");
    assert_eq!(c.pages[499].name, "p500.png");

    let c = Arc::new(c);
    let handles: Vec<_> = (0..8)
        .map(|k| {
            let c = c.clone();
            std::thread::spawn(move || {
                for i in (k..500).step_by(8) {
                    assert_eq!(tag(&c, i), (i + 1).to_string());
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
}

// ---------- 7z ----------

fn write_7z(path: &Path, entries: &[(&str, Vec<u8>)], solid: bool) {
    use sevenz_rust2::{ArchiveEntry, ArchiveWriter, SourceReader};
    let mut w = ArchiveWriter::create(path).unwrap();
    if solid {
        let es = entries.iter().map(|(n, _)| ArchiveEntry::new_file(n)).collect();
        let rs = entries.iter().map(|(_, d)| SourceReader::from(std::io::Cursor::new(d.clone()))).collect();
        w.push_archive_entries(es, rs).unwrap();
    } else {
        for (n, d) in entries {
            w.push_archive_entry(ArchiveEntry::new_file(n), Some(std::io::Cursor::new(d.clone()))).unwrap();
        }
    }
    w.finish().unwrap();
}

#[test]
fn sevenz_solid_and_non_solid() {
    let t = TempDir::new("7z");
    let entries: Vec<(String, Vec<u8>)> = (1..=12).map(|i| (format!("img{i}.png"), page_png(i))).collect();
    let mut refs: Vec<(&str, Vec<u8>)> = entries.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
    refs.push(("info.txt", b"x".to_vec()));
    for solid in [false, true] {
        let p = t.join(if solid { "solid.cb7" } else { "plain.cb7" });
        write_7z(&p, &refs, solid);
        let c = Comic::open(&p).unwrap();
        assert_eq!(c.kind, Kind::SevenZ);
        assert_eq!(c.pages.len(), 12);
        assert_eq!(c.pages[1].name, "img2.png");
        // In order, then backwards, then a jump.
        for i in 0..12 {
            assert_eq!(tag(&c, i), (i + 1).to_string(), "solid={solid} page {i}");
        }
        for i in (0..12).rev() {
            assert_eq!(tag(&c, i), (i + 1).to_string());
        }
        assert_eq!(tag(&c, 7), "8");
    }
    // Damaged 7z.
    let p = t.join("cut.cb7");
    write_7z(&p, &refs, true);
    let b = std::fs::read(&p).unwrap();
    std::fs::write(&p, &b[..b.len() - 20]).unwrap();
    let r = Comic::open(&p);
    assert!(matches!(r.map(|_| ()).unwrap_err().code, ErrorCode::Corrupt | ErrorCode::Io));
}

// ---------- folders ----------

#[test]
fn folders_nested_hidden_and_single_image() {
    let t = TempDir::new("folder");
    let root = t.join("My Comic");
    std::fs::create_dir_all(root.join("ch10")).unwrap();
    std::fs::create_dir_all(root.join("ch2")).unwrap();
    std::fs::create_dir_all(root.join(".thumbs")).unwrap();
    std::fs::create_dir_all(root.join("a/b/c")).unwrap();
    std::fs::write(root.join("cover.png"), page_png(0)).unwrap();
    std::fs::write(root.join("ch2/1.png"), page_png(21)).unwrap();
    std::fs::write(root.join("ch10/1.png"), page_png(101)).unwrap();
    std::fs::write(root.join(".thumbs/x.png"), page_png(9)).unwrap();
    std::fs::write(root.join("a/b/c/too-deep.png"), page_png(9)).unwrap();
    std::fs::write(root.join("Thumbs.db"), b"x").unwrap();

    let c = Comic::open(&root).unwrap();
    assert_eq!(c.kind, Kind::Folder);
    assert_eq!(c.title, "My Comic");
    assert_eq!(names(&c), ["ch2/1.png", "ch10/1.png", "cover.png"]);
    assert_eq!(tag(&c, 1), "101");

    let c = Comic::open(&root.join("cover.png")).unwrap();
    assert_eq!(c.start_page, Some(2));
    assert_eq!(c.path, root);

    let empty = t.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    assert_eq!(code(Comic::open(&empty)), ErrorCode::NoPages);
}

// ---------- PDF ----------

/// A minimal valid 2-page PDF (portrait + landscape) with a filled rectangle on each page.
fn make_pdf() -> Vec<u8> {
    let content = b"0 0 1 rg 100 100 200 200 re f";
    let objs = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 5 0 R >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}\nendstream", content.len(), String::from_utf8_lossy(content)),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, o) in objs.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, o).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes());
    for off in offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1).as_bytes());
    out
}

/// (width, height) from a baseline JPEG's SOF0 marker.
fn jpeg_size(b: &[u8]) -> (u32, u32) {
    let i = find(b, &[0xFF, 0xC0]).expect("no SOF0 marker");
    let h = u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32;
    let w = u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32;
    (w, h)
}

#[test]
fn pdf_pages_render_as_jpeg() {
    let t = TempDir::new("pdf");
    let p = t.join("doc.pdf");
    std::fs::write(&p, make_pdf()).unwrap();
    let c = Comic::open(&p).unwrap();
    assert_eq!(c.kind, Kind::Pdf);
    assert!(c.is_rendered);
    assert_eq!(c.pages.len(), 2);
    assert_eq!((c.pages[0].width, c.pages[0].height), (Some(816), Some(1056)));
    let d = c.read_page(1, Some(300)).unwrap();
    assert_eq!(d.mime, "image/jpeg");
    assert!(d.bytes.starts_with(&[0xFF, 0xD8, 0xFF]));
    // The rendered width is exactly the asked width (portrait and landscape).
    for (page, w) in [(0, 800), (1, 800), (1, 1024), (0, 333), (1, 64)] {
        let d = c.read_page(page, Some(w)).unwrap();
        assert_eq!(jpeg_size(&d.bytes).0, w, "page {page} at w={w}");
    }
    // Huge widths are clamped, not rendered at 100000 px.
    let d = c.read_page(0, Some(100_000)).unwrap();
    assert_eq!(jpeg_size(&d.bytes).0, crate::reader::source_pdf::MAX_WIDTH);
    let d = c.read_page(1, None).unwrap();
    assert_eq!(jpeg_size(&d.bytes), (crate::reader::source_pdf::DEFAULT_WIDTH, 1236));

    let bad = t.join("bad.pdf");
    std::fs::write(&bad, b"%PDF-1.4\nthis is not really a pdf").unwrap();
    assert!(matches!(code(Comic::open(&bad)), ErrorCode::Corrupt | ErrorCode::NoPages));
}

// ---------- RAR ----------

#[cfg(feature = "rar")]
mod rar {
    use super::*;
    use crate::reader::source_rar::RarSource;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rar").join(name)
    }

    #[test]
    fn rar_reads_entries_and_reports_errors() {
        // No images inside: a clear "no pages", not a crash.
        assert_eq!(code(Comic::open(&fixture("version.rar"))), ErrorCode::NoPages);

        let src = RarSource::all_entries(&fixture("version.rar")).unwrap();
        assert_eq!(src.read_raw(0).unwrap(), b"unrar-0.4.0");

        let src = RarSource::all_entries(&fixture("crypted.rar")).unwrap();
        assert_eq!(src.read_raw(0).unwrap_err().code, ErrorCode::Encrypted);

        let solid = RarSource::all_entries(&fixture("solid.rar")).unwrap();
        assert!(solid.is_solid());
        let (_, entries) = crate::reader::source_rar::list(&fixture("solid.rar")).unwrap();
        assert!(!entries.is_empty());
        for e in entries.iter().rev() {
            solid.read_raw(e.0).unwrap();
        }
    }
}

// ---------- session + protocol ----------

#[test]
fn session_progress_views_recent_and_pages() {
    let t = TempDir::new("session");
    let book = t.join("book.cbz");
    write_zip(&book, &[("1.png", page_png(1)), ("2.png", page_png(2)), ("3.png", page_png(3))]).unwrap();
    let data = t.join("data");

    let s = Session::new(&data, "http://comic.localhost/");
    let info = s.open(&book).unwrap();
    assert_eq!(info.last_page, 0);
    assert!(info.url_base.starts_with("http://comic.localhost/c"));
    assert!(info.view.is_none());
    s.set_progress(&info.id, 2).unwrap();
    s.set_view(&info.id, json!({"layout": "double", "direction": "rtl"})).unwrap();
    let id: u64 = session::parse_id(&info.id).unwrap();
    let p = s.page(id, 1, None).unwrap();
    assert_eq!(p.mime, "image/png");
    assert!(s.cache.used_bytes() > 0);
    assert_eq!(s.page(id, 9, None).unwrap_err().code, ErrorCode::NotFound);
    s.close(&info.id).unwrap();
    assert_eq!(s.cache.used_bytes(), 0);
    assert_eq!(s.page(id, 1, None).unwrap_err().code, ErrorCode::UnknownComic);
    assert_eq!(s.set_progress(&info.id, 1).unwrap_err().code, ErrorCode::UnknownComic);
    s.close("nonsense").unwrap();

    // A new session (app restart) remembers page and view.
    let s2 = Session::new(&data, "http://comic.localhost/");
    let again = s2.open(&book).unwrap();
    assert_eq!(again.last_page, 2);
    assert_eq!(again.view.unwrap()["layout"], "double");
    assert_ne!(again.id, info.id.replace('c', "x"));
    let recent = s2.recent(5);
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].page_count, 3);
    assert_eq!(recent[0].direction.as_deref(), Some("rtl"));

    let json = serde_json::to_value(&again.pages[0]).unwrap();
    assert_eq!(json, json!({"index": 0, "name": "1.png"}));
}
