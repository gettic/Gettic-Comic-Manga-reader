//! Error type shared by the whole reader core. Serialized to the UI as `{ code, message }`.

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    NotFound,
    Unsupported,
    Corrupt,
    Encrypted,
    NoPages,
    TooLarge,
    Io,
    UnknownComic,
    Invalid,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::NotFound => "not_found",
            ErrorCode::Unsupported => "unsupported",
            ErrorCode::Corrupt => "corrupt",
            ErrorCode::Encrypted => "encrypted",
            ErrorCode::NoPages => "no_pages",
            ErrorCode::TooLarge => "too_large",
            ErrorCode::Io => "io",
            ErrorCode::UnknownComic => "unknown_comic",
            ErrorCode::Invalid => "invalid",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: String,
}

pub type Result<T> = std::result::Result<T, CoreError>;

impl CoreError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        CoreError { code, message: message.into() }
    }
    pub fn unsupported(m: impl Into<String>) -> Self {
        Self::new(ErrorCode::Unsupported, m)
    }
    pub fn corrupt(m: impl Into<String>) -> Self {
        Self::new(ErrorCode::Corrupt, m)
    }
    pub fn encrypted() -> Self {
        Self::new(ErrorCode::Encrypted, "This file is password-protected, which is not supported.")
    }
    pub fn no_pages() -> Self {
        Self::new(ErrorCode::NoPages, "No pages found: the file contains no supported images.")
    }
    pub fn too_large(m: impl Into<String>) -> Self {
        Self::new(ErrorCode::TooLarge, m)
    }
    pub fn invalid(m: impl Into<String>) -> Self {
        Self::new(ErrorCode::Invalid, m)
    }
    pub fn unknown_comic() -> Self {
        Self::new(ErrorCode::UnknownComic, "This comic is not open (any more).")
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for CoreError {}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => CoreError::new(ErrorCode::NotFound, "File or folder not found."),
            std::io::ErrorKind::UnexpectedEof => CoreError::corrupt("The file ends too early (truncated?)."),
            _ => CoreError::new(ErrorCode::Io, format!("Read error: {e}")),
        }
    }
}
