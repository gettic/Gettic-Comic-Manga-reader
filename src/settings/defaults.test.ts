import { describe, expect, it } from "vitest";
import { looksLikeWebtoon } from "../reader/detect";
import { pdfWidthStep } from "../api/comics";
import { DEFAULT_SETTINGS, DEFAULT_VIEW, sanitizeSettings, sanitizeView, viewAsDefault } from "./defaults";

describe("settings", () => {
  it("first run gives the defaults", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and repairs broken ones", () => {
    const s = sanitizeSettings({ clickZones: false, stripWidth: 500, turnAnimation: "warp", defaults: { direction: "rtl" } });
    expect(s.clickZones).toBe(false);
    expect(s.stripWidth).toBe(100);
    expect(s.turnAnimation).toBe("slide");
    expect(s.defaults).toEqual({ ...DEFAULT_VIEW, direction: "rtl" });
  });

  it("the page-pairing shift never becomes a default", () => {
    expect(viewAsDefault({ ...DEFAULT_VIEW, layout: "double", spreadOffset: 1 })).toEqual({ ...DEFAULT_VIEW, layout: "double" });
    // An old settings file that already has it: ignored.
    expect(sanitizeSettings({ defaults: { layout: "double", spreadOffset: 1 } }).defaults.spreadOffset).toBe(0);
    // So a new comic (no saved view) opens unshifted, while a comic's own shift is kept.
    const defaults = sanitizeSettings({ defaults: { spreadOffset: 1 } }).defaults;
    expect(sanitizeView(undefined, defaults).spreadOffset).toBe(0);
    expect(sanitizeView({ spreadOffset: 1 }, defaults).spreadOffset).toBe(1);
  });

  it("a comic's view falls back to the defaults field by field", () => {
    const base = { ...DEFAULT_VIEW, layout: "double" as const };
    expect(sanitizeView({ fit: "width", layout: "nope" }, base)).toEqual({ ...base, fit: "width" });
    expect(sanitizeView(undefined, base)).toEqual(base);
  });
});

describe("detect + pdf widths", () => {
  it("webtoon pages are very tall", () => {
    const t = { w: 800, h: 2400 };
    const n = { w: 1000, h: 1500 };
    expect(looksLikeWebtoon([t, t, t])).toBe(true);
    expect(looksLikeWebtoon([n, n, t])).toBe(false);
    expect(looksLikeWebtoon([t, undefined])).toBe(false);
  });

  it("pdf widths are rounded to 256 steps within 256..4096", () => {
    expect(pdfWidthStep(1)).toBe(256);
    expect(pdfWidthStep(1000)).toBe(1024);
    expect(pdfWidthStep(1024)).toBe(1024);
    expect(pdfWidthStep(99999)).toBe(4096);
  });
});
