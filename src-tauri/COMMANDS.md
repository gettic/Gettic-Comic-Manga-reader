# Tauri command contract

Owner: reader-core. The UI calls these through `src\api\` only. Names are as invoked from JS; arguments are camelCase (Tauri converts them); results are JSON. Every command rejects with a `CoreError`.

## Types

```ts
type ComicKind = "zip" | "7z" | "rar" | "pdf" | "folder";

interface PageInfo {
  index: number;        // 0-based, already in reading order (natural sort: page2 before page10)
  name: string;         // path inside the archive / folder, for display
  width?: number;       // px, only when cheap to know (PDF: at 96 dpi); else absent
  height?: number;      //   -> otherwise use the loaded <img> naturalWidth/Height
}

interface ComicInfo {
  id: string;           // opaque, valid until close_comic; never reused while the app runs
  path: string;         // what was opened (absolute; for a single image: its folder)
  title: string;        // file/folder name without extension
  kind: ComicKind;
  pages: PageInfo[];    // never empty (an empty comic is a "no_pages" error)
  urlBase: string;      // page image URL = urlBase + index, e.g. "http://comic.localhost/c3/12"
  lastPage: number;     // remembered page (0 if never read), clamped to pages.length-1;
                        // when a single image was opened: that image's index
  isRendered: boolean;  // true for PDF: page URLs accept ?w=<px>
  view?: unknown;       // this comic's saved view (whatever set_comic_view stored); absent if never set
}

interface RecentComic {
  path: string; title: string;
  page: number; pageCount: number;
  updated: number;      // unix ms
  direction?: string;   // copied from the stored view's "direction" field, if it is a string
  layout?: string;      // copied from the stored view's "layout" field, if it is a string
}

interface CoreError {
  code: "not_found" | "unsupported" | "corrupt" | "encrypted" | "no_pages"
      | "too_large" | "io" | "unknown_comic" | "invalid";
  message: string;      // English, safe to show to the user
}
```

## Commands

| Command | Args | Result | Notes |
|---|---|---|---|
| `pick_comic` | `{ kind: "file" \| "folder" }` | `string \| null` | Native picker, run from Rust (no dialog permission in JS). `null` = cancelled. The file filter covers comics (cbz zip cbr rar cb7 7z pdf) and images, plus "All files". |
| `open_comic` | `{ path: string }` | `ComicInfo` | Archive, PDF, folder, or one image (opens its folder at that image). The format comes from the file's content, not its extension. Only the index is read, so it is fast. |
| `close_comic` | `{ id: string }` | `null` | Frees the handle and cached pages, and saves progress. Unknown id: no error. |
| `set_progress` | `{ id: string, page: number }` | `null` | Call it on every page change; Rust writes at most once a second, plus on close and exit. |
| `set_comic_view` | `{ id: string, view: any JSON }` | `null` | Stored opaque with this comic's progress entry. Max 8 KB serialized, else `invalid`. |
| `recent_comics` | `{ limit?: number }` (default 5, max 100) | `RecentComic[]` | Newest first. |
| `get_settings` | none | `any JSON \| null` | App settings as last saved; `null` on first run. |
| `set_settings` | `{ settings: any JSON }` | `null` | Stored opaque. Max 64 KB serialized, else `invalid`. Written right away (the UI debounces). |
| `take_startup_path` | none | `string \| null` | Path from "Open with" / the command line. Returned once; call it when the UI is ready. |

## Events (Rust -> UI)

| Event | Payload | When |
|---|---|---|
| `open-path` | `string` (absolute path) | The exe was launched again with a path (e.g. "Open with" while the app is running). The running window is focused and gets the path; no second window opens. |

Drag-and-drop stays in the UI: `getCurrentWebview().onDragDropEvent(e => { if (e.payload.type === "drop") openComic(e.payload.paths[0]) })`.

## Page images (custom protocol, not a command)

- URL: `urlBase + pageIndex`. Use it directly as `<img src>`, or `fetch` it to preload.
- PDF (`isRendered`): the rendered image is exactly the requested (clamped) width, except for very tall pages that hit the 40-megapixel cap; the height follows the page's aspect ratio. Append `?w=<device px width>`, e.g. `?w=${Math.round(cssWidth * devicePixelRatio)}`. The width is clamped to 64..4096 (and to 40 megapixels). Each width is cached separately, so round it to a few steps (e.g. up to a multiple of 256). Without `?w`, pages render 1600 px wide.
- Replies:
  - `200`: the page bytes. Only the file header is checked, not the whole image, so a damaged page with a valid header still comes back as `200`: **the UI must handle a failed image decode** (`<img>` `error` event / rejected `img.decode()`), e.g. by showing a "page can't be shown" placeholder. `Content-Type` comes from the real content (image/jpeg, png, webp, gif, avif, bmp; PDF pages are JPEG). `Cache-Control: max-age=31536000, immutable`. `Access-Control-Allow-Origin: *` (for canvas reads, set `img.crossOrigin = "anonymous"`).
  - `404`: unknown id or page index.
  - `422`: this page is broken, too large, encrypted or uses an unsupported compression. The `X-Error-Code` header holds a `CoreError` code. The other pages still work.
- Pages are read on demand. A shared 256 MB cache keeps recent pages, so preloading the next 2-4 pages is cheap.

## Where data is stored

- `data\` next to the exe; if that is not writable, `%APPDATA%\com.gettic.comicmangareader\`.
- `progress.json`: per comic (key = absolute path), page, page count, title, view. Up to 1000 comics.
- `settings.json`: the app settings.
- Every write goes to a temp file first and is then renamed. Comic files are never written.

## Not in this step

Thumbnails/covers and library scanning (idea 2), ComicInfo.xml, panel detection (panels agent).
