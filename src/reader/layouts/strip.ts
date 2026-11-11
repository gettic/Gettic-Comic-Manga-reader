// Strip (webtoon / long strip) mode: one vertical column with native scrolling.
// Every page has a box of known height (estimated until its image loads), so nothing jumps;
// when a page above the screen gets its real height, the scroll position is corrected in the
// same frame. Only pages near the screen hold an image.
import type { AppSettings, ViewSettings } from "../../api/types";
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import { sideToStep, type Step } from "../navigator";
import type { PageSize } from "../spreads";
import type { LayoutContext, ReaderLayout, ZoomCmd } from "./layout";

export class StripLayout implements ReaderLayout {
  readonly el: HTMLDivElement;
  private unsubscribe: () => void;
  private col: HTMLDivElement;
  private rail: HTMLDivElement;
  private thumb: HTMLDivElement;
  private items: HTMLDivElement[] = [];
  private tops: number[] = [];
  private heights: number[] = [];
  private total = 0;
  private colW = 1;
  private vw = 1;
  private vh = 1;
  private current = 0;
  private frame = 0;
  private attached = new Set<number>();
  private settings: AppSettings;
  private view: ViewSettings;

  constructor(
    private ctx: LayoutContext,
    view: ViewSettings,
    settings: AppSettings,
    private startPage: number,
    /** Ctrl+wheel / zoom keys change the column width (saved as a setting). */
    private onWidth: (percent: number) => void,
  ) {
    this.view = view;
    this.settings = settings;
    this.col = el("div.strip-col");
    this.thumb = el("div.strip-thumb");
    this.rail = el("div.strip-rail", {}, this.thumb);
    this.el = el("div.strip", {}, this.col);
    for (let i = 0; i < ctx.count; i++) {
      const item = el("div.strip-page", {}, el("div.spinner"));
      this.items.push(item);
      this.col.append(item);
    }
    this.current = startPage;
    this.el.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.unsubscribe = ctx.cache.onSize((i, s) => this.sizeLearned(i, s));
  }

  /** The progress rail lives outside the scroller (the reader puts it in the stage). */
  get railEl(): HTMLElement {
    return this.rail;
  }

  get page(): number {
    return this.current;
  }

  get shown(): number[] {
    return [this.current];
  }

  get zoom(): number {
    return this.settings.stripWidth / 100;
  }

  canStep(dir: Step): boolean {
    return dir > 0 ? this.el.scrollTop + this.vh < this.total - 1 : this.el.scrollTop > 0;
  }

  /** In strip mode a "page" step scrolls 90% of a screen. */
  step(dir: Step): boolean {
    if (!this.canStep(dir)) return false;
    this.el.scrollBy({ top: dir * this.vh * 0.9, behavior: this.smooth });
    return true;
  }

  goTo(page: number): void {
    const p = Math.max(0, Math.min(this.ctx.count - 1, page));
    this.el.scrollTo({ top: this.tops[p] ?? 0 });
    this.update2();
  }

  scroll(amount: number): void {
    this.el.scrollBy({ top: amount * this.vh, behavior: this.smooth });
  }

  wheel(e: WheelEvent): void {
    if (!e.ctrlKey) return; // native scrolling
    e.preventDefault();
    this.setWidth(this.settings.stripWidth * Math.exp(-e.deltaY * 0.0015));
  }

  zoomCmd(cmd: ZoomCmd): void {
    const w = this.settings.stripWidth;
    if (cmd === "in") this.setWidth(w + 10);
    else if (cmd === "out") this.setWidth(w - 10);
    else this.setWidth(cmd === "toggle" && w < 100 ? 100 : 60);
  }

  // Touch scrolls natively; mouse drag does nothing in strip mode.
  dragStart(): void {}
  dragMove(): void {}
  dragEnd(): void {}
  pinch(): void {}

  update(view: ViewSettings, _double: boolean, settings: AppSettings): void {
    const relayout = settings.stripWidth !== this.settings.stripWidth || settings.stripGap !== this.settings.stripGap;
    this.view = view;
    this.settings = settings;
    if (relayout) this.layout(true);
  }

  resize(w: number, h: number): void {
    if (w === this.vw && h === this.vh) return;
    const first = this.vw === 1;
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.layout(!first);
    if (first) this.goTo(this.startPage);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.attached.clear();
    this.unsubscribe();
    this.el.remove();
    this.rail.remove();
  }

  /** Visual left/right: in strip mode they scroll like next/previous, following the direction. */
  side(side: "left" | "right"): void {
    this.step(sideToStep(this.view.direction, side));
  }

  // ---------- internals ----------

  private get smooth(): ScrollBehavior {
    return this.settings.turnAnimation === "instant" ? "auto" : "smooth";
  }

