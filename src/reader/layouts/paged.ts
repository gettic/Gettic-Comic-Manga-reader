// Single, double and book mode. Three slots (left / centre / right, in screen order) sit side by
// side in a track; a page turn slides the track with a CSS transform, then the slots rotate so
// no image is reloaded. Neighbours are filled ahead of time with decoded images.
// Book mode: a fixed two-page box around a spine, the book look (CSS), and a 3D page flip that
// uses the already-filled neighbour slot (lift the current half, then lay down the next one).
import type { AppSettings, ViewSettings } from "../../api/types";
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import { Camera, startPos, type Pos } from "../camera";
import { measureUnit } from "../measure";
import { stepToSide, sideToStep, UnitNavigator, type Side, type Step } from "../navigator";
import { bookSide, edgeWidths, flipPose, singleBookSide } from "../book";
import { BusyGate } from "../busy-gate";
import { buildSpreads, isWide, type PageSize } from "../spreads";
import type { LayoutContext, ReaderLayout, ZoomCmd } from "./layout";

const GAP = 24; // px between slots while sliding
const TURN_MS = 180;
const FLIP_MS = 450;
const PERSPECTIVE = "perspective(3600px)";
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
  /** Book mode: the left and right halves on screen (a page or an empty spacer). */
  halves: { l?: HTMLElement; r?: HTMLElement };
}

interface FlipState {
  side: Side;
  dir: Step;
  cur: Slot;
  nxt: Slot;
  turnEl: HTMLElement;
  landEl: HTMLElement;
  p: number;
  raf: number;
  /** Started by a key/click (already stepped) rather than a finger drag. */
  auto: boolean;
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
  private drag: { mode: "pan" | "swipe" | "flip"; last: Pos; x: number } | null = null;
  private flip: FlipState | null = null;
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
      return { el: slotEl, spread, camera: new Camera(spread), unit: -1, atEnd: false, base: DEFAULT_SIZE, fit: 1, pageW: new Map(), halves: {} };
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
    if (this.canFlip(side)) {
      this.startFlip(side, dir, true);
      this.playFlip(1, FLIP_MS);
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
    const flip = swipe && this.isBook() && this.settings.turnAnimation !== "instant";
    this.drag = { mode: flip ? "flip" : swipe ? "swipe" : "pan", last: { x: 0, y: 0 }, x: 0 };
    if (swipe) this.track.style.transition = "none";
  }

