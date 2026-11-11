// Single and double page mode. Three slots (left / centre / right, in screen order) sit side by
// side in a track; a page turn slides the track with a CSS transform, then the slots rotate so
// no image is reloaded. Neighbours are filled ahead of time with decoded images.
import type { AppSettings, ViewSettings } from "../../api/types";
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import { Camera, fitScale, startPos, type Pos } from "../camera";
import { stepToSide, sideToStep, UnitNavigator, type Side, type Step } from "../navigator";
import { buildSpreads, type PageSize } from "../spreads";
import type { LayoutContext, ReaderLayout, ZoomCmd } from "./layout";

const GAP = 24; // px between slots while sliding
const TURN_MS = 180;
const DEFAULT_SIZE: PageSize = { w: 1000, h: 1500 };

interface Slot {
  el: HTMLDivElement;
  spread: HTMLDivElement;
  camera: Camera;
  unit: number; // index into the units, -1 = empty
  atEnd: boolean;
  /** Fitted size of the spread when zoom = 1 (CSS px). */
  base: PageSize;
  fit: number;
  /** Shown CSS width of each page at zoom 1 (for PDF render widths). */
  pageW: Map<number, number>;
}

export class PagedLayout implements ReaderLayout {
  readonly el: HTMLDivElement;
  private unsubscribe: () => void;
  private track: HTMLDivElement;
  private slots: Slot[]; // [left, centre, right] on screen
  private nav: UnitNavigator;
  private view: ViewSettings;
  private double: boolean;
  private settings: AppSettings;
  private vw = 1;
  private vh = 1;
  private turning: { done: () => void; timer: number } | null = null;
  private drag: { mode: "pan" | "swipe"; last: Pos; x: number } | null = null;
  private pinchZoom = 1;
  private wheelAcc = 0;
  private wheelLast = 0;
  private wheelLock = 0;
  private lastPan = 0;
  private sizeTimer = 0;
  private lastKnown: PageSize = DEFAULT_SIZE;

  constructor(
    private ctx: LayoutContext,
    view: ViewSettings,
    double: boolean,
    settings: AppSettings,
    startPage: number,
  ) {
    this.view = view;
    this.double = double;
    this.settings = settings;
    this.track = el("div.ptrack");
    this.el = el("div.paged", {}, this.track);
    this.slots = [0, 1, 2].map(() => {
      const spread = el("div.spread");
      const slotEl = el("div.slot", {}, spread);
      this.track.append(slotEl);
      return { el: slotEl, spread, camera: new Camera(spread), unit: -1, atEnd: false, base: DEFAULT_SIZE, fit: 1, pageW: new Map() };
    });
    this.nav = new UnitNavigator(this.buildUnits(), startPage);
    this.unsubscribe = ctx.cache.onSize((i, s) => this.sizeLearned(i, s));
  }

  // ---------- Navigator ----------

  get page(): number {
    return this.nav.page;
  }

  get shown(): number[] {
    return this.nav.unit;
  }

  get zoom(): number {
    return this.center.camera.zoom;
  }

  canStep(dir: Step): boolean {
    return this.nav.canStep(dir);
  }

  step(dir: Step): boolean {
    this.finishTurn();
    if (!this.nav.canStep(dir)) return false;
    const side = stepToSide(this.view.direction, dir);
    this.nav.step(dir);
    this.pageChanged();
    if (this.settings.turnAnimation === "instant") {
      this.rotate(side);
      return true;
    }
    this.slideTo(side);
    return true;
  }

  goTo(page: number): void {
    this.finishTurn();
    const before = this.nav.index;
    this.nav.goTo(page);
    if (this.nav.index !== before) {
      this.renderAll();
      this.pageChanged();
    }
  }

  // ---------- reading inside a page ----------

  scroll(amount: number): void {
    const cam = this.center.camera;
    const dy = amount * this.vh;
    if (cam.canPan(0, dy)) {
      cam.glideBy(0, dy);
      this.lastPan = performance.now();
    } else {
      this.step(amount > 0 ? 1 : -1);
    }
  }

