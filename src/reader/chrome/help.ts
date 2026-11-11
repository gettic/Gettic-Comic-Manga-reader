// Help overlay: the key table plus mouse and touch, drawn from BINDINGS.
import { el } from "../../ui/dom";
import { BINDINGS } from "../input/keys";

let overlay: HTMLElement | null = null;

export function isHelpOpen(): boolean {
  return overlay !== null;
}

export function closeHelp(): boolean {
  if (!overlay) return false;
  overlay.remove();
  overlay = null;
  return true;
}

export function toggleHelp(): void {
  if (closeHelp()) return;
  const rows = BINDINGS.filter((b, i) => BINDINGS.findIndex((x) => x.help === b.help) === i).map((b) =>
    el("div.key-row", {}, el("kbd", { text: b.label }), el("span", { text: b.help })),
  );
  const pointer: [string, string][] = [
    ["Wheel", "Scroll a tall page, then turn"],
    ["Ctrl + wheel / pinch", "Zoom where you point"],
    ["Click / tap left or right", "Page to that side"],
    ["Click / tap middle", "Show or hide the controls"],
    ["Double-click / double-tap", "Zoom in or back to fit"],
    ["Drag / swipe", "Pan when zoomed, swipe to turn on touch"],
    ["Mouse back / forward", "Previous / next page"],
  ];
  overlay = el(
    "div.help",
    { role: "dialog", "aria-label": "Keys", onclick: (e: Event) => e.target === overlay && closeHelp() },
    el(
      "div.help-card",
      {},
      el("h2", { text: "Keys" }),
      el("div.key-grid", {}, ...rows),
      el("h2", { text: "Mouse and touch" }),
      el("div.key-grid", {}, ...pointer.map(([k, v]) => el("div.key-row", {}, el("kbd", { text: k }), el("span", { text: v })))),
      el("p.muted", { text: "Press ? or Esc to close." }),
    ),
  );
  document.body.append(overlay);
}
