// One gesture recognizer for mouse, pen and touch (Pointer Events): tap, double tap, drag, pinch.
import type { Pos } from "../camera";

export interface GestureHandlers {
  tap(at: Pos, pointerType: string): void;
  doubleTap(at: Pos, pointerType: string): void;
  dragStart(pointerType: string): void;
  dragMove(dx: number, dy: number): void;
  dragEnd(vx: number, vy: number): void;
  pinch(phase: "start" | "move" | "end", scale: number, at: Pos): void;
  /** Mouse back / forward buttons. */
  sideButton(forward: boolean): void;
}

const SLOP = 8; // px before a press becomes a drag
const DOUBLE_MS = 300;

export function attachGestures(el: HTMLElement, h: GestureHandlers): () => void {
  const pts = new Map<number, Pos>();
  let start: Pos = { x: 0, y: 0 };
  let startTime = 0;
  let type = "mouse";
  let dragging = false;
  let pinching = false;
  let pinchDist = 1;
  let samples: { t: number; x: number; y: number }[] = [];
  let lastTap = { t: 0, x: 0, y: 0 };
  let rect = el.getBoundingClientRect();

  const local = (e: PointerEvent): Pos => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  const two = () => [...pts.values()];
  const mid = (a: Pos, b: Pos): Pos => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y) || 1;

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && (e.button === 3 || e.button === 4)) {
      e.preventDefault();
      h.sideButton(e.button === 4);
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest(".no-gesture")) return;
    rect = el.getBoundingClientRect();
    el.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      start = p;
      startTime = e.timeStamp;
      type = e.pointerType;
      dragging = false;
      samples = [{ t: e.timeStamp, ...p }];
    } else if (pts.size === 2) {
      if (dragging) h.dragEnd(0, 0);
      dragging = false;
      pinching = true;
      const [a, b] = two();
      pinchDist = dist(a, b);
      h.pinch("start", 1, mid(a, b));
    }
  };

  const move = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pinching) {
      if (pts.size >= 2) {
        const [a, b] = two();
        h.pinch("move", dist(a, b) / pinchDist, mid(a, b));
      }
      return;
    }
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (!dragging && Math.hypot(dx, dy) > SLOP) {
      dragging = true;
      h.dragStart(type);
    }
    if (dragging) {
      samples.push({ t: e.timeStamp, ...p });
      if (samples.length > 6) samples.shift();
      h.dragMove(dx, dy);
    }
  };

  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (pinching) {
      if (pts.size === 0) {
        pinching = false;
        h.pinch("end", 1, p);
      }
      return;
    }
    if (dragging) {
      dragging = false;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = Math.max(1, b.t - a.t);
      const fresh = e.timeStamp - b.t < 80;
      h.dragEnd(fresh ? (b.x - a.x) / dt : 0, fresh ? (b.y - a.y) / dt : 0);
      return;
    }
    if (e.type === "pointercancel" || e.timeStamp - startTime > 600) return;
    const isDouble = e.timeStamp - lastTap.t < DOUBLE_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30;
    if (isDouble) {
      lastTap = { t: 0, x: 0, y: 0 };
      h.doubleTap(p, type);
    } else {
      lastTap = { t: e.timeStamp, x: p.x, y: p.y };
      h.tap(p, type);
    }
  };

  const cancel = (e: PointerEvent) => {
    // Native scrolling took over (strip mode): forget the press.
    pts.delete(e.pointerId);
    if (dragging) h.dragEnd(0, 0);
    dragging = false;
    if (pinching && pts.size === 0) {
      pinching = false;
      h.pinch("end", 1, { x: 0, y: 0 });
    }
  };

  // Stop the browser's own back/forward on the mouse side buttons.
  const aux = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("mouseup", aux);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("mouseup", aux);
  };
}
