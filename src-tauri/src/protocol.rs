//! The `comic` URI scheme: `<URL_ROOT><comicId>/<pageIndex>[?w=<px>]` -> page bytes.
//! `parse` and `serve` are plain functions (testable without Tauri); `respond` wraps them.

use std::sync::Arc;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

use crate::commands::AppState;
use crate::reader::session::{parse_id, Session};
use crate::reader::{ErrorCode, PageData};

pub const SCHEME: &str = "comic";

/// How the webview addresses the scheme (Windows/Android use http://<scheme>.localhost).
#[cfg(any(windows, target_os = "android"))]
pub const URL_ROOT: &str = "http://comic.localhost/";
#[cfg(not(any(windows, target_os = "android")))]
pub const URL_ROOT: &str = "comic://localhost/";

/// `/c3/12` + `w=800` -> (3, 12, Some(800)).
pub fn parse(path: &str, query: Option<&str>) -> Option<(u64, usize, Option<u32>)> {
    let mut parts = path.trim_start_matches('/').split('/');
    let id = parse_id(parts.next()?)?;
    let page = parts.next()?.parse().ok()?;
    if parts.next().is_some_and(|p| !p.is_empty()) {
        return None;
    }
    let width = query
        .unwrap_or("")
        .split('&')
        .find_map(|kv| kv.strip_prefix("w="))
        .and_then(|v| v.parse().ok());
    Some((id, page, width))
}

pub enum Reply {
    Page(Arc<PageData>),
    Error { status: u16, code: &'static str, message: String },
}

pub fn serve(session: &Session, path: &str, query: Option<&str>) -> Reply {
    let Some((id, page, width)) = parse(path, query) else {
        return Reply::Error { status: 404, code: ErrorCode::NotFound.as_str(), message: "Bad page address.".into() };
    };
    match session.page(id, page, width) {
        Ok(p) => Reply::Page(p),
        Err(e) => {
            let status = match e.code {
                ErrorCode::UnknownComic | ErrorCode::NotFound => 404,
                _ => 422,
            };
            Reply::Error { status, code: e.code.as_str(), message: e.message }
        }
    }
}

pub fn respond<R: Runtime>(app: &AppHandle<R>, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let reply = match app.try_state::<AppState>() {
        Some(state) => serve(&state.session, req.uri().path(), req.uri().query()),
        None => Reply::Error { status: 503, code: "io", message: "Not ready.".into() },
    };
    let b = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "X-Error-Code");
    let res = match reply {
        Reply::Page(p) => b
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, p.mime)
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(p.bytes.clone()),
        Reply::Error { status, code, message } => b
            .status(status)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header("X-Error-Code", code)
            .body(message.into_bytes()),
    };
    res.unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_page_addresses() {
        assert_eq!(parse("/c3/12", None), Some((3, 12, None)));
        assert_eq!(parse("/c3/0", Some("w=800")), Some((3, 0, Some(800))));
        assert_eq!(parse("/c3/0/", Some("x=1&w=64")), Some((3, 0, Some(64))));
        assert_eq!(parse("/c3/0", Some("w=abc")), Some((3, 0, None)));
        assert_eq!(parse("/3/0", None), None);
        assert_eq!(parse("/c3", None), None);
        assert_eq!(parse("/c3/-1", None), None);
        assert_eq!(parse("/c3/1/2", None), None);
    }
}
