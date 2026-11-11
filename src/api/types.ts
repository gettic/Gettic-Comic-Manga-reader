// Data shapes shared with the Rust side (see src-tauri\COMMANDS.md) plus the UI's own settings.

export type ComicKind = "zip" | "7z" | "rar" | "pdf" | "folder";

export interface PageInfo {
  index: number;
  name: string;
  width?: number;
  height?: number;
}

export interface ComicInfo {
  id: string;
  path: string;
  title: string;
  kind: ComicKind;
  pages: PageInfo[];
  urlBase: string;
  lastPage: number;
  isRendered: boolean;
  view?: unknown;
}

export interface RecentComic {
  path: string;
  title: string;
  page: number;
  pageCount: number;
  updated: number;
  direction?: string;
  layout?: string;
}

export interface CoreError {
  code: string;
  message: string;
}

export type Layout = "single" | "double" | "book" | "strip";
export type Direction = "ltr" | "rtl";
export type Fit = "width" | "height" | "page" | "original";

/** How one comic is shown. Saved per comic (set_comic_view) and as the default. */
export interface ViewSettings {
  layout: Layout;
  direction: Direction;
  fit: Fit;
  coverAlone: boolean;
  spreadOffset: 0 | 1;
}

export interface AppSettings {
  defaults: ViewSettings;
  clickZones: boolean;
  /** "slide": animated (a page flip in Book view), "instant": no animation. */
  turnAnimation: "slide" | "instant";
  background: "black" | "grey";
  /** Strip column width, percent of the window width (30..100). */
  stripWidth: number;
  /** Gap between strip pages in px. */
  stripGap: number;
  autoSingleWhenPortrait: boolean;
  chromeHideMs: number;
  /** First open of a portrait PDF: show it as a book. */
  pdfAsBook: boolean;
}

/** Turns anything thrown by the api into a message that can be shown to the user. */
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as CoreError).message === "string") {
    return (e as CoreError).message;
  }
  if (typeof e === "string") return e;
  return "Something went wrong.";
}
