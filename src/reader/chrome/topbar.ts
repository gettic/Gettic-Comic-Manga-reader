// Top bar: back, title, layout, direction, fit, zoom, fullscreen, settings, help.
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import type { Command } from "../input/keys";
import type { ChromeHost, ChromeState } from "./host";
import { fitMenu, openMenu, settingsMenu } from "./menus";

const FIT_NAMES = { width: "Fit width", height: "Fit height", page: "Fit page", original: "Original" };

export class TopBar {
  readonly el: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private layoutBtns: Record<string, HTMLButtonElement> = {};
  private dirBtns: Record<string, HTMLButtonElement> = {};
  private fitBtn: HTMLButtonElement;
  private fitLabel: HTMLElement;
  private zoomGroup: HTMLElement;
  private zoomLabel: HTMLElement;
  private fullBtn: HTMLButtonElement;
  private state: ChromeState | null = null;

  constructor(private host: ChromeHost) {
    const btn = (icon: string, title: string, click: () => void, cls = "icon-btn") =>
      el(`button.${cls}`, { title, "aria-label": title, onclick: click }, svg(icon));
    const run = (c: Command) => () => host.run(c);

    const seg = (entries: [string, string, string, () => void][], into: Record<string, HTMLButtonElement>, label: string) =>
      el(
        "div.seg",
        { role: "group", "aria-label": label },
        ...entries.map(([key, icon, text, click]) => {
          const b = el("button", { title: text, onclick: click }, svg(icon), el("span.lbl", { text }));
          into[key] = b;
          return b;
        }),
      );

    this.titleEl = el("b");
    this.subEl = el("span");
    this.fitLabel = el("span.lbl");
    this.fitBtn = el("button.dropdown", { title: "Fit" }, svg(icons.fit), this.fitLabel, svg(icons.chevron, "icon chev"));
    this.fitBtn.addEventListener("click", () => this.state && openMenu(this.fitBtn, fitMenu(this.state, host), host));
    this.zoomLabel = el("span.zoom-val");
    this.zoomGroup = el(
      "div.zoom",
      {},
      btn(icons.minus, "Zoom out (-)", run("zoomOut")),
      el("button.zoom-reset", { title: "Reset zoom (0)", onclick: run("zoomReset") }, this.zoomLabel),
      btn(icons.plus, "Zoom in (+)", run("zoomIn")),
    );
    this.fullBtn = btn(icons.fullscreen, "Fullscreen (F)", run("fullscreen"));
    const gear = btn(icons.gear, "Settings", () => {
      if (this.state) openMenu(gear, settingsMenu(this.state, host), host);
    });

    this.el = el(
      "header.topbar.chrome",
      {},
      btn(icons.back, "Back (Esc)", () => host.back()),
      el("div.title", {}, this.titleEl, this.subEl),
      el("div.spacer"),
      seg(
        [
          ["single", icons.single, "Single", run("layoutSingle")],
          ["double", icons.double, "Double", run("layoutDouble")],
          ["strip", icons.strip, "Strip", run("layoutStrip")],
        ],
        this.layoutBtns,
        "Layout",
      ),
      seg(
        [
          ["ltr", icons.ltr, "Left to right", () => this.setDir("ltr")],
          ["rtl", icons.rtl, "Right to left", () => this.setDir("rtl")],
        ],
        this.dirBtns,
        "Reading direction",
      ),
      this.fitBtn,
      this.zoomGroup,
      el("div.spacer.small"),
      this.fullBtn,
      gear,
      btn(icons.help, "Keys and help (?)", run("help")),
    );
  }

  /** The direction buttons set, not toggle, so clicking the active one does nothing. */
  private setDir(d: "ltr" | "rtl"): void {
    if (this.state && this.state.view.direction !== d) this.host.run("toggleDirection");
  }

  update(s: ChromeState): void {
    this.state = s;
    this.titleEl.textContent = s.title;
    this.subEl.textContent = s.sub;
    for (const [k, b] of Object.entries(this.layoutBtns)) {
      const on = k === s.view.layout;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    // Double chosen but shown as single (narrow window): mark it as "auto".
    this.layoutBtns.double.classList.toggle("auto", s.view.layout === "double" && !s.double);
    for (const [k, b] of Object.entries(this.dirBtns)) {
      const on = k === s.view.direction;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    const strip = s.view.layout === "strip";
    this.fitBtn.hidden = strip;
    this.fitLabel.textContent = FIT_NAMES[s.view.fit];
    this.zoomLabel.textContent = `${Math.round(s.zoom * 100)}%`;
    this.fullBtn.innerHTML = "";
    this.fullBtn.append(svg(s.fullscreen ? icons.exitFullscreen : icons.fullscreen));
    this.fullBtn.title = s.fullscreen ? "Leave fullscreen (F)" : "Fullscreen (F)";
  }
}
