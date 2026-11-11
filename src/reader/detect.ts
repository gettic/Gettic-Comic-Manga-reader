// Guesses about a comic from its page sizes.
import type { PageSize } from "./spreads";

/** Very tall pages (median height at least 2.2x the width, from 3+ pages) = a webtoon / long strip. */
export function looksLikeWebtoon(sizes: (PageSize | undefined)[]): boolean {
  const ratios = sizes.filter((s): s is PageSize => !!s && s.w > 0).map((s) => s.h / s.w);
  if (ratios.length < 3) return false;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)] >= 2.2;
}