  dragMove(dx: number, dy: number): void {
    const d = this.drag;
    if (!d) return;
    const cam = this.center.camera;
    if (d.mode === "flip") {
      // The page follows the finger: dragging left lifts the right-hand page.
      if (!this.flip) {
        if (Math.abs(dx) < 4) return;
        const side: Side = dx < 0 ? "right" : "left";
        const dir = sideToStep(this.view.direction, side);
        if (!this.nav.canStep(dir) || !this.canFlip(side)) return;
        this.startFlip(side, dir, false);
      }
      const f = this.flip!;
      const toward = f.side === "right" ? -dx : dx;
      this.poseFlip(Math.max(0, Math.min(1, toward / (this.vw * 0.5))));
    } else if (d.mode === "pan") {
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
    if (d && d.mode === "flip") {
      const f = this.flip;
      if (!f) this.gate.release(); // the finger never started a flip
      if (!f || f.auto) return;
      const fling = (f.side === "right" ? -vx : vx) > 0.5;
      const commit = f.p > 0.35 || fling;
      this.playFlip(commit ? 1 : 0, FLIP_MS * (commit ? 1 - f.p : f.p) + 60);
      return;
    }
    if (!d || d.mode !== "swipe") {
      this.gate.release();
      return;
    }
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
      this.gate.release(); // snapped back: nothing turned
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
    const before = JSON.stringify(this.unitOptions());
    this.view = view;
    this.double = double;
    this.settings = settings;
    if (JSON.stringify(this.unitOptions()) !== before) this.nav.setUnits(this.buildUnits());
    this.renderAll();
    this.pageChanged();
  }

  resize(w: number, h: number): void {
    if (w === this.vw && h === this.vh) return;
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.finishTurn();
    this.renderAll();
    this.loadAround(); // the first real size: now the shown widths are known
  }

  destroy(): void {
    this.dead = true;
    this.gate.clear();
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

  /** Book view: two pages around a spine (falls back to single pages on a narrow window). */
  private isBook(): boolean {
    return this.view.layout === "book" && this.double;
  }

  /** The book look (spine, page edges, margin): Book view, also when it falls back to single pages. */
  private bookLook(): boolean {
    return this.view.layout === "book";
  }

  private unitOptions() {
    return {
      double: this.double,
      // A book always starts with its cover alone.
      coverAlone: this.isBook() || this.view.coverAlone,
      offset: this.view.spreadOffset,
    };
  }

  private buildUnits(): number[][] {
    return buildSpreads(this.ctx.count, (i) => this.ctx.cache.size(i), this.unitOptions());
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
    s.halves = {};
    if (!pages) {
      s.spread.replaceChildren();
      return;
    }
    const cache = this.ctx.cache;
    const { sizes, widths, book, pos, lone, natural, f, ready } = this.measure(unit, pages);
    // Book view on a narrow window: one page at a time, still with the spine and page edges.
    const narrowBook = !book && this.bookLook() && pages.length === 1;
    s.fit = f;
    s.base = { w: natural.w * f, h: natural.h * f };
    s.spread.style.width = `${s.base.w}px`;
    s.spread.style.height = `${s.base.h}px`;
    s.spread.classList.toggle("rtl", this.rtl);
    s.spread.classList.toggle("book", book || narrowBook);
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
        if (ready) void cache.load(p, false, px); // a sharper PDF render if this one is too small
      } else {
        holder.append(el("div.spinner"));
        // Not measured yet (before the window size is known): resize fills it again.
        if (ready) cache.load(p, false, px).then(() => {
          // Not during a turn: replacing a turning page would cut the slide/flip short.
          this.gate.run(s, () => {
            if (!this.dead && s.unit === unit && this.nav.unitAt(unit) === pages) this.refill(s);
          });
        });
      }
      return holder;
    });
    let halves: HTMLElement[] = children;
    if (lone) {
      const spacer = el("div.pg.spacer");
      spacer.style.width = `${widths[0] * f}px`;
      spacer.style.height = `${s.base.h}px`;
      halves = pos === "first" ? [children[0], spacer] : [spacer, children[0]];
    }
    const extra: HTMLElement[] = [];
    if (book && pos !== "span") {
      // Halves are in reading order; with right-to-left the first one is on the right.
      halves.forEach((h, k) => (h.dataset.vis = (k === 0) !== this.rtl ? "l" : "r"));
      s.halves = { l: halves.find((h) => h.dataset.vis === "l"), r: halves.find((h) => h.dataset.vis === "r") };
      const e = edgeWidths(pages[0], pages[pages.length - 1], this.ctx.count);
      const leftW = this.rtl ? e.after : e.before;
      const rightW = this.rtl ? e.before : e.after;
      if (leftW && !s.halves.l?.classList.contains("spacer")) extra.push(edge("l", leftW));
      if (rightW && !s.halves.r?.classList.contains("spacer")) extra.push(edge("r", rightW));
    } else if (narrowBook) {
      const vis = singleBookSide(pages[0], isWide(sizes[0]), this.rtl);
      if (vis) {
        children[0].dataset.vis = vis; // spine shading on the bound side
        // Page edges on the outer side: the pages still to come beside a right-hand page (LTR).
        const e = edgeWidths(pages[0], pages[0], this.ctx.count);
        const w = (vis === "r") !== this.rtl ? e.after : e.before;
        if (w) extra.push(edge(vis, w));
      }
    }
    s.spread.replaceChildren(...halves, ...extra);
    const cam = s.camera;
    const zoom = keepCamera ? cam.zoom : 1;
    cam.content = s.base;
    cam.view = this.view2();
    if (keepCamera) cam.set(cam.pos, zoom);
    else cam.set(startPos(s.base, 1, cam.view, { atEnd, rtl: this.rtl }), 1);
  }

  /** Page widths and fit scale of a unit (no DOM): used by fill and for PDF render widths. */
  private measure(unit: number, pages: number[]) {
    const sizes = pages.map((p) => this.ctx.cache.size(p) ?? this.lastKnown);
    // Book: a lone page keeps a two-page box (empty half beside it), so the spine never moves.
    const book = this.isBook();
    const pos = book ? bookSide(unit, pages.length, pages.length === 1 && isWide(sizes[0])) : null;
    const lone = pos === "first" || pos === "second";
    const m = measureUnit(sizes, { fit: this.view.fit, bookLook: this.bookLook(), lone, vw: this.vw, vh: this.vh });
    return { sizes, book, pos, lone, ...m };
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
    const f = this.flip;
    if (f) this.endFlip(f.auto);
  }

  // ---------- book page flip ----------

  /** A flip needs two halves on both the current spread and the one it turns to. */
  private canFlip(side: Side): boolean {
    if (!this.isBook()) return false;
    const nxt = side === "right" ? this.slots[2] : this.slots[0];
    const c = this.center.halves;
    return !!(c.l && c.r && nxt.unit >= 0 && nxt.halves.l && nxt.halves.r);
  }

  private startFlip(side: Side, dir: Step, auto: boolean): void {
    const cur = this.center;
    const nxt = side === "right" ? this.slots[2] : this.slots[0];
    // Turning a page resets the zoom (both spreads start at the top, at fit size).
    cur.camera.set(startPos(cur.base, 1, this.view2(), { atEnd: false, rtl: this.rtl }), 1);
    nxt.camera.set(startPos(nxt.base, 1, this.view2(), { atEnd: false, rtl: this.rtl }), 1);
    this.track.style.transition = "none";
    this.track.style.transform = "translate3d(0,0,0)";
    this.place(nxt, 0);
    const turnEl = (side === "right" ? cur.halves.r : cur.halves.l)!;
    const landEl = (side === "right" ? nxt.halves.l : nxt.halves.r)!;
    turnEl.style.transformOrigin = side === "right" ? "left center" : "right center";
    landEl.style.transformOrigin = side === "right" ? "right center" : "left center";
    turnEl.classList.add("flipping");
    landEl.classList.add("flipping");
    this.flip = { side, dir, cur, nxt, turnEl, landEl, p: 0, raf: 0, auto };
    this.poseFlip(0);
  }

  private poseFlip(p: number): void {
    const f = this.flip;
    if (!f) return;
    f.p = p;
    const q = flipPose(p, f.side);
    const edgeOn = f.side === "right" ? 90 : -90;
    f.turnEl.style.transform = `${PERSPECTIVE} rotateY(${q.turn ?? -edgeOn}deg)`;
    f.landEl.style.transform = `${PERSPECTIVE} rotateY(${q.land ?? edgeOn}deg)`;
    f.turnEl.style.setProperty("--shade", String(q.shadeTurn));
    f.landEl.style.setProperty("--shade", String(q.shadeLand));
    f.cur.el.style.zIndex = q.top === "current" ? "2" : "1";
    f.nxt.el.style.zIndex = q.top === "next" ? "2" : "1";
  }

  /** Animates the flip to 0 (back) or 1 (turned), one transform write per frame. */
  private playFlip(to: 0 | 1, ms: number): void {
    const f = this.flip;
    if (!f) return;
    cancelAnimationFrame(f.raf);
    const from = f.p;
    const t0 = performance.now();
    const tick = (t: number) => {
      if (this.flip !== f) return;
      const k = Math.min(1, (t - t0) / Math.max(1, ms));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.poseFlip(from + (to - from) * e);
      if (k < 1) f.raf = requestAnimationFrame(tick);
      else this.endFlip(to === 1);
    };
    f.raf = requestAnimationFrame(tick);
  }

  private endFlip(commit: boolean): void {
    const f = this.flip;
    if (!f) return;
    this.flip = null;
    cancelAnimationFrame(f.raf);
    for (const el of [f.turnEl, f.landEl]) {
      el.style.transform = "";
      el.style.transformOrigin = "";
      el.style.removeProperty("--shade");
      el.classList.remove("flipping");
    }
    f.cur.el.style.zIndex = "";
    f.nxt.el.style.zIndex = "";
    if (commit) {
      if (!f.auto) {
        this.nav.step(f.dir);
        this.pageChanged();
      }
      this.rotate(f.side);
    } else {
      this.slots.forEach((s, k) => this.place(s, k - 1));
      this.gate.release();
    }
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
    this.gate.release(); // the turn is over: apply sizes / images that arrived during it
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
    this.loadAround();
    this.ctx.onPage(this.nav.page);
  }

  /** Loads the shown pages and preloads the next ones, at the widths they are shown at. */
  private loadAround(): void {
    const cache = this.ctx.cache;
    const shown = this.nav.unit;
    const ahead: number[] = [];
    for (let k = 1; ahead.length < 4 && this.nav.unitAt(this.nav.index + k); k++) {
      ahead.push(...(this.nav.unitAt(this.nav.index + k) ?? []));
    }
    const behind = this.nav.unitAt(this.nav.index - 1) ?? [];
    const neighbours = [...(this.nav.unitAt(this.nav.index + 1) ?? []), ...behind];
    cache.pin([...shown, ...neighbours]);
    if (!shown.length) return;
    // PDF: ask at the width each page is shown at (a Book half is about half the window);
    // preloads use the widest page of this spread, as the next ones are laid out the same way.
    const { widths, f, ready } = this.measure(this.nav.index, shown);
    if (!ready) return; // before the window is measured: resize calls this again
    cache.setShownWidth(Math.max(...widths) * f * dpr());
    shown.forEach((p, k) => void cache.load(p, false, widths[k] * f * dpr()));
    cache.prefetch([...ahead, ...behind]);
  }

  private sizeLearned(i: number, size: PageSize): void {
    this.lastKnown = size;
    this.learned.add(i);
    // Batch: many sizes can arrive close together.
    clearTimeout(this.sizeTimer);
    this.sizeTimer = window.setTimeout(() => this.gate.run("sizes", () => this.applySizes()), 30);
  }

  /** Relayout after real page sizes arrived. Never during a turn (see BusyGate). */
  private applySizes(): void {
    if (this.dead) return;
    {
      const learned = this.learned;
      this.learned = new Set();
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
    }
  }

  private learned = new Set<number>();
  private dead = false;
  private gate = new BusyGate(
    () => this.turning !== null || this.flip !== null || (this.drag !== null && this.drag.mode !== "pan"),
  );
}

const dpr = () => window.devicePixelRatio || 1;

/** A stack of page edges at the outer side of the book. */
function edge(side: "l" | "r", width: number): HTMLElement {
  const e = el(`div.edge.${side}`);
  e.style.width = `${width}px`;
  return e;
}

function brokenTile(page: number): HTMLElement {
  return el("div.broken", {}, svg(icons.broken), el("span", { text: `Page ${page + 1} can't be shown` }));
}
