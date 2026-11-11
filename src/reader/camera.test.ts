import { describe, expect, it } from "vitest";
import { canPan, clampPos, clampZoom, fitScale, MAX_ZOOM, MIN_ZOOM, startPos, zoomAt } from "./camera";

const view = { w: 1000, h: 800 };
const page = { w: 1000, h: 1500 };

describe("fitScale", () => {
  it("fits width, height, page and original", () => {
    expect(fitScale("width", page, view)).toBe(1);
    expect(fitScale("height", page, view)).toBeCloseTo(800 / 1500);
    expect(fitScale("page", page, view)).toBeCloseTo(800 / 1500);
    expect(fitScale("original", page, view)).toBe(1);
    expect(fitScale("page", { w: 2000, h: 500 }, view)).toBe(0.5);
  });
  it("survives zero sizes", () => {
    expect(fitScale("page", { w: 0, h: 0 }, view)).toBe(1);
  });
});

describe("clampPos", () => {
  it("centres content smaller than the view", () => {
    expect(clampPos({ x: -50, y: 300 }, { w: 500, h: 400 }, 1, view)).toEqual({ x: 250, y: 200 });
  });
  it("keeps bigger content covering the view", () => {
    const c = { w: 1000, h: 1500 };
    expect(clampPos({ x: 0, y: 100 }, c, 1, view)).toEqual({ x: 0, y: 0 });
    expect(clampPos({ x: 0, y: -2000 }, c, 1, view)).toEqual({ x: 0, y: -700 });
  });
});

describe("startPos", () => {
  const c = { w: 1000, h: 1500 };
  it("top when going forward, bottom when going back", () => {
    expect(startPos(c, 1, view, { atEnd: false, rtl: false }).y).toBe(0);
    expect(startPos(c, 1, view, { atEnd: true, rtl: false }).y).toBe(-700);
  });
  it("right-to-left starts at the right edge of wide content", () => {
    const wide = { w: 2000, h: 800 };
    expect(startPos(wide, 1, view, { atEnd: false, rtl: true }).x).toBe(-1000);
    expect(startPos(wide, 1, view, { atEnd: false, rtl: false }).x).toBe(0);
  });
});

describe("zoom", () => {
  it("zoomAt keeps the point under the cursor still", () => {
    const at = { x: 300, y: 200 };
    const p = zoomAt({ x: 0, y: 0 }, 1, 2, at);
    // content point under the cursor before: (300, 200); after: p + 2 * (300, 200) = at
    expect(p.x + 2 * 300).toBe(at.x);
    expect(p.y + 2 * 200).toBe(at.y);
  });
  it("clampZoom limits", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
  it("canPan tells when a tall page can still scroll", () => {
    const c = { w: 1000, h: 1500 };
    expect(canPan({ x: 0, y: 0 }, c, 1, view, 0, 100)).toBe(true);
    expect(canPan({ x: 0, y: -700 }, c, 1, view, 0, 100)).toBe(false);
    expect(canPan({ x: 0, y: 0 }, c, 1, view, 0, -100)).toBe(false);
  });
});
