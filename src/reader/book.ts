// Book view: pure helpers (where a lone page sits, page-edge stacks, PDF auto-detect, page-flip pose).
import type { ComicKind } from "../api/types";
import type { Side } from "./navigator";
import type { PageSize } from "./spreads";

/**
 * Where a unit sits in the book, in reading order: "first" = the verso half (left in left-to-right),
 * "second" = the recto half (right in left-to-right), "pair" = both halves, "span" = one wide page
 * across both. The cover sits on the second half like a closed book; any other lone page (the last
 * page, a page before a wide spread) on the first half.
 */
export type BookPos = "first" | "second" | "pair" | "span";

export function bookSide(unitIndex: number, pagesInUnit: number, wide: boolean): BookPos {
  if (pagesInUnit >= 2) return "pair";
  if (wide) return "span";
  return unitIndex === 0 ? "second" : "first";
}

/** Thickness (px) of the page-edge stacks: pages already read (before) and still to come (after). */
/**
 * Book view on a narrow window (one page at a time): which side of the screen the page would sit
 * on in the open book. The cover and even pages are rectos (right-hand in left-to-right, so the
 * spine is on their left); odd pages are versos. Right-to-left mirrors it. Wide pages: null.
 */
export function singleBookSide(page: number, wide: boolean, rtl: boolean): "l" | "r" | null {
  if (wide) return null;
  const recto = page % 2 === 0;
  return recto !== rtl ? "r" : "l";
}
export function edgeWidths(firstShown: number, lastShown: number, count: number, min = 2, max = 10): { before: number; after: number } {
  if (count <= 1) return { before: 0, after: 0 };
  const span = count - 1;
  const before = firstShown <= 0 ? 0 : Math.round(min + ((max - min) * firstShown) / span);
  const after = lastShown >= span ? 0 : Math.round(min + ((max - min) * (span - lastShown)) / span);
  return { before, after };
}

/** A PDF whose known pages are mostly portrait reads best as a book. */
export function looksLikeBook(sizes: (PageSize | undefined)[], kind: ComicKind): boolean {
  if (kind !== "pdf") return false;
  const known = sizes.filter((s): s is PageSize => !!s && s.w > 0 && s.h > 0);
  if (!known.length) return false;
  const portrait = known.filter((s) => s.h > s.w * 1.05).length;
  return portrait * 2 > known.length;
}

export interface FlipPose {
  /** rotateY (deg) of the half that lifts off (current spread, on `side`), null = edge-on/hidden. */
  turn: number | null;
  /** rotateY (deg) of the half that lands (next spread, opposite side), null = edge-on/hidden. */
  land: number | null;
  /** Which spread is drawn on top. */
  top: "current" | "next";
  /** Darkening of the lifting / landing half (0..1). */
  shadeTurn: number;
  shadeLand: number;
}

/**
 * Pose of a page flip at progress p (0..1) toward `side`. The leaf turns 180 degrees around the
 * spine: the first half of the turn lifts the current page, the second half lays down the next.
 */
export function flipPose(p: number, side: Side): FlipPose {
  const a = 180 * Math.min(1, Math.max(0, p));
  const s = side === "right" ? -1 : 1;
  if (a <= 90) {
    return { turn: s * a, land: null, top: "current", shadeTurn: 0.35 * (a / 90), shadeLand: 0 };
  }
  return { turn: null, land: -s * (180 - a), top: "next", shadeTurn: 0, shadeLand: 0.35 * ((180 - a) / 90) };
}