  wheel(e: WheelEvent, at: Pos): void {
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.vh : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    const now = performance.now();
    const cam = this.center.camera;
    if (e.ctrlKey) {
      cam.zoomTo(cam.zoom * Math.exp(-dy * 0.0015), at);
      this.zoomed();
      return;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    if (cam.canPan(dx, dy)) {
      cam.panBy(dx, dy);
      this.lastPan = now;
      this.wheelAcc = 0;
      return;
    }
    // At an edge: wait a moment after scrolling (so a fast scroll doesn't skip a page),
    // then one notch (or a trackpad swipe that adds up to one) turns the page.
    if (now - this.lastPan < 350 || now < this.wheelLock) return;
    if (now - this.wheelLast > 300) this.wheelAcc = 0;
    this.wheelLast = now;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    this.wheelAcc += horizontal ? dx : dy;
    if (Math.abs(this.wheelAcc) < 50) return;
    const sign = this.wheelAcc > 0 ? 1 : -1;
    this.wheelAcc = 0;
    this.wheelLock = now + 220;
    if (horizontal) this.step(sideToStep(this.view.direction, sign > 0 ? "right" : "left"));
    else this.step(sign as Step);
  }

  zoomCmd(cmd: ZoomCmd, at?: Pos): void {
    const s = this.center;
    const cam = s.camera;
    const mid = at ?? { x: this.vw / 2, y: this.vh / 2 };
    if (cmd === "in") cam.zoomTo(cam.zoom * 1.25, mid);
    else if (cmd === "out") cam.zoomTo(cam.zoom / 1.25, mid);
    else if (cmd === "reset" || (cmd === "toggle" && cam.zoom > 1.01)) {
      cam.set(startPos(s.base, 1, this.view2(), { atEnd: false, rtl: this.rtl }), 1);
    } else {
      // Toggle in: to original size, or 2x when the fit is already close to original.
      const toOriginal = 1 / s.fit;
      cam.zoomTo(toOriginal > 1.3 ? toOriginal : 2, mid);
    }
    this.zoomed();
  }

  dragStart(pointerType: string): void {
    this.finishTurn();
    const cam = this.center.camera;
    const wide = Math.round(cam.content.w * cam.zoom) > this.vw + 1;
    const swipe = pointerType !== "mouse" && !wide;
    this.drag = { mode: swipe ? "swipe" : "pan", last: { x: 0, y: 0 }, x: 0 };
    if (swipe) this.track.style.transition = "none";
  }

  dragMove(dx: number, dy: number): void {
    const d = this.drag;
    if (!d) return;
    const cam = this.center.camera;
    if (d.mode === "pan") {
      cam.panBy(-(dx - d.last.x), -(dy - d.last.y));
    } else {
      cam.panBy(0, -(dy - d.last.y));
      // Resist when there is nothing on that side.
      const side: Side = dx < 0 ? "right" : "left";
      const room = this.nav.canStep(sideToStep(this.view.direction, side));
      d.x = room ? dx : dx * 0.25;
      this.track.style.transform = `translate3d(${d.x}px,0,0)`;
    }
    d.last = { x: dx, y: dy };
  }

  dragEnd(vx: number): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode !== "swipe") return;
    const far = Math.abs(d.x) > this.vw * 0.25 || Math.abs(vx) > 0.5;
    const side: Side = d.x < 0 ? "right" : "left";
    const dir = sideToStep(this.view.direction, side);
    if (far && Math.sign(d.x) === Math.sign(vx || d.x) && this.nav.canStep(dir)) {
      this.nav.step(dir);
      this.pageChanged();
      this.slideTo(side);
    } else {
      this.track.style.transition = `transform ${TURN_MS}ms ease-out`;
      this.track.style.transform = "translate3d(0,0,0)";
    }
  }

  pinch(phase: "start" | "move" | "end", scale: number, at: Pos): void {
    const cam = this.center.camera;
    if (phase === "start") this.pinchZoom = cam.zoom;
    else if (phase === "move") cam.zoomTo(this.pinchZoom * scale, at);
    this.zoomed();
  }

  // ---------- settings / size ----------

  update(view: ViewSettings, double: boolean, settings: AppSettings): void {
    this.finishTurn();
    const regroup =
      double !== this.double || view.coverAlone !== this.view.coverAlone || view.spreadOffset !== this.view.spreadOffset;
    this.view = view;
    this.double = double;
    this.settings = settings;
    if (regroup) this.nav.setUnits(this.buildUnits());
    this.renderAll();
    this.pageChanged();
  }

  resize(w: number, h: number): void {
    if (w === this.vw && h === this.vh) return;
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.finishTurn();
    this.renderAll();
  }

  destroy(): void {
    this.dead = true;
    clearTimeout(this.sharpTimer);
    this.finishTurn();
    clearTimeout(this.sizeTimer);
    this.unsubscribe();
    for (const s of this.slots) s.camera.stop();
    this.el.remove();
  }

  // ---------- internals ----------

  private get center(): Slot {
    return this.slots[1];
  }

  private get rtl(): boolean {
    return this.view.direction === "rtl";
  }

  private view2(): PageSize & { w: number; h: number } {
    return { w: this.vw, h: this.vh };
  }

  private buildUnits(): number[][] {
    return buildSpreads(this.ctx.count, (i) => this.ctx.cache.size(i), {
      double: this.double,
      coverAlone: this.view.coverAlone,
      offset: this.view.spreadOffset,
    });
  }

  /** Unit index shown in the slot on `side` of the centre. */
  private neighbour(side: Side): number {
    const i = this.nav.index + sideToStep(this.view.direction, side);
    return this.nav.unitAt(i) ? i : -1;
  }

  private renderAll(): void {
    this.track.style.transition = "none";
    this.track.style.transform = "translate3d(0,0,0)";
    this.slots.forEach((s, k) => this.place(s, k - 1));
    this.fill(this.center, this.nav.index, false);
    this.fill(this.slots[0], this.neighbour("left"), this.isBefore("left"));
    this.fill(this.slots[2], this.neighbour("right"), this.isBefore("right"));
  }

  /** Is the slot on this side earlier in reading order (then show its end when we go back)? */
  private isBefore(side: Side): boolean {
    return sideToStep(this.view.direction, side) === -1;
  }

  private place(s: Slot, k: number): void {
    s.el.style.transform = `translate3d(calc(${k * 100}% + ${k * GAP}px),0,0)`;
  }

  private fill(s: Slot, unit: number, atEnd: boolean, keepCamera = false): void {
    s.unit = unit;
    s.atEnd = atEnd;
    const pages = this.nav.unitAt(unit);
    s.el.hidden = !pages;
    if (!pages) {
      s.spread.replaceChildren();
      return;
    }
    const cache = this.ctx.cache;
    const sizes = pages.map((p) => cache.size(p) ?? this.lastKnown);
    const H = Math.max(...sizes.map((z) => z.h));
    const widths = sizes.map((z) => (z.w * H) / z.h);
    const natural = { w: widths.reduce((a, b) => a + b, 0), h: H };
    const f = fitScale(this.view.fit, natural, this.view2());
    s.fit = f;
    s.base = { w: natural.w * f, h: natural.h * f };
    s.spread.style.width = `${s.base.w}px`;
    s.spread.style.height = `${s.base.h}px`;
    s.spread.classList.toggle("rtl", this.rtl);
    s.pageW = new Map(pages.map((p, k) => [p, widths[k] * f]));
    const zoomNow = keepCamera ? s.camera.zoom : 1;
    const children = pages.map((p, k) => {
      const holder = el("div.pg");
      holder.style.width = `${widths[k] * f}px`;
      holder.style.height = `${s.base.h}px`;
      const px = widths[k] * f * zoomNow * dpr();
      const img = cache.get(p);
      if (img && cache.isBroken(p)) holder.append(brokenTile(p));
      else if (img) {
        holder.append(img);
        void cache.load(p, false, px); // a sharper PDF render if this one is too small
      } else {
        holder.append(el("div.spinner"));
        cache.load(p, false, px).then(() => {
          if (!this.dead && s.unit === unit && this.nav.unitAt(unit) === pages) this.refill(s);
        });
      }
      return holder;
    });
    s.spread.replaceChildren(...children);
    const cam = s.camera;
    const zoom = keepCamera ? cam.zoom : 1;
    cam.content = s.base;
    cam.view = this.view2();
    if (keepCamera) cam.set(cam.pos, zoom);
    else cam.set(startPos(s.base, 1, cam.view, { atEnd, rtl: this.rtl }), 1);
  }

  private refill(s: Slot): void {
    this.fill(s, s.unit, s.atEnd, s === this.center && s.camera.zoom !== 1);
  }

  private slideTo(side: Side): void {
    const shift = side === "right" ? -1 : 1;
    this.track.style.transition = `transform ${TURN_MS}ms cubic-bezier(.2,.7,.3,1)`;
    this.track.style.transform = `translate3d(calc(${shift * 100}% + ${shift * GAP}px),0,0)`;
    const done = () => {
      if (!this.turning) return;
      clearTimeout(this.turning.timer);
      this.track.removeEventListener("transitionend", done);
      this.turning = null;
      this.rotate(side);
    };
    this.track.addEventListener("transitionend", done);
    this.turning = { done, timer: window.setTimeout(done, TURN_MS + 80) };
  }

  private finishTurn(): void {
    this.turning?.done();
  }

  /** After moving to the neighbour on `side`: reuse slots so nothing reloads. nav is already updated. */
  private rotate(side: Side): void {
    const [l, c, r] = this.slots;
    this.slots = side === "right" ? [c, r, l] : [r, l, c];
    this.track.style.transition = "none";
    this.track.style.transform = "translate3d(0,0,0)";
    this.slots.forEach((s, k) => this.place(s, k - 1));
    const recycled = side === "right" ? this.slots[2] : this.slots[0];
    const other = side === "right" ? this.slots[0] : this.slots[2];
    const recycledSide: Side = side;
    const otherSide: Side = side === "right" ? "left" : "right";
    this.fill(recycled, this.neighbour(recycledSide), this.isBefore(recycledSide));
    // The old centre becomes a side: reset its zoom and position for when we come back.
    this.fill(other, this.neighbour(otherSide), this.isBefore(otherSide));
    if (this.center.unit !== this.nav.index) this.fill(this.center, this.nav.index, false);
    this.zoomed();
  }

  /** Zoom changed: update the readout, and once it settles, ask for sharper PDF renders. */
  private zoomed(): void {
    this.ctx.onZoom(this.center.camera.zoom);
    clearTimeout(this.sharpTimer);
    this.sharpTimer = window.setTimeout(() => {
      if (this.dead) return;
      const s = this.center;
      for (const [p, w] of s.pageW) void this.ctx.cache.load(p, false, w * s.camera.zoom * dpr());
    }, 150);
  }

  private sharpTimer = 0;

  private pageChanged(): void {
    const cache = this.ctx.cache;
    const shown = this.nav.unit;
    const ahead: number[] = [];
    for (let k = 1; ahead.length < 4 && this.nav.unitAt(this.nav.index + k); k++) {
      ahead.push(...(this.nav.unitAt(this.nav.index + k) ?? []));
    }
    const behind = this.nav.unitAt(this.nav.index - 1) ?? [];
    const neighbours = [...(this.nav.unitAt(this.nav.index + 1) ?? []), ...behind];
    cache.pin([...shown, ...neighbours]);
    for (const p of shown) cache.load(p);
    cache.prefetch([...ahead, ...behind]);
    this.ctx.onPage(this.nav.page);
  }

  private sizeLearned(i: number, size: PageSize): void {
    this.lastKnown = size;
    this.learned.add(i);
    // Batch: many sizes can arrive close together.
    clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => {
      const learned = this.learned;
      this.learned = new Set();
      this.finishTurn();
      const before = this.slots.map((s) => JSON.stringify(this.nav.unitAt(s.unit) ?? null));
      if (this.double) {
        const page = JSON.stringify(this.nav.unit);
        this.nav.setUnits(this.buildUnits());
        if (JSON.stringify(this.nav.unit) !== page) this.pageChanged();
      }
      // Only touch slots whose pages changed, so a preload never moves the page being read.
      this.slots.forEach((s, k) => {
        const side: Side | null = k === 1 ? null : k === 0 ? "left" : "right";
        const unit = side ? this.neighbour(side) : this.nav.index;
        const pages = this.nav.unitAt(unit) ?? [];
        const changed = JSON.stringify(this.nav.unitAt(unit) ?? null) !== before[k];
        if (changed || pages.some((p) => learned.has(p))) {
          this.fill(s, unit, side ? this.isBefore(side) : s.atEnd);
        }
      });
    }, 30);
  }

  private learned = new Set<number>();
  private dead = false;
}

const dpr = () => window.devicePixelRatio || 1;

function brokenTile(page: number): HTMLElement {
  return el("div.broken", {}, svg(icons.broken), el("span", { text: `Page ${page + 1} can't be shown` }));
}