  /** Column width in device pixels (PDF render width). */
  private colPx(): number {
    return this.colW * (window.devicePixelRatio || 1);
  }

  private setWidth(percent: number): void {
    this.onWidth(Math.round(Math.max(30, Math.min(100, percent))));
  }

  /** Estimated height for a page whose size is still unknown: like the pages we know. */
  private guessRatio(): number {
    const known: number[] = [];
    for (let i = 0; i < this.ctx.count && known.length < 8; i++) {
      const s = this.ctx.cache.size(i);
      if (s) known.push(s.h / s.w);
    }
    if (!known.length) return 1.5;
    known.sort((a, b) => a - b);
    return known[known.length >> 1];
  }

  /** Recomputes every box. `keep`: stay on the same spot of the same page. */
  private layout(keep: boolean): void {
    const anchor = keep ? this.anchor() : null;
    this.colW = Math.round((this.vw * this.settings.stripWidth) / 100);
    this.col.style.width = `${this.colW}px`;
    const guess = this.guessRatio();
    const gap = this.settings.stripGap;
    let y = 0;
    for (let i = 0; i < this.ctx.count; i++) {
      const s = this.ctx.cache.size(i);
      const h = Math.round(this.colW * (s ? s.h / s.w : guess));
      this.tops[i] = y;
      this.heights[i] = h;
      const item = this.items[i];
      item.style.height = `${h}px`;
      item.style.transform = `translate3d(0,${y}px,0)`;
      y += h + gap;
    }
    this.total = Math.max(0, y - gap);
    this.col.style.height = `${this.total}px`;
    if (anchor) this.el.scrollTop = this.tops[anchor.page] + anchor.frac * this.heights[anchor.page];
    // Wider column: PDF pages on screen get a sharper render.
    for (const i of this.attached) void this.ctx.cache.load(i, false, this.colPx());
    this.update2();
  }

  private anchor(): { page: number; frac: number } {
    const top = this.el.scrollTop;
    const p = this.indexAt(top);
    return { page: p, frac: this.heights[p] ? (top - this.tops[p]) / this.heights[p] : 0 };
  }

  private indexAt(y: number): number {
    let lo = 0;
    let hi = this.ctx.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update2();
    });
  }

  /** Attach images near the screen, drop far ones, report the current page, move the rail. */
  private update2(): void {
    const top = this.el.scrollTop;
    const cache = this.ctx.cache;
    const first = this.indexAt(Math.max(0, top - this.vh));
    const last = this.indexAt(top + this.vh * 3);
    const keepFirst = this.indexAt(Math.max(0, top - this.vh * 2));
    const keepLast = this.indexAt(top + this.vh * 4);
    for (const i of [...this.attached]) {
      if (i < keepFirst || i > keepLast) {
        this.items[i].replaceChildren(el("div.spinner"));
        this.attached.delete(i);
      }
    }
    const want: number[] = [];
    for (let i = first; i <= last; i++) want.push(i);
    cache.pin(want);
    for (const i of want) {
      if (this.attached.has(i)) continue;
      this.attached.add(i);
      const img = cache.get(i);
      if (img) {
        this.show(i, img);
        void cache.load(i, false, this.colPx()); // a sharper PDF render if this one is too small
      } else cache.load(i, false, this.colPx()).then((im) => this.attached.has(i) && this.show(i, im));
    }
    cache.prefetch([last + 1, last + 2, first - 1]);
    const cur = this.indexAt(top + this.vh * 0.3);
    if (cur !== this.current) {
      this.current = cur;
      this.ctx.onPage(cur);
    }
    const max = Math.max(1, this.total - this.vh);
    const frac = Math.min(1, top / max);
    const th = Math.max(24, (this.vh / Math.max(this.total, 1)) * 100);
    this.thumb.style.height = `${Math.min(100, th)}%`;
    this.thumb.style.transform = `translate3d(0, ${frac * (100 / Math.min(100, th) - 1) * 100}%, 0)`;
  }

  private show(i: number, img: HTMLImageElement): void {
    const item = this.items[i];
    if (this.ctx.cache.isBroken(i)) item.replaceChildren(el("div.broken", {}, svg(icons.broken), el("span", { text: `Page ${i + 1} can't be shown` })));
    else item.replaceChildren(img);
  }

  private sizeLearned(i: number, s: PageSize): void {
    const h = Math.round(this.colW * (s.h / s.w));
    const d = h - this.heights[i];
    if (!d) return;
    // Re-guess the unknown pages too (the first real sizes tell us what the strip looks like),
    // anchored to the spot being read, so whatever changes above it, the view does not move.
    this.layout(true);
  }
}
