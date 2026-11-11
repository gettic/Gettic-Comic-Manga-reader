// The reader screen: owns the layout, input, chrome, saving of progress and view settings.
import {
  closeComic,
  isFullscreen,
  pageUrl,
  setComicView,
  setFullscreen,
  setProgress,
  type AppSettings,
  type ComicInfo,
  type ViewSettings,
} from "../api";
import { sanitizeView, viewAsDefault } from "../settings/defaults";
import { el } from "../ui/dom";
import { toast } from "../ui/toast";
import type { Pos } from "./camera";
import { BottomBar } from "./chrome/bottombar";
import { closeHelp, isHelpOpen, toggleHelp } from "./chrome/help";
import type { ChromeHost, ChromeState } from "./chrome/host";
import { closeMenu, isMenuOpen } from "./chrome/menus";
import { TopBar } from "./chrome/topbar";
import { looksLikeBook } from "./book";
import { looksLikeWebtoon } from "./detect";
import { attachGestures } from "./input/pointer";
import { commandForKey, type Command } from "./input/keys";
import type { ReaderLayout } from "./layouts/layout";
import { PagedLayout } from "./layouts/paged";
import { StripLayout } from "./layouts/strip";
import { sideToStep, type Side } from "./navigator";
import { PageCache } from "./page-cache";

export interface ReaderContext {
  settings(): AppSettings;
  updateSettings(patch: Partial<AppSettings>): void;
  /** Leave the reader (back to the start screen). */
  back(): void;
  pick(kind: "file" | "folder"): void;
}

const EDGE_SHOW = 90; // px from the top/bottom where the mouse brings the controls back

export class Reader implements ChromeHost {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private top: TopBar;
  private bottom: BottomBar;
  private layout!: ReaderLayout;
  private cache: PageCache;
  private view: ViewSettings;
  private page: number;
  private fullscreen = false;
  private chromeShown = true;
  private chromeSticky = false;
  private pinned = false;
  private hideTimer = 0;
  private saveTimer = 0;
  private middleTimer = 0;
  private detectPending: boolean;
  private stageW = 1;
  private stageH = 1;
  private cleanup: (() => void)[] = [];
  private closed = false;

  constructor(
    private comic: ComicInfo,
    private ctx: ReaderContext,
  ) {
    this.view = sanitizeView(comic.view, ctx.settings().defaults);
    this.page = Math.max(0, Math.min(comic.pages.length - 1, comic.lastPage));
    this.detectPending = comic.view === undefined;

    const sized = comic.pages.map((p) => (p.width && p.height ? { w: p.width, h: p.height } : undefined));
    // PDF: the layouts pass each page's shown width; sizes stay the core's (96 dpi) for "original".
    this.cache = new PageCache((i, px) => pageUrl(comic, i, px), comic.pages.length, 16, (i) => sized[i], {
      rendered: comic.isRendered,
    });
    if (this.detectPending && ctx.settings().pdfAsBook && looksLikeBook(sized.slice(0, 8), comic.kind)) {
      // First open of a portrait PDF: a book (cover alone, two pages, page flip).
      this.view = { ...this.view, layout: "book", coverAlone: true };
      this.detectPending = false;
    }
    if (this.detectPending && looksLikeWebtoon(sized.slice(0, 5))) {
      this.view = { ...this.view, layout: "strip" };
      this.detectPending = false;
    }

    this.stage = el("div.stage");
    this.top = new TopBar(this);
    this.bottom = new BottomBar(this);
    this.el = el("div.reader", {}, this.stage, this.top.el, this.bottom.el);
    this.applyBackground();

    this.cleanup.push(this.cache.onSize(() => this.detect()));
    this.buildLayout();
    this.wireInput();
    this.flashChrome();
    void isFullscreen().then((f) => {
      this.fullscreen = f;
      this.refreshChrome();
    });
  }

  /** Called once the element is in the document (sizes are known then). */
  mounted(): void {
    const ro = new ResizeObserver(() => this.resized());
    ro.observe(this.stage);
    this.cleanup.push(() => ro.disconnect());
    this.resized();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.flushView();
    closeMenu();
    closeHelp();
    clearTimeout(this.hideTimer);
    clearTimeout(this.middleTimer);
    for (const f of this.cleanup) f();
    this.layout.destroy();
    this.cache.destroy();
    this.el.remove();
    document.body.classList.remove("hide-cursor");
    if (this.fullscreen) void setFullscreen(false).catch(() => {});
    try {
      await closeComic(this.comic.id);
    } catch {
      /* already closed */
    }
  }

