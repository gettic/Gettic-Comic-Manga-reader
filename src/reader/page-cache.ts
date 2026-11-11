// Loads and decodes page images ahead of time and keeps the most recent ones (LRU).
// Visible pages load right away; preloads go one at a time at low priority, so they never
// slow down the page you're looking at.
// Rendered comics (PDF): each page is asked for at the width it is shown at (device px, rounded
// up to a 256 step); when zoom or fit makes it bigger, a sharper render replaces it in place.
import { pdfWidthStep } from "../api/comics";
import type { PageSize } from "./spreads";

interface Entry {
  img: HTMLImageElement;
  promise: Promise<HTMLImageElement>;
  ready: boolean;
  broken: boolean;
  /** Render width this image was asked for (0 = not a rendered comic). */
  px: number;
  /** Bigger render on its way (0 = none). */
  upgrading: number;
}

/** Device-pixel width to ask a PDF page at: shown CSS width x zoom x devicePixelRatio, 256 steps up. */
export function renderWidth(cssWidth: number, zoom: number, dpr: number): number {
  return pdfWidthStep(cssWidth * zoom * dpr);
}

/** A loaded render is too small when the wanted width rounds up to a bigger step. */
export function needsSharper(loadedPx: number, wantedPx: number): boolean {
  return loadedPx > 0 && pdfWidthStep(wantedPx) > loadedPx;
}

/**
 * Width a new PDF render is asked at: the width it was asked for, else the width pages are shown at
 * in the current layout (so preloads match, e.g. a Book half), else the last one asked for.
 */
export function startWidth(wanted: number, layoutPx: number, lastPx: number): number {
  return wanted || layoutPx || lastPx || pdfWidthStep(1600);
}

export interface CacheOptions {
  /** PDF: page URLs take a width; sizes come from the core, not from the rendered image. */
  rendered: boolean;
}

export class PageCache {
  private entries = new Map<number, Entry>(); // insertion order = least recently used first
  private queue: number[] = [];
  private lowBusy = false;
  private pinned = new Set<number>();
  private sizes = new Map<number, PageSize>();
  private dead = false;
  private lastPx = 0;
  private layoutPx = 0;
  private sizeListeners = new Set<(index: number, size: PageSize) => void>();

  /** Calls `fn` whenever a page's real size becomes known. Returns the unsubscribe function. */
  onSize(fn: (index: number, size: PageSize) => void): () => void {
    this.sizeListeners.add(fn);
    return () => this.sizeListeners.delete(fn);
  }

  constructor(
    private url: (index: number, devicePx?: number) => string,
    private count: number,
    private capacity: number,
    known: (index: number) => PageSize | undefined,
    private opts: CacheOptions = { rendered: false },
  ) {
    for (let i = 0; i < count; i++) {
      const s = known(i);
      if (s) this.sizes.set(i, s);
    }
  }

  size(i: number): PageSize | undefined {
    return this.sizes.get(i);
  }

  /** The decoded image if it is ready (or broken), else undefined. */
  get(i: number): HTMLImageElement | undefined {
    const e = this.entries.get(i);
    if (!e || !e.ready) return undefined;
    this.touch(i, e);
    return e.img;
  }

  isBroken(i: number): boolean {
    return this.entries.get(i)?.broken ?? false;
  }

  /**
   * Loads now (high priority). Resolves when decoded, or with a broken image on error.
   * `devicePx`: the width the page is shown at (rendered comics only); a sharper render is
   * fetched when it is bigger than what is loaded.
   */
  load(i: number, low = false, devicePx?: number): Promise<HTMLImageElement> {
    const want = this.opts.rendered && devicePx ? pdfWidthStep(devicePx) : 0;
    if (want) this.lastPx = want;
    const have = this.entries.get(i);
    if (have) {
      this.touch(i, have);
      if (!low) have.img.fetchPriority = "high";
      if (want && have.ready && !have.broken && needsSharper(have.px, want)) this.sharpen(i, have, want);
      return have.promise;
    }
    const px = this.opts.rendered ? startWidth(want, this.layoutPx, this.lastPx) : 0;
    const img = this.newImage(low);
    const entry = { img, ready: false, broken: false, px, upgrading: 0 } as Entry;
    entry.promise = new Promise<HTMLImageElement>((resolve) => {
      const done = (broken: boolean) => {
        entry.ready = true;
        entry.broken = broken;
        // Rendered pages keep the core's size (their pixel size is just the render width).
        const fixed = this.opts.rendered && this.sizes.has(i);
        if (!broken && !fixed && img.naturalWidth > 0) {
          const s = { w: img.naturalWidth, h: img.naturalHeight };
          const old = this.sizes.get(i);
          if (!old || old.w !== s.w || old.h !== s.h) {
            this.sizes.set(i, s);
            if (!this.dead) for (const fn of this.sizeListeners) fn(i, s);
          }
        }
        resolve(img);
      };
      img.src = this.url(i, px || undefined);
      img.decode().then(
        () => done(false),
        () => done(!(img.complete && img.naturalWidth > 0)),
      );
    });
    this.entries.set(i, entry);
    this.evict();
    return entry.promise;
  }

  /** The device-px width pages are shown at now (rendered comics): preloads are asked at this width. */
  setShownWidth(devicePx: number): void {
    this.layoutPx = devicePx > 0 ? pdfWidthStep(devicePx) : 0;
  }

  /** Replaces the preload list (in priority order). Loaded one at a time. */
  prefetch(indices: number[]): void {
    this.queue = indices.filter((i) => i >= 0 && i < this.count && !this.entries.has(i));
    this.pump();
  }

  /** Pages on screen are never evicted. */
  pin(indices: number[]): void {
    this.pinned = new Set(indices);
  }

  destroy(): void {
    this.dead = true;
    this.queue = [];
    this.sizeListeners.clear();
    for (const e of this.entries.values()) if (!e.img.isConnected) e.img.removeAttribute("src");
    this.entries.clear();
  }

  private newImage(low: boolean): HTMLImageElement {
    const img = new Image();
    img.decoding = "async";
    img.fetchPriority = low ? "low" : "high";
    img.draggable = false;
    img.alt = "";
    return img;
  }

  /** Loads a bigger render and swaps it in where the old one is shown, once decoded. */
  private sharpen(i: number, e: Entry, px: number): void {
    if (e.upgrading >= px) return;
    e.upgrading = px;
    const img = this.newImage(false);
    img.src = this.url(i, px);
    img.decode().then(
      () => {
        if (e.upgrading === px) e.upgrading = 0;
        if (this.dead || this.entries.get(i) !== e || px <= e.px) return;
        const old = e.img;
        e.img = img;
        e.px = px;
        if (old.isConnected) old.replaceWith(img);
        old.removeAttribute("src");
      },
      () => {
        if (e.upgrading === px) e.upgrading = 0;
      },
    );
  }

  private pump(): void {
    if (this.lowBusy || this.dead) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    this.lowBusy = true;
    this.load(next, true).finally(() => {
      this.lowBusy = false;
      this.pump();
    });
  }

  private touch(i: number, e: Entry): void {
    this.entries.delete(i);
    this.entries.set(i, e);
  }

  private evict(): void {
    if (this.entries.size <= this.capacity) return;
    for (const [i, e] of this.entries) {
      if (this.entries.size <= this.capacity) break;
      if (this.pinned.has(i) || !e.ready || e.img.isConnected) continue;
      e.img.removeAttribute("src");
      this.entries.delete(i);
    }
  }
}
