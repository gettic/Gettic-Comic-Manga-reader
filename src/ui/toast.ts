// Small messages at the bottom of the window. Never modal.
import { el } from "./dom";

let host: HTMLElement | null = null;

export function toast(message: string, kind: "info" | "error" = "info", ms = 3200): void {
  if (!host) {
    host = el("div.toasts", { role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  const t = el(`div.toast.${kind}`, { text: message });
  host.append(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => {
    t.classList.remove("in");
    setTimeout(() => t.remove(), 250);
  }, ms);
}
