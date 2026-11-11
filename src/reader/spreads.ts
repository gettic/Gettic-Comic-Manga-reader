// Pairs pages into what is shown at once ("units"): one page, or two in double mode.

export interface PageSize {
  w: number;
  h: number;
}

export interface SpreadOptions {
  double: boolean;
  /** Show the first page (the cover) on its own. */
  coverAlone: boolean;
  /** 1 = shift the pairing by one page (for books whose spreads are off by one). */
  offset: 0 | 1;
}

/** A page wider than tall is already a two-page spread and is always shown alone. */
export const isWide = (s: PageSize | undefined): boolean => !!s && s.w > s.h * 1.05;

/** Builds the list of units, each a list of page indexes in reading order. */
export function buildSpreads(count: number, sizes: (i: number) => PageSize | undefined, o: SpreadOptions): number[][] {
  const out: number[][] = [];
  if (!o.double) {
    for (let i = 0; i < count; i++) out.push([i]);
    return out;
  }
  let i = 0;
  if (o.coverAlone && count > 0) out.push([i++]);
  if (o.offset === 1 && i < count) out.push([i++]);
  while (i < count) {
    if (isWide(sizes(i)) || i + 1 >= count || isWide(sizes(i + 1))) {
      out.push([i++]);
    } else {
      out.push([i, i + 1]);
      i += 2;
    }
  }
  return out;
}

/** Index of the unit holding `page` (clamped to the book). */
export function unitOf(units: number[][], page: number): number {
  if (!units.length) return 0;
  // Units are in order, so a binary search on the first page works.
  let lo = 0;
  let hi = units.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (units[mid][0] <= page) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
