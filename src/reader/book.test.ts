import { describe, expect, it } from "vitest";
import { bookSide, edgeWidths, flipPose, looksLikeBook, singleBookSide } from "./book";

describe("bookSide", () => {
  it("cover on the second half, other lone pages on the first", () => {
    expect(bookSide(0, 1, false)).toBe("second");
    expect(bookSide(7, 1, false)).toBe("first"); // last page alone
    expect(bookSide(3, 2, false)).toBe("pair");
    expect(bookSide(4, 1, true)).toBe("span"); // wide page across both halves
  });
});

describe("edgeWidths", () => {
  it("thin before at the start, thin after at the end", () => {
    expect(edgeWidths(0, 0, 101)).toEqual({ before: 0, after: 10 });
    expect(edgeWidths(100, 100, 101)).toEqual({ before: 10, after: 0 });
    expect(edgeWidths(50, 51, 101)).toEqual({ before: 6, after: 6 });
  });
  it("one-page book has no edges", () => {
    expect(edgeWidths(0, 0, 1)).toEqual({ before: 0, after: 0 });
  });
});

describe("looksLikeBook", () => {
  const portrait = { w: 793, h: 1122 };
  const landscape = { w: 1122, h: 793 };
  it("portrait PDFs only", () => {
    expect(looksLikeBook([portrait, portrait, landscape], "pdf")).toBe(true);
    expect(looksLikeBook([landscape, landscape, portrait], "pdf")).toBe(false);
    expect(looksLikeBook([portrait, portrait], "zip")).toBe(false);
    expect(looksLikeBook([undefined], "pdf")).toBe(false);
  });
});

describe("flipPose", () => {
  it("lifts the current page first, then lays down the next", () => {
    expect(flipPose(0, "right")).toMatchObject({ turn: -0, land: null, top: "current" });
    expect(flipPose(0.25, "right")).toMatchObject({ turn: -45, top: "current" });
    expect(flipPose(0.75, "right")).toMatchObject({ turn: null, land: 45, top: "next" });
    expect(flipPose(1, "right")).toMatchObject({ land: 0, top: "next", shadeLand: 0 });
  });
  it("right-to-left mirrors the angles", () => {
    expect(flipPose(0.25, "left").turn).toBe(45);
    expect(flipPose(0.75, "left").land).toBe(-45);
  });
  it("clamps progress", () => {
    expect(flipPose(2, "right").land).toBe(0);
    expect(flipPose(-1, "right").turn).toBe(-0);
  });
});

describe("singleBookSide (narrow window)", () => {
  it("cover and even pages are right-hand pages left-to-right, left-hand right-to-left", () => {
    expect(singleBookSide(0, false, false)).toBe("r");
    expect(singleBookSide(1, false, false)).toBe("l");
    expect(singleBookSide(2, false, false)).toBe("r");
    expect(singleBookSide(0, false, true)).toBe("l");
    expect(singleBookSide(1, false, true)).toBe("r");
  });
  it("a wide page has no side", () => {
    expect(singleBookSide(3, true, false)).toBeNull();
  });
});