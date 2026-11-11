// What every reading layout (paged single/double, strip) offers the reader controller.
import type { AppSettings, ViewSettings } from "../../api/types";
import type { Pos } from "../camera";
import type { Navigator, Step } from "../navigator";
import type { PageCache } from "../page-cache";

export interface LayoutContext {
  count: number;
  cache: PageCache;
  /** Called whenever the first shown page changes. */
  onPage(page: number): void;
  /** Called when the zoom level changes (for the zoom readout). */
  onZoom(zoom: number): void;
}

export type ZoomCmd = "in" | "out" | "reset" | "toggle";

export interface ReaderLayout extends Navigator {
  readonly el: HTMLElement;
  /** Pages currently on screen (reading order). */
  readonly shown: number[];
  readonly zoom: number;
  canStep(dir: Step): boolean;
  /** Keyboard scrolling: `amount` = fraction of the screen, + toward the end. Turns the page at an edge. */
  scroll(amount: number): void;
  wheel(e: WheelEvent, at: Pos): void;
  zoomCmd(cmd: ZoomCmd, at?: Pos): void;
  /** One-finger / mouse drag; total movement since start. */
  dragStart(pointerType: string): void;
  dragMove(dx: number, dy: number): void;
  dragEnd(vx: number, vy: number): void;
  pinch(phase: "start" | "move" | "end", scale: number, at: Pos): void;
  /** View or settings changed (fit, direction, pairing, double, strip width...). */
  update(view: ViewSettings, double: boolean, settings: AppSettings): void;
  resize(w: number, h: number): void;
  destroy(): void;
}
