//! PDF via hayro (pure Rust). Pages are rendered on request at the asked width and
//! encoded as JPEG (quality 90) with a white background.

use std::path::Path;

use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{render, PixmapSettings, RenderCache, RenderSettings};

use super::error::{CoreError, Result};
use super::{Page, PageData, Source, MAX_ENTRIES};

/// The whole PDF is held in memory while it is open (hayro needs random access to it).
pub const MAX_PDF_BYTES: u64 = 1024 * 1024 * 1024;
pub const DEFAULT_WIDTH: u32 = 1600;
pub const MIN_WIDTH: u32 = 64;
pub const MAX_WIDTH: u32 = 4096;
const MAX_PIXELS: f32 = 40_000_000.0;
const JPEG_QUALITY: u8 = 90;

pub struct PdfSource {
    pdf: Pdf,
}

pub fn open(path: &Path) -> Result<(Vec<Page>, PdfSource)> {
    let len = std::fs::metadata(path)?.len();
    if len > MAX_PDF_BYTES {
        return Err(CoreError::too_large(format!(
            "This PDF is too large ({} MB, max {} MB).",
            len / (1024 * 1024),
            MAX_PDF_BYTES / (1024 * 1024)
        )));
    }
    let data = std::fs::read(path)?;
    let pdf = Pdf::new(data).map_err(|e| match e {
        LoadPdfError::Decryption(_) => CoreError::encrypted(),
        _ => CoreError::corrupt("The PDF file is damaged or could not be read."),
    })?;
    let count = pdf.pages().len();
    if count > MAX_ENTRIES {
        return Err(CoreError::too_large(format!("Too many pages (max {MAX_ENTRIES}).")));
    }
    let pages = pdf
        .pages()
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let (w, h) = p.render_dimensions();
            // PDF units are 1/72 inch; report CSS px (96 dpi).
            let px = |v: f32| Some((v * 96.0 / 72.0).round().max(1.0) as u32);
            Page { name: format!("Page {}", i + 1), width: px(w), height: px(h), entry: i }
        })
        .collect();
    Ok((pages, PdfSource { pdf }))
}

/// The render width actually used for a requested width.
pub fn clamp_width(width: Option<u32>) -> u32 {
    width.unwrap_or(DEFAULT_WIDTH).clamp(MIN_WIDTH, MAX_WIDTH)
}

impl Source for PdfSource {
    fn read(&self, entry: usize, width: Option<u32>) -> Result<PageData> {
        let pages = self.pdf.pages();
        let page = pages.get(entry).ok_or_else(|| CoreError::corrupt("Unknown page."))?;
        let (pw, ph) = page.render_dimensions();
        let (pw, ph) = (pw.max(1.0), ph.max(1.0));
        // The renderer truncates `side * scale` to whole pixels; +0.5 px keeps float error
        // from losing a pixel, so the width is exactly the asked (clamped) width.
        let mut scale = (clamp_width(width) as f32 + 0.5) / pw;
        if pw * ph * scale * scale > MAX_PIXELS {
            scale = (MAX_PIXELS / (pw * ph)).sqrt();
        }
        // Pixmap and JPEG sizes are u16; keep both sides well inside.
        scale = scale.min(16_000.0 / pw).min(16_000.0 / ph);
        let pixmap = render(
            page,
            &RenderCache::new(),
            &InterpreterSettings::default(),
            &RenderSettings::default(),
            &PixmapSettings { x_scale: scale, y_scale: scale, bg_color: WHITE },
        );
        let (w, h) = (pixmap.width(), pixmap.height());
        if w == 0 || h == 0 {
            return Err(CoreError::corrupt("This PDF page has no size."));
        }
        let mut out = Vec::new();
        jpeg_encoder::Encoder::new(&mut out, JPEG_QUALITY)
            .encode(pixmap.data_as_u8_slice(), w, h, jpeg_encoder::ColorType::Rgba)
            .map_err(|e| CoreError::corrupt(format!("Could not encode the page ({e}).")))?;
        Ok(PageData { bytes: out, mime: "image/jpeg" })
    }
}
