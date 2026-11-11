// Default settings and checking of saved settings (which may be old, partial or broken).
import type { AppSettings, Direction, Fit, Layout, ViewSettings } from "../api/types";

export const DEFAULT_VIEW: ViewSettings = {
  layout: "single",
  direction: "ltr",
  fit: "page",
  coverAlone: true,
  spreadOffset: 0,
};

export const DEFAULT_SETTINGS: AppSettings = {
  defaults: DEFAULT_VIEW,
  clickZones: true,
  turnAnimation: "slide",
  background: "black",
  stripWidth: 60,
  stripGap: 0,
  autoSingleWhenPortrait: true,
  chromeHideMs: 2000,
};

const LAYOUTS: Layout[] = ["single", "double", "strip"];
const DIRS: Direction[] = ["ltr", "rtl"];
const FITS: Fit[] = ["width", "height", "page", "original"];

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const pick = <T>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** A full, valid ViewSettings from anything saved; missing or wrong fields fall back to `base`. */
export function sanitizeView(v: unknown, base: ViewSettings = DEFAULT_VIEW): ViewSettings {
  const o = obj(v);
  return {
    layout: pick(o.layout, LAYOUTS, base.layout),
    direction: pick(o.direction, DIRS, base.direction),
    fit: pick(o.fit, FITS, base.fit),
    coverAlone: bool(o.coverAlone, base.coverAlone),
    spreadOffset: o.spreadOffset === 1 ? 1 : o.spreadOffset === 0 ? 0 : base.spreadOffset,
  };
}

/**
 * A comic's view turned into a default for new comics. The page-pairing shift belongs to one
 * book only, so it is never part of the default.
 */
export function viewAsDefault(v: ViewSettings): ViewSettings {
  return { ...v, spreadOffset: 0 };
}

export function sanitizeSettings(v: unknown): AppSettings {
  const o = obj(v);
  const d = DEFAULT_SETTINGS;
  return {
    // Older saves may hold spreadOffset in the defaults: ignore it.
    defaults: viewAsDefault(sanitizeView(o.defaults, d.defaults)),
    clickZones: bool(o.clickZones, d.clickZones),
    turnAnimation: pick(o.turnAnimation, ["slide", "instant"] as const, d.turnAnimation),
    background: pick(o.background, ["black", "grey"] as const, d.background),
    stripWidth: Math.round(num(o.stripWidth, d.stripWidth, 30, 100)),
    stripGap: Math.round(num(o.stripGap, d.stripGap, 0, 64)),
    autoSingleWhenPortrait: bool(o.autoSingleWhenPortrait, d.autoSingleWhenPortrait),
    chromeHideMs: Math.round(num(o.chromeHideMs, d.chromeHideMs, 500, 10000)),
  };
}
