# Vendored: unrar_sys 0.5.8

Copied unchanged from crates.io (`unrar_sys-0.5.8`, MIT OR Apache-2.0; the bundled C++ in `vendor/unrar/`
is RARLAB's unRAR source under the unRAR license, see `vendor/unrar/license.txt`), then patched.
Used through `[patch.crates-io]` in `src-tauri/Cargo.toml`.

## Why

The app's Windows exe is cross-built from Linux (WSL + cargo-xwin). The original `build.rs` used
`cfg!(windows)`, which describes the build machine, not the target, so a Windows build made on Linux
left out `isnt.cpp`, skipped the Windows system libraries and linked `pthread`. The link failed.
Linux is also case-sensitive, and the unRAR source names some Windows headers/libraries in mixed case.

## Changes

- `build.rs`: target checks via `CARGO_CFG_TARGET_OS` / `CARGO_CFG_TARGET_ENV` instead of `cfg!(...)`;
  for Windows targets it compiles `isnt.cpp` and links `powrprof shell32 shlwapi advapi32 ole32 oleaut32 wbemuuid`
  (`pthread` only for windows-gnu, as before). Non-Windows targets: unchanged.
- `vendor/unrar/os.hpp`: `<PowrProf.h>` -> `<powrprof.h>`, `<Wbemidl.h>` -> `<wbemidl.h>`,
  `Shlwapi.lib` -> `shlwapi.lib`, `PowrProf.lib` -> `powrprof.lib` (case only).
- `vendor/unrar/isnt.cpp`: `<Wbemidl.h>` -> `<wbemidl.h>` (case only).

No change to the decompression code. When updating `unrar`, re-copy the new `unrar_sys` and redo these edits.
