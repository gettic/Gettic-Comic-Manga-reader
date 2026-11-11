# Gettic's Comic-Manga reader

A comic and manga reader for Windows (work in progress).

Right now the app only opens an empty window. Reading comics is not in it yet.

## Get it and run it

It is a portable app: there is no installer.

1. Download the zip from the [Releases](https://github.com/gettic/Gettic-Comic-Manga-reader/releases) page.
2. Unzip it anywhere.
3. Run `gettics-comic-manga-reader.exe`.

**Needs:** Windows 10 or 11 with Microsoft Edge WebView2 (already part of Windows 11 and most Windows 10 PCs).

## Build from source

The app is made with Tauri 2, Vite and TypeScript. The Rust part is cross-built for Windows inside WSL.

### What you need

| Where | What |
| --- | --- |
| Windows | Node.js |
| Windows | WSL with a distro named `Ubuntu` |
| Ubuntu (WSL) | `clang`, `lld`, `llvm`, `rsync` |
| Ubuntu (WSL) | Rust with the `x86_64-pc-windows-msvc` target |
| Ubuntu (WSL) | `cargo-xwin` |

### Build the exe

Run these in the project folder (where `package.json` is):

```
npm install
npm run exe
```

The exe ends up in `src-tauri\target\release\gettics-comic-manga-reader.exe` (about 3 MB).

### Commands

| Command | What it does |
| --- | --- |
| `npm run exe` | Builds the portable exe |
| `npm run exe:smoke` | Builds the exe, then runs its self-check |
| `npm run dev` | Runs the web part alone in a dev server |
| `npm run build` | Builds the web part alone |
| `npm test` | Runs the web part's tests |
| `npm run rust:check` | Checks the Rust code |
| `npm run rust:clippy` | Runs the Rust linter |

### Self-check

Run the exe with `--smoke-test`. It shows no window and ends with exit code 0 when all is OK.
