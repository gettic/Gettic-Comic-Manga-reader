import { describe, expect, it } from "vitest";
import { buildSpreads, isWide, unitOf, type PageSize } from "./spreads";

const tall: PageSize = { w: 1000, h: 1500 };
const wide: PageSize = { w: 2000, h: 1500 };
const sizes = (wideAt: number[] = []) => (i: number) => (wideAt.includes(i) ? wide : tall);

describe("buildSpreads", () => {
  it("single mode: one page per unit", () => {
    expect(buildSpreads(3, sizes(), { double: false, coverAlone: true, offset: 0 })).toEqual([[0], [1], [2]]);
  });

  it("double with cover alone", () => {
    expect(buildSpreads(6, sizes(), { double: true, coverAlone: true, offset: 0 })).toEqual([[0], [1, 2], [3, 4], [5]]);
  });

  it("double without cover alone", () => {
    expect(buildSpreads(5, sizes(), { double: true, coverAlone: false, offset: 0 })).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("wide pages stand alone, and the page before one is not paired across it", () => {
    expect(buildSpreads(7, sizes([2, 5]), { double: true, coverAlone: true, offset: 0 })).toEqual([
      [0],
      [1],
      [2],
      [3, 4],
      [5],
      [6],
    ]);
  });

  it("offset shifts the pairing by one page", () => {
    expect(buildSpreads(6, sizes(), { double: true, coverAlone: true, offset: 1 })).toEqual([[0], [1], [2, 3], [4, 5]]);
  });

  it("unknown sizes count as normal pages", () => {
    expect(buildSpreads(4, () => undefined, { double: true, coverAlone: false, offset: 0 })).toEqual([[0, 1], [2, 3]]);
  });

  it("empty book", () => {
    expect(buildSpreads(0, sizes(), { double: true, coverAlone: true, offset: 0 })).toEqual([]);
  });
});

describe("unitOf / isWide", () => {
  const units = [[0], [1, 2], [3, 4], [5]];
  it("finds the unit holding a page", () => {
    expect(unitOf(units, 0)).toBe(0);
    expect(unitOf(units, 2)).toBe(1);
    expect(unitOf(units, 3)).toBe(2);
    expect(unitOf(units, 5)).toBe(3);
    expect(unitOf(units, 99)).toBe(3);
    expect(unitOf([], 3)).toBe(0);
  });
  it("wide detection", () => {
    expect(isWide(wide)).toBe(true);
    expect(isWide(tall)).toBe(false);
    expect(isWide(undefined)).toBe(false);
  });
});
