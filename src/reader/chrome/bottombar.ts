// Bottom bar: arrows, page slider, page number. Right-to-left: the slider fills from the right,
// and the arrows keep their screen meaning (left arrow = page to the left).
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import { goToBox, openMenu } from "./menus";
import { pageLabel, type ChromeHost, type ChromeState } from "./host";

export class BottomBar {
  readonly el: HTMLElement;
  private slider: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private bubble: HTMLElement;
  private num: HTMLButtonElement;
  private state: ChromeState | null = null;
  private dragging = false;
  private pending = -1;
  private frame = 0;

  constructor(private host: ChromeHost) {
    this.fill = el("div.fill");
    this.thumb = el("div.thumb");
    this.bubble = el("div.bubble");
    this.slider = el(
      "div.slider",
      { role: "slider", tabindex: -1, "aria-label": "Page" },
      el("div.track"),
      this.fill,
      this.thumb,
      this.bubble,
    );
    this.num = el("button.pagenum", { title: "Go to page (G)" });
    this.num.addEventListener("click", () => this.openGoTo());
    this.el = el(
      "footer.bottombar.chrome",
      {},
      el("button.icon-btn", { title: "Page to the left", "aria-label": "Page to the left", onclick: () => host.run("visualLeft") }, svg(icons.left)),
      this.slider,
      this.num,
      el("button.icon-btn", { title: "Page to the right", "aria-label": "Page to the right", onclick: () => host.run("visualRight") }, svg(icons.right)),
    );
    this.slider.addEventListener("pointerdown", (e) => this.down(e));
    this.slider.addEventListener("pointermove", (e) => this.move(e));
    this.slider.addEventListener("pointerup", (e) => this.up(e));
    this.slider.addEventListener("pointercancel", (e) => this.up(e));
    this.slider.addEventListener("pointerleave", () => !this.dragging && this.bubble.classList.remove("show"));
  }

  update(s: ChromeState): void {
    this.state = s;
    this.el.classList.toggle("rtl", s.view.direction === "rtl");
    this.num.innerHTML = "";
    this.num.append(el("b", { text: pageLabel(s.shown) }), el("span", { text: ` / ${s.count}` }));
    this.slider.setAttribute("aria-valuemin", "1");
    this.slider.setAttribute("aria-valuemax", String(s.count));
    this.slider.setAttribute("aria-valuenow", String(s.page + 1));
    if (!this.dragging) this.draw(s.page);
  }

  openGoTo(): void {
    if (this.state) openMenu(this.num, goToBox(this.state, this.host), this.host, true);
  }

  /** Slider position (0..1 from the left edge) of a page. */
  private pos(page: number): number {
    const s = this.state;
    if (!s || s.count < 2) return 0;
    const f = page / (s.count - 1);
    return s.view.direction === "rtl" ? 1 - f : f;
  }

  private draw(page: number): void {
    const p = this.pos(page) * 100;
    const rtl = this.state?.view.direction === "rtl";
    this.thumb.style.left = `${p}%`;
    this.fill.style.left = rtl ? `${p}%` : "0";
    this.fill.style.right = rtl ? "0" : `${100 - p}%`;
  }

  private pageAt(e: PointerEvent): number {
    const s = this.state;
    if (!s) return 0;
    const r = this.slider.getBoundingClientRect();
    let f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    if (s.view.direction === "rtl") f = 1 - f;
    return Math.round(f * (s.count - 1));
  }

  private showBubble(page: number): void {
    this.bubble.textContent = `Page ${page + 1}`;
    this.bubble.style.left = `${this.pos(page) * 100}%`;
    this.bubble.classList.add("show");
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.dragging = true;
    this.slider.setPointerCapture(e.pointerId);
    this.host.setPinned(true);
    this.move(e);
  }

  private move(e: PointerEvent): void {
    const page = this.pageAt(e);
    this.showBubble(page);
    if (!this.dragging) return;
    this.draw(page);
    // Jump at most once per frame while dragging.
    this.pending = page;
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.pending >= 0) this.host.goToPage(this.pending);
      });
    }
  }

  private up(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.host.setPinned(false);
    this.bubble.classList.remove("show");
    if (e.type === "pointerup") this.host.goToPage(this.pageAt(e));
  }
}
