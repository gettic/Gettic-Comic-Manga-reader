// Comic commands (COMMANDS.md). Outside Tauri they go to the demo backend.
import { invoke, isTauri } from "./core";
import type { ComicInfo, RecentComic, ViewSettings } from "./types";

const demo = () => import("./demo");

export async function pickComic(kind: "file" | "folder"): Promise<string | null> {
  if (!isTauri()) return (await demo()).pickComic(kind);
  return invoke<string | null>("pick_comic", { kind });
}

export async function openComic(path: string): Promise<ComicInfo> {
  if (!isTauri()) return (await demo()).openComic(path);
  return invoke<ComicInfo>("open_comic", { path });
}

export async function closeComic(id: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<null>("close_comic", { id });
}

export async function setProgress(id: string, page: number): Promise<void> {
  if (!isTauri()) return (await demo()).setProgress(id, page);
  await invoke<null>("set_progress", { id, page });
}

export async function setComicView(id: string, view: ViewSettings): Promise<void> {
  if (!isTauri()) return (await demo()).setComicView(id, view);
  await invoke<null>("set_comic_view", { id, view });
}

export async function recentComics(limit = 5): Promise<RecentComic[]> {
  if (!isTauri()) return (await demo()).recentComics(limit);
  return invoke<RecentComic[]>("recent_comics", { limit });
}

export async function takeStartupPath(): Promise<string | null> {
  // Web: "?open=demo:comic" plays the role of the command line.
  if (!isTauri()) return new URLSearchParams(location.search).get("open");
  return invoke<string | null>("take_startup_path");
}

/** Rounds a wanted device-pixel width up to a 256 step (64..4096), so PDF renders are cached well. */
export function pdfWidthStep(devicePx: number): number {
  const w = Math.ceil(Math.max(devicePx, 1) / 256) * 256;
  return Math.min(4096, Math.max(256, w));
}

let demoUrl: ((comic: ComicInfo, index: number) => string) | null = null;
/** Used by demo.ts only: page URLs for the generated demo comics. */
export function setDemoPageUrl(fn: (comic: ComicInfo, index: number) => string): void {
  demoUrl = fn;
}

/** URL of one page image. `devicePx` matters only for rendered (PDF) comics. */
export function pageUrl(comic: ComicInfo, index: number, devicePx?: number): string {
  if (demoUrl && comic.urlBase.startsWith("demo:")) return demoUrl(comic, index);
  const base = comic.urlBase + index;
  if (comic.isRendered && devicePx) return `${base}?w=${pdfWidthStep(devicePx)}`;
  return base;
}
