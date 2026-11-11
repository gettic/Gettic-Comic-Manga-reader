#!/usr/bin/env bash
# Cross-builds the Windows exe inside WSL (Ubuntu) with cargo-xwin.
# Called by scripts/build.mjs (npm run exe / rust:*); not meant to be run by hand.
# Usage: build-exe.sh <check|clippy|test|lock|release> [windows-output-dir-as-wsl-path]
set -euo pipefail

mode="${1:-release}"
out_dir="${2:-}"

# shellcheck disable=SC1091
source "$HOME/.cargo/env"

# Microsoft CRT/SDK license accepted by the user (2026-11-11) for cargo-xwin downloads.
export XWIN_ACCEPT_LICENSE=1

code_dir="$(cd "$(dirname "$0")/.." && pwd)"
work="$HOME/build/comic-reader"
# Build output stays in the Linux filesystem (fast, and outside Windows antivirus scanning).
export CARGO_TARGET_DIR="$work/target"

# Mirror the sources to a path without the apostrophe: tauri-build writes the icon path into
# a Windows .rc file and escapes "'" in a way llvm-rc cannot read.
mkdir -p "$work/src"
rsync -a --delete "$code_dir/package.json" "$work/src/"
rsync -a --delete --exclude target/ --exclude gen/ "$code_dir/src-tauri/" "$work/src/src-tauri/"
if [ -d "$code_dir/dist" ]; then
  rsync -a --delete "$code_dir/dist/" "$work/src/dist/"
fi
cd "$work/src/src-tauri"

# C++ (unRAR) cross-compile flags, Windows target only (cargo-xwin appends CXXFLAGS to its own flags).
# (Header/library name case and the Windows-only parts are fixed in src-tauri/vendor/unrar_sys.)
# - Ubuntu's clang 18 is older than the MSVC STL headers expect (19+); the STL's own switch allows it
# - clang (unlike MSVC) needs -maes / -mssse3 to compile unRAR's AES and SSSE3 intrinsics (MSVC allows
#   them without flags). unRAR checks the CPU at runtime before using them. SSSE3 is on every x86-64
#   CPU since ~2008 (Windows 11 needs SSE4.2); this only affects the unRAR C++ code.
export CXXFLAGS_FOR_XWIN="-D_ALLOW_COMPILER_AND_STL_VERSION_MISMATCH /clang:-maes /clang:-mssse3"

target=x86_64-pc-windows-msvc
case "$mode" in
  check)
    CXXFLAGS="$CXXFLAGS_FOR_XWIN" cargo xwin check --locked --target "$target"
    ;;
  clippy)
    CXXFLAGS="$CXXFLAGS_FOR_XWIN" cargo xwin clippy --locked --target "$target" -- -D warnings
    ;;
  lock)
    # After editing Cargo.toml: add the new crates to Cargo.lock (existing pins stay) and copy it back.
    cargo metadata --format-version 1 --filter-platform "$target" > /dev/null
    cp -f Cargo.lock "$code_dir/src-tauri/Cargo.lock"
    ;;
  test)
    # Unit tests run here in Linux (host target, needs Tauri's Linux packages); nothing goes to Windows.
    cargo test --locked
    ;;
  release)
    # tauri/custom-protocol = serve the bundled ../dist instead of the dev server (what `tauri build` does).
    CXXFLAGS="$CXXFLAGS_FOR_XWIN" cargo xwin build --locked --release --target "$target" --features tauri/custom-protocol
    exe="$CARGO_TARGET_DIR/$target/release/gettics-comic-manga-reader.exe"
    if [ -n "$out_dir" ]; then
      mkdir -p "$out_dir"
      cp -f "$exe" "$out_dir/"
    fi
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 64
    ;;
esac
