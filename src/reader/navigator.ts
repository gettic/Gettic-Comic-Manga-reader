// Moving through a comic. Every layout is a Navigator; the later smart panel mode becomes one
// more Navigator that moves the same Camera from panel to panel (see camera.ts animateTo).
import type { Direction } from "../api/types";
import { unitOf } from "./spreads";

export type Side = "left" | "right";
export type Step = 1 | -1;

/** What the reader needs from any reading mode. */
export interface Navigator {
  /** First page index shown (reading order). */
  readonly page: number;
  /** One unit forward (+1) or back (-1) in reading order. Returns false at the book's end. */
  step(dir: Step): boolean;
  /** Jump to the unit holding `page`. */
  goTo(page: number): void;
}

/** The one place where screen sides become reading order: in right-to-left, left is forward. */
export function sideToStep(direction: Direction, side: Side): Step {
  const forward = side === "right";
  return (direction === "rtl" ? !forward : forward) ? 1 : -1;
}

/** Which screen side a reading step goes toward (for slide animations and swipes). */
export function stepToSide(direction: Direction, step: Step): Side {
  return sideToStep(direction, "right") === step ? "right" : "left";
}

/** Pure position in a list of units (pages or spreads). */
export class UnitNavigator implements Navigator {
  private units: number[][];
  index = 0;

  constructor(units: number[][], page = 0) {
    this.units = units;
    this.index = unitOf(units, page);
  }

  get page(): number {
    return this.units[this.index]?.[0] ?? 0;
  }

  get unit(): number[] {
    return this.units[this.index] ?? [];
  }

  get count(): number {
    return this.units.length;
  }

  unitAt(index: number): number[] | undefined {
    return this.units[index];
  }

  canStep(dir: Step): boolean {
    const n = this.index + dir;
    return n >= 0 && n < this.units.length;
  }

  step(dir: Step): boolean {
    if (!this.canStep(dir)) return false;
    this.index += dir;
    return true;
  }

  goTo(page: number): void {
    this.index = unitOf(this.units, page);
  }

  /** New pairing (sizes learned, cover/offset changed): stay on the page that was shown. */
  setUnits(units: number[][]): void {
    const page = this.page;
    this.units = units;
    this.index = unitOf(units, page);
  }
}
