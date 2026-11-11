// Fitted page widths of one unit (a page or a spread) in the paged layouts. Pure, so the widths
// PDF pages are asked at can be tested.
import type { Fit } from "../api/types";
import { fitScale } from "./camera";
import type { PageSize } from "./spreads";

export interface UnitMeasure {
  /** Page widths at the unit's common height, before fitting. */
  widths: number[];
  /** Unfitted size of the whole box (a lone Book page keeps a two-page box). */
  natural: PageSize;
  /** Fit scale: shown CSS width of page k = widths[k] * f. */
  f: number;
  /** False until the view has a real size: nothing should be loaded at these widths yet. */
  ready: boolean;
}

export interface MeasureOptions {
  fit: Fit;
  /** Book look: a margin around the book for the shadow and page edges. */
  bookLook: boolean;
  /** A Book page alone (cover / last page) still takes half of a two-page box. */
  lone: boolean;
  vw: number;
  vh: number;
}

export function measureUnit(sizes: PageSize[], o: MeasureOptions): UnitMeasure {
  const H = Math.max(...sizes.map((z) => z.h));
  const widths = sizes.map((z) => (z.w * H) / z.h);
  const natural = { w: widths.reduce((a, b) => a + b, 0) * (o.lone ? 2 : 1), h: H };
  const room = o.bookLook ? { w: o.vw - 48, h: o.vh - 28 } : { w: o.vw, h: o.vh };
  // Before the window is measured the view is 1x1 px: fitScale would fall back to 1 (the page's
  // full size), which asked PDFs for a too-wide first render.
  const ready = o.vw > 1 && o.vh > 1 && room.w > 0 && room.h > 0;
  return { widths, natural, f: fitScale(o.fit, natural, room), ready };
}
