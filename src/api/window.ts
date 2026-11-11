// Window-level things: file drops, "open with" from a second launch, fullscreen.
import { isTauri } from "./core";

export interface DropHandlers {
  enter(): void;
  leave(): void;
  drop(paths: string[]): void;
}

type Unlisten = () => void;

/** Files dropped on the window. In the desktop app the full paths come from Tauri. */
export async function onFileDrop(h: DropHandlers): Promise<Unlisten> {
  if (!isTauri()) {
    // Web: browsers don't give paths, so a drop just opens the demo comic.
    const over = (e: DragEvent) => {
      e.preventDefault();
      h.enter();
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) h.leave();
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      h.leave();
      h.drop(["demo:comic"]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter") h.enter();
    else if (p.type === "leave") h.leave();
    else if (p.type === "drop") {
      h.leave();
      if (p.paths.length) h.drop(p.paths);
    }
  });
}

/** A second launch of the exe passed a path ("Open with" while running). */
export async function onOpenPath(cb: (path: string) => void): Promise<Unlisten> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("open-path", (e) => cb(e.payload));
}

export async function isFullscreen(): Promise<boolean> {
  if (!isTauri()) return document.fullscreenElement !== null;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isFullscreen();
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (!on && document.fullscreenElement) await document.exitFullscreen();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setFullscreen(on);
}
