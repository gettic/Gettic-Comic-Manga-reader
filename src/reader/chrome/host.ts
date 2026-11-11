// What the chrome (bars, menus) needs from the reader.
import type { AppSettings, ViewSettings } from "../../api/types";
import type { Command } from "../input/keys";

export interface ChromeState {
  title: string;
  sub: string;
  view: ViewSettings;
  /** Double page really in use (false when switched to single on a portrait window). */
  double: boolean;
  zoom: number;
  page: number;
  shown: number[];
  count: number;
  fullscreen: boolean;
}

export interface ChromeHost {
  run(cmd: Command): void;
  back(): void;
  goToPage(page: number): void;
  settings(): AppSettings;
  updateSettings(patch: Partial<AppSettings>): void;
  saveAsDefault(): void;
  /** A menu is open: keep the chrome visible. */
  setPinned(on: boolean): void;
}

export function pageLabel(shown: number[]): string {
  if (!shown.length) return "-";
  const a = Math.min(...shown) + 1;
  const b = Math.max(...shown) + 1;
  return a === b ? String(a) : `${a}-${b}`;
}