  // ---------- ChromeHost ----------

  settings(): AppSettings {
    return this.ctx.settings();
  }

  updateSettings(patch: Partial<AppSettings>): void {
    this.ctx.updateSettings(patch);
    this.applyBackground();
    this.layout.update(this.view, this.effectiveDouble(), this.settings());
    this.refreshChrome();
  }

  saveAsDefault(): void {
    this.ctx.updateSettings({ defaults: viewAsDefault(this.view) });
    toast("Saved as the default for new comics");
  }

  back(): void {
    this.ctx.back();
  }

  goToPage(page: number): void {
    this.layout.goTo(Math.max(0, Math.min(this.comic.pages.length - 1, page)));
  }

  setPinned(on: boolean): void {
    this.pinned = on;
    if (on) this.showChrome(true);
    else this.armHide();
  }

  run(cmd: Command): void {
    const L = this.layout;
    const strip = L instanceof StripLayout;
    const count = this.comic.pages.length;
    switch (cmd) {
      case "visualLeft":
      case "visualRight": {
        const side: Side = cmd === "visualLeft" ? "left" : "right";
        if (L instanceof StripLayout) L.side(side);
        else L.step(sideToStep(this.view.direction, side));
        break;
      }
      case "next":
        if (strip) L.step(1);
        else L.scroll(0.9);
        break;
      case "prev":
        if (strip) L.step(-1);
        else L.scroll(-0.9);
        break;
      case "scrollDown":
        L.scroll(0.2);
        break;
      case "scrollUp":
        L.scroll(-0.2);
        break;
      case "first":
        L.goTo(0);
        break;
      case "last":
        L.goTo(count - 1);
        break;
      case "jumpLeft":
      case "jumpRight":
        L.goTo(Math.max(0, Math.min(count - 1, this.page + 10 * sideToStep(this.view.direction, cmd === "jumpLeft" ? "left" : "right"))));
        break;
      case "layoutSingle":
        this.setView({ layout: "single" });
        break;
      case "layoutDouble":
        this.setView({ layout: "double" });
        break;
      case "layoutBook":
        this.setView({ layout: "book" });
        break;
      case "layoutStrip":
        this.setView({ layout: "strip" });
        break;
      case "toggleDirection":
        this.setView({ direction: this.view.direction === "rtl" ? "ltr" : "rtl" });
        toast(this.view.direction === "rtl" ? "Right to left" : "Left to right");
        break;
      case "fitWidth":
        this.setView({ fit: "width" });
        break;
      case "fitHeight":
        this.setView({ fit: "height" });
        break;
      case "fitPage":
        this.setView({ fit: "page" });
        break;
      case "fitOriginal":
        this.setView({ fit: "original" });
        break;
      case "zoomIn":
        L.zoomCmd("in");
        break;
      case "zoomOut":
        L.zoomCmd("out");
        break;
      case "zoomReset":
        L.zoomCmd("reset");
        break;
      case "coverAlone":
        this.setView({ coverAlone: !this.view.coverAlone });
        toast(this.view.coverAlone ? "Cover shown alone" : "Cover paired");
        break;
      case "shiftLeft":
      case "shiftRight":
        this.setView({ spreadOffset: this.view.spreadOffset ? 0 : 1 });
        toast("Page pairing shifted");
        break;
      case "goTo":
        this.showChrome(true);
        this.bottom.openGoTo();
        break;
      case "fullscreen":
        void this.toggleFullscreen();
        break;
      case "escape":
        if (closeMenu() || closeHelp()) break;
        if (this.fullscreen) void this.toggleFullscreen();
        else this.back();
        break;
      case "toggleChrome":
        if (this.chromeShown) this.hideChrome();
        else this.showChrome(true);
        break;
      case "openFile":
        this.ctx.pick("file");
        break;
      case "openFolder":
        this.ctx.pick("folder");
        break;
      case "help":
        toggleHelp();
        break;
    }
  }

