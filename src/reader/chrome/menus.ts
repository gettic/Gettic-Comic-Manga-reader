// Popover menus: one open at a time, closed by a click outside or Esc.
import type { AppSettings } from "../../api/types";
import { el, svg } from "../../ui/dom";
import { icons } from "../../ui/icons";
import type { Command } from "../input/keys";
import type { ChromeHost, ChromeState } from "./host";

let open: { el: HTMLElement; anchor: HTMLElement; onClose?: () => void } | null = null;

function outside(e: PointerEvent): void {
  if (!open) return;
  const t = e.target as Node;
  if (open.el.contains(t) || open.anchor.contains(t)) return;
  closeMenu();
}

/** Closes the open menu. Returns true if one was open (so Esc stops there). */
export function closeMenu(): boolean {
  if (!open) return false;
  const m = open;
  open = null;
  m.el.remove();
  m.anchor.classList.remove("active");
  document.removeEventListener("pointerdown", outside, true);
  m.onClose?.();
  return true;
}

export function isMenuOpen(): boolean {
  return open !== null;
}

/** Shows `content` under (or above, `up`) the anchor. Clicking the anchor again closes it. */
export function openMenu(anchor: HTMLElement, content: HTMLElement, host: ChromeHost, up = false): void {
  const same = open?.anchor === anchor;
  closeMenu();
  if (same) return;
  const menu = el("div.menu", { role: "menu" }, content);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  menu.style.left = `${left}px`;
  if (up) menu.style.bottom = `${window.innerHeight - r.top + 8}px`;
  else menu.style.top = `${r.bottom + 6}px`;
  anchor.classList.add("active");
  host.setPinned(true);
  open = { el: menu, anchor, onClose: () => host.setPinned(false) };
  document.addEventListener("pointerdown", outside, true);
}

const item = (label: string, key: string, on: boolean, click: () => void) =>
  el(
    `button.item${on ? ".on" : ""}`,
    { role: "menuitemradio", "aria-checked": String(on), onclick: click },
    on ? svg(icons.check) : el("span.icon"),
    el("span.label", { text: label }),
    key ? el("kbd", { text: key }) : null,
  );

export function fitMenu(state: ChromeState, host: ChromeHost): HTMLElement {
  const fits: [string, string, Command, string][] = [
    ["Fit width", "W", "fitWidth", "width"],
    ["Fit height", "H", "fitHeight", "height"],
    ["Fit page", "P", "fitPage", "page"],
    ["Original size", "O", "fitOriginal", "original"],
  ];
  return el(
    "div.menu-list",
    {},
    ...fits.map(([label, key, cmd, fit]) =>
      item(label, key, state.view.fit === fit, () => {
        host.run(cmd);
        closeMenu();
      }),
    ),
    el("hr"),
    el("div.item.hint", {}, el("span.icon"), el("span.label", { text: "Zoom" }), el("kbd", { text: "Ctrl + wheel" })),
  );
}

export function goToBox(state: ChromeState, host: ChromeHost): HTMLElement {
  const input = el("input.goto-input", {
    type: "number",
    min: 1,
    max: state.count,
    value: state.page + 1,
    "aria-label": "Page number",
  });
  const go = () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) host.goToPage(Math.round(n) - 1);
    closeMenu();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") go();
    if (e.key === "Escape") closeMenu();
  });
  const box = el(
    "div.goto",
    {},
    el("label", { text: "Go to page" }),
    input,
    el("span.muted", { text: `of ${state.count}` }),
    el("button.btn.primary.small", { text: "Go", onclick: go }),
  );
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return box;
}

export function settingsMenu(state: ChromeState, host: ChromeHost): HTMLElement {
  const s = host.settings();
  const set = (patch: Partial<AppSettings>) => host.updateSettings(patch);
  const toggle = (label: string, on: boolean, change: (v: boolean) => void) => {
    const box = el("input", { type: "checkbox" });
    box.checked = on;
    box.addEventListener("change", () => change(box.checked));
    return el("label.row", {}, el("span", { text: label }), box);
  };
  const choice = <T extends string | number>(label: string, value: T, options: [T, string][], change: (v: T) => void) => {
    const seg = el("div.seg.small");
    for (const [v, text] of options) {
      const b = el(`button${v === value ? ".on" : ""}`, { text });
      b.addEventListener("click", () => {
        change(v);
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      });
      seg.append(b);
    }
    return el("div.row", {}, el("span", { text: label }), seg);
  };
  const width = el("input", { type: "range", min: 30, max: 100, step: 5, value: s.stripWidth });
  const widthOut = el("span.muted", { text: `${s.stripWidth}%` });
  width.addEventListener("input", () => {
    widthOut.textContent = `${width.value}%`;
    set({ stripWidth: Number(width.value) });
  });
  const v = state.view;
  const names = { single: "Single", double: "Double", book: "Book", strip: "Strip" };
  const viewText = `${names[v.layout]} · ${
    v.direction === "rtl" ? "right to left" : "left to right"
  } · fit ${v.fit}`;
  const saveBtn = el("button.btn.small", { text: "Save as default" });
  saveBtn.addEventListener("click", () => {
    host.saveAsDefault();
    saveBtn.textContent = "Saved";
  });
  return el(
    "div.settings",
    {},
    el("h3", { text: "This comic" }),
    el("div.row", {}, el("span.muted", { text: viewText }), saveBtn),
    el("p.note", { text: "Changes you make while reading are kept for this comic. \"Save as default\" uses them for new comics." }),
    el("h3", { text: "Reading" }),
    choice("Page turn", s.turnAnimation, [["slide", "Animated"], ["instant", "Instant"]], (x) => set({ turnAnimation: x })),
    el("p.note", { text: "Animated: a slide, or a page flip in Book view." }),
    toggle("Click / tap zones turn pages", s.clickZones, (x) => set({ clickZones: x })),
    toggle("Single page when the window is narrow", s.autoSingleWhenPortrait, (x) => set({ autoSingleWhenPortrait: x })),
    toggle("Open PDFs as a book", s.pdfAsBook, (x) => set({ pdfAsBook: x })),
    choice("Hide controls after", s.chromeHideMs, [[1000, "1 s"], [2000, "2 s"], [4000, "4 s"]], (x) => set({ chromeHideMs: x })),
    choice("Background", s.background, [["black", "Black"], ["grey", "Grey"]], (x) => set({ background: x })),
    el("h3", { text: "Strip mode" }),
    el("div.row", {}, el("span", { text: "Column width" }), el("div.range", {}, width, widthOut)),
    choice("Gap between pages", s.stripGap, [[0, "None"], [8, "Small"], [24, "Large"]], (x) => set({ stripGap: x })),
  );
}
