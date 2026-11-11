import { describe, expect, it } from "vitest";
import { sideToStep, stepToSide, UnitNavigator } from "./navigator";

describe("RTL mapping", () => {
  it("left to right: right is forward", () => {
    expect(sideToStep("ltr", "right")).toBe(1);
    expect(sideToStep("ltr", "left")).toBe(-1);
  });
  it("right to left: left is forward", () => {
    expect(sideToStep("rtl", "left")).toBe(1);
    expect(sideToStep("rtl", "right")).toBe(-1);
  });
  it("stepToSide is the inverse", () => {
    for (const d of ["ltr", "rtl"] as const) {
      for (const s of [1, -1] as const) expect(sideToStep(d, stepToSide(d, s))).toBe(s);
    }
  });
});

describe("UnitNavigator", () => {
  const units = [[0], [1, 2], [3, 4], [5]];

  it("starts on the unit holding the start page", () => {
    const n = new UnitNavigator(units, 4);
    expect(n.index).toBe(2);
    expect(n.page).toBe(3);
    expect(n.unit).toEqual([3, 4]);
  });

  it("steps and stops at both ends", () => {
    const n = new UnitNavigator(units, 0);
    expect(n.step(-1)).toBe(false);
    expect(n.step(1)).toBe(true);
    expect(n.page).toBe(1);
    n.goTo(5);
    expect(n.canStep(1)).toBe(false);
    expect(n.step(1)).toBe(false);
    expect(n.page).toBe(5);
  });

  it("keeps the shown page when the pairing changes", () => {
    const n = new UnitNavigator(units, 3);
    n.setUnits([[0], [1], [2, 3], [4, 5]]);
    expect(n.unit).toEqual([2, 3]);
  });
});