  // ---------- view ----------

  private setView(patch: Partial<ViewSettings>): void {
    const old = this.view;
    this.view = { ...old, ...patch };
    this.detectPending = false; // the user chose; don't switch modes behind their back
    if ((old.layout === "strip") !== (this.view.layout === "strip")) this.buildLayout();
    else this.layout.update(this.view, this.effectiveDouble(), this.settings());
    this.refreshChrome();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.flushView(), 500);
  }

  private flushView(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    setComicView(this.comic.id, this.view).catch(() => {});
  }

  private effectiveDouble(): boolean {
    if (this.view.layout !== "double" && this.view.layout !== "book") return false;
    return !(this.settings().autoSingleWhenPortrait && this.stageW < this.stageH);
  }

  private buildLayout(): void {
    const page = this.layout ? this.layout.page : this.page;
    this.layout?.destroy();
    const lctx = {
      count: this.comic.pages.length,
      cache: this.cache,
      onPage: (p: number) => this.pageChanged(p),
      onZoom: () => this.refreshChrome(),
    };
    if (this.view.layout === "strip") {
      const strip = new StripLayout(lctx, this.view, this.settings(), page, (w) => this.updateSettings({ stripWidth: w }));
      this.layout = strip;
      this.stage.replaceChildren(strip.el, strip.railEl);
    } else {
      this.layout = new PagedLayout(lctx, this.view, this.effectiveDouble(), this.settings(), page);
      this.stage.replaceChildren(this.layout.el);
    }
    this.stage.classList.toggle("is-strip", this.view.layout === "strip");
    if (this.stageW > 1) this.layout.resize(this.stageW, this.stageH);
    this.layout.update(this.view, this.effectiveDouble(), this.settings());
    this.refreshChrome();
  }

  private resized(): void {
    const r = this.stage.getBoundingClientRect();
    const wasDouble = this.effectiveDouble();
    this.stageW = Math.round(r.width);
    this.stageH = Math.round(r.height);
    this.layout.resize(this.stageW, this.stageH);
    if (this.effectiveDouble() !== wasDouble) this.layout.update(this.view, this.effectiveDouble(), this.settings());
    this.refreshChrome();
  }

  /** First open of a comic with very tall pages: switch to strip mode once. */
  private detect(): void {
    if (!this.detectPending) return;
    const sizes = [];
    for (let i = this.page; i < Math.min(this.comic.pages.length, this.page + 5); i++) sizes.push(this.cache.size(i));
    if (sizes.filter(Boolean).length < Math.min(3, this.comic.pages.length)) return;
    this.detectPending = false;
    if (looksLikeWebtoon(sizes) && this.view.layout !== "strip") {
      this.view = { ...this.view, layout: "strip" };
      this.buildLayout();
      toast("Long-strip pages: switched to Strip mode (press 1 for single pages)");
    }
  }

  private pageChanged(page: number): void {
    if (page === this.page && this.layout) {
      this.refreshChrome();
      return;
    }
    this.page = page;
    setProgress(this.comic.id, page).catch(() => {});
    this.refreshChrome();
  }

  private applyBackground(): void {
    this.el.classList.toggle("bg-grey", this.settings().background === "grey");
  }

  private chromeState(): ChromeState {
    const kind = this.comic.kind === "folder" ? "Folder" : this.comic.kind.toUpperCase();
    return {
      title: this.comic.title,
      sub: `${kind} · ${this.comic.pages.length} pages`,
      view: this.view,
      double: this.effectiveDouble(),
      zoom: this.layout ? this.layout.zoom : 1,
      page: this.layout ? this.layout.page : this.page,
      shown: this.layout ? this.layout.shown : [this.page],
      count: this.comic.pages.length,
      fullscreen: this.fullscreen,
    };
  }

  private refreshChrome(): void {
    if (!this.top) return;
    const s = this.chromeState();
    this.top.update(s);
    this.bottom.update(s);
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      await setFullscreen(!this.fullscreen);
      this.fullscreen = await isFullscreen();
    } catch {
      toast("Fullscreen is not available", "error");
    }
    this.refreshChrome();
  }

  // ---------- chrome visibility ----------

  private showChrome(sticky = false): void {
    this.chromeSticky = sticky;
    if (!this.chromeShown) {
      this.chromeShown = true;
      this.el.classList.remove("chrome-hidden");
    }
    document.body.classList.remove("hide-cursor");
    this.armHide();
  }

  private hideChrome(): void {
    if (this.pinned) return;
    closeMenu();
    this.chromeShown = false;
    this.chromeSticky = false;
    this.el.classList.add("chrome-hidden");
  }

  private armHide(): void {
    clearTimeout(this.hideTimer);
    if (this.pinned || this.chromeSticky) return;
    this.hideTimer = window.setTimeout(() => {
      if (this.pinned) return;
      this.hideChrome();
      document.body.classList.add("hide-cursor");
    }, this.settings().chromeHideMs);
  }

  /** Show the controls briefly when a comic opens, so people see they exist. */
  private flashChrome(): void {
    this.showChrome(false);
  }

  // ---------- input ----------

  private wireInput(): void {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (isHelpOpen() && e.key !== "?" && e.key !== "Escape") {
        closeHelp();
      }
      const cmd = commandForKey(e);
      if (!cmd) return;
      e.preventDefault();
      // While a menu is open, only Esc and the menu's own keys act.
      if (isMenuOpen() && cmd !== "escape") closeMenu();
      this.run(cmd);
    };
    window.addEventListener("keydown", onKey);
    this.cleanup.push(() => window.removeEventListener("keydown", onKey));

    const onWheel = (e: WheelEvent) => {
      const strip = this.layout instanceof StripLayout;
      if (!strip || e.ctrlKey) e.preventDefault();
      this.layout.wheel(e, this.local(e));
    };
    this.stage.addEventListener("wheel", onWheel, { passive: false });
    this.cleanup.push(() => this.stage.removeEventListener("wheel", onWheel));

    const onMove = (e: MouseEvent) => {
      document.body.classList.remove("hide-cursor");
      if (e.clientY < EDGE_SHOW || e.clientY > window.innerHeight - EDGE_SHOW) this.showChrome(false);
      else if (this.chromeShown) this.armHide();
      else this.armCursorHide();
    };
    this.el.addEventListener("mousemove", onMove);

    const onFs = () => void isFullscreen().then((f) => {
      this.fullscreen = f;
      this.refreshChrome();
    });
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("resize", onFs);
    this.cleanup.push(() => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("resize", onFs);
    });

    this.cleanup.push(
      attachGestures(this.stage, {
        tap: (at, type) => this.tap(at, type),
        doubleTap: (at, type) => {
          if (this.zone(at) === "middle" || !this.settings().clickZones) {
            clearTimeout(this.middleTimer);
            this.middleTimer = 0;
            this.layout.zoomCmd("toggle", at);
          } else this.tap(at, type);
        },
        dragStart: (type) => this.layout.dragStart(type),
        dragMove: (dx, dy) => this.layout.dragMove(dx, dy),
        dragEnd: (vx, vy) => this.layout.dragEnd(vx, vy),
        pinch: (phase, scale, at) => this.layout.pinch(phase, scale, at),
        sideButton: (forward) => void this.layout.step(forward ? 1 : -1),
      }),
    );
  }

  private cursorTimer = 0;
  private armCursorHide(): void {
    clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      if (!this.chromeShown) document.body.classList.add("hide-cursor");
    }, this.settings().chromeHideMs);
  }

  private local(e: MouseEvent): Pos {
    const r = this.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Click zones: left 30% / middle 40% / right 30% of the stage. */
  private zone(at: Pos): "left" | "middle" | "right" {
    const f = at.x / Math.max(1, this.stageW);
    return f < 0.3 ? "left" : f > 0.7 ? "right" : "middle";
  }

  private tap(at: Pos, _type: string): void {
    if (closeMenu()) return;
    const z = this.zone(at);
    if (z === "middle" || !this.settings().clickZones) {
      // Wait a moment: a second tap means "zoom", not "toggle the controls".
      clearTimeout(this.middleTimer);
      this.middleTimer = window.setTimeout(() => {
        this.middleTimer = 0;
        this.run("toggleChrome");
      }, 260);
      return;
    }
    this.run(z === "left" ? "visualLeft" : "visualRight");
  }
}
