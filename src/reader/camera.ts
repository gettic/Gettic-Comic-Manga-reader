// Fit, zoom and pan. The pure functions do the math; Camera holds the state and writes one
// transform per frame. Content is laid out at its fitted size, so zoom 1 = the chosen fit.
import type { Fit } from "../api/types";

export interface Size {
  w: number;
  h: number;
}
export interface Pos {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

/** Scale that makes `content` (natural px) fit the `view` (CSS px). */
export function fitScale(fit: Fit, content: Size, view: Size): number {
  if (content.w <= 0 || content.h <= 0 || view.w <= 0 || view.h <= 0) return 1;
  const sw = view.w / content.w;
  const sh = view.h / content.h;
  switch (fit) {
    case "width":
      return sw;
    case "height":
      return sh;
    case "page":
      return Math.min(sw, sh);
    case "original":
      return 1;
  }
}

/** Keeps content in view: centred on an axis where it is smaller, edge-clamped where bigger. */
export function clampPos(p: Pos, content: Size, zoom: number, view: Size): Pos {
  const axis = (v: number, c: number, s: number) => (c <= s ? (s - c) / 2 : Math.min(0, Math.max(s - c, v)));
  return { x: axis(p.x, content.w * zoom, view.w), y: axis(p.y, content.h * zoom, view.h) };
}

/** Where reading starts on a unit: the top (or bottom when going back), at the reading-side edge. */
export function startPos(content: Size, zoom: number, view: Size, o: { atEnd: boolean; rtl: boolean }): Pos {
  const w = content.w * zoom;
  const h = content.h * zoom;
  const x = o.rtl ? view.w - w : 0;
  const y = o.atEnd ? view.h - h : 0;
  return clampPos({ x, y }, content, zoom, view);
}

/** Changes zoom while keeping the content point under `at` (view coordinates) still. */
export function zoomAt(p: Pos, zoom: number, newZoom: number, at: Pos): Pos {
  const k = newZoom / zoom;
  return { x: at.x - (at.x - p.x) * k, y: at.y - (at.y - p.y) * k };
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Can the content still move by (dx, dy)? Used to scroll inside a tall page before turning. */
export function canPan(p: Pos, content: Size, zoom: number, view: Size, dx: number, dy: number): boolean {
  const q = clampPos({ x: p.x - dx, y: p.y - dy }, content, zoom, view);
  return Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5;
}

/** Camera for one element: holds pan + zoom and writes them as a GPU transform. */
export class Camera {
  pos: Pos = { x: 0, y: 0 };
  zoom = 1;
  content: Size = { w: 1, h: 1 };
  view: Size = { w: 1, h: 1 };
  private anim = 0;

  constructor(private el: HTMLElement) {}

  set(pos: Pos, zoom = this.zoom): void {
    this.stop();
    this.zoom = clampZoom(zoom);
    this.pos = clampPos(pos, this.content, this.zoom, this.view);
    this.apply();
  }

  /** Moves by (dx, dy) toward the content's end. Returns how much it really moved. */
  panBy(dx: number, dy: number): Pos {
    const before = this.pos;
    this.set({ x: before.x - dx, y: before.y - dy });
    return { x: before.x - this.pos.x, y: before.y - this.pos.y };
  }

  zoomTo(z: number, at: Pos = { x: this.view.w / 2, y: this.view.h / 2 }): void {
    const nz = clampZoom(z);
    this.set(zoomAt(this.pos, this.zoom, nz, at), nz);
  }

  /** Can it still move by (dx, dy)? Counts from where a running glide will end. */
  canPan(dx: number, dy: number): boolean {
    return canPan(this.anim ? this.target : this.pos, this.content, this.zoom, this.view, dx, dy);
  }

  /** Smoothly shows `rect` (content px at zoom 1) filling the view. Hook for smart panel mode. */
  animateTo(rect: { x: number; y: number; w: number; h: number }, ms = 250): void {
    const z = clampZoom(Math.min(this.view.w / rect.w, this.view.h / rect.h));
    const target = clampPos(
      { x: this.view.w / 2 - (rect.x + rect.w / 2) * z, y: this.view.h / 2 - (rect.y + rect.h / 2) * z },
      this.content,
      z,
      this.view,
    );
    this.tween(target, z, ms);
  }

  /** Smooth scroll by (dx, dy) toward the content's end (keyboard scrolling). */
  glideBy(dx: number, dy: number, ms = 160): void {
    const base = this.anim ? this.target : this.pos;
    this.tween(clampPos({ x: base.x - dx, y: base.y - dy }, this.content, this.zoom, this.view), this.zoom, ms);
  }

  private target: Pos = { x: 0, y: 0 };

  private tween(target: Pos, z: number, ms: number): void {
    this.stop();
    this.target = target;
    const from = { ...this.pos, z: this.zoom };
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      this.zoom = from.z + (z - from.z) * e;
      this.pos = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      this.apply();
      this.anim = k < 1 ? requestAnimationFrame(tick) : 0;
    };
    this.anim = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = 0;
  }

  apply(): void {
    this.el.style.transform = `translate3d(${this.pos.x}px, ${this.pos.y}px, 0) scale(${this.zoom})`;
  }
}
