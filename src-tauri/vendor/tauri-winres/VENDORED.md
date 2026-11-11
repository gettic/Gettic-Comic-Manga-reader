# Vendored: tauri-winres 0.3.7

Copied unchanged from crates.io (`tauri-winres-0.3.7`, MIT, see `LICENSE`), then patched.
Used through `[patch.crates-io]` in `src-tauri/Cargo.toml`.

## Why

tauri-build writes the app's version info (ProductName, FileDescription) into a Windows `.rc` file with
this crate. Its `escape_string` turned `'` into `\'`, which is not an escape in RC string literals, so
the exe's file properties showed `Gettic\'s Comic-Manga reader`.

## Change

- `src/helpers.rs`, `escape_string`: removed the `'` -> `\'` case (single quotes need no escaping
  inside a double-quoted RC string). Nothing else changed.

When tauri-build moves to a newer tauri-winres, check whether the bug is fixed upstream and drop this copy.
