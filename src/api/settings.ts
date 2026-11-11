// App settings storage. Rust stores them as opaque JSON; the web build uses localStorage.
import { invoke, isTauri } from "./core";
import type { AppSettings } from "./types";

const KEY = "gcmr.settings";

/** Raw saved settings (unchecked), or null on first run. Run them through sanitizeSettings(). */
export async function loadSettings(): Promise<unknown> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  }
  return invoke<unknown>("get_settings");
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauri()) {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked: settings just aren't kept */
    }
    return;
  }
  await invoke<null>("set_settings", { settings });
}
