import { describe, expect, it } from "vitest";
import { measureUnit } from "./measure";
import { renderWidth } from "./page-cache";

const A4 = { w: 793, h: 1122 };

describe("PDF opening as a book starts with half width", () => {
  it("asks for nothing before the window is measured", () => {
    const m = measureUnit([A4], { fit: "page", bookLook: true, lone: true, vw: 1, vh: 1 });
    expect(m.ready).toBe(false);
  });

  it("the cover alone and a spread ask at a half's width", () => {
    // A window where each half is 576 CSS px wide (height room 843 - 28 = 815).
    const view = { fit: "page" as const, bookLook: true, vw: 1600, vh: 843 };
    const cover = measureUnit([A4], { ...view, lone: true });
    const spread = measureUnit([A4, A4], { ...view, lone: false });
    for (const m of [cover, spread]) {
      expect(m.ready).toBe(true);
      expect(m.widths[0] * m.f).toBeCloseTo(576, 0);
      expect(renderWidth(m.widths[0], m.f, 1)).toBe(768);
      expect(renderWidth(m.widths[0], m.f, 1.5)).toBe(1024);
    }
  });
});
