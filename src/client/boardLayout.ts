/**
 * Board geometry: absolute point numbers -> screen slots, from the viewer's seat.
 *
 * The engine numbers points 1..24 absolutely and never re-indexes them per
 * player. The screen, however, must always show YOUR checkers travelling toward
 * YOUR home and YOUR tray, or the board is unreadable. Everything here is a
 * projection of `distanceToOff` (24 = furthest from home, 1 = about to bear
 * off), which is the only place direction is encoded in the engine either.
 *
 * Layout, in viewer-relative distance d:
 *
 *      d 13 14 15 16 17 18 | bar | 19 20 21 22 23 24 | opponent tray
 *      d 12 11 10  9  8  7 | bar |  6  5  4  3  2  1 | your tray
 *
 * So the viewer's home board is the bottom-right quadrant and their checkers
 * run top-right -> top-left -> bottom-left -> bottom-right -> off. For white
 * (d = p) that is the conventional printed board; for black (d = 25 - p) it is
 * its mirror, which is what black actually sees sitting opposite.
 */

import type { MovePoint, Player } from '../engine/types';

export type BoardRow = 'top' | 'bottom';

export const POINTS_PER_ROW = 12;

/** Absolute point number for a viewer-relative distance. */
export function pointAtDistance(viewer: Player, distance: number): number {
  return viewer === 'white' ? distance : 25 - distance;
}

/** Viewer-relative distance for an absolute point number. */
export function distanceOfPoint(viewer: Player, point: number): number {
  return viewer === 'white' ? point : 25 - point;
}

export interface BoardSlots {
  /** Left to right across the top row. */
  readonly top: readonly number[];
  /** Left to right across the bottom row. */
  readonly bottom: readonly number[];
}

export function boardSlots(viewer: Player): BoardSlots {
  const top: number[] = [];
  const bottom: number[] = [];
  for (let i = 0; i < POINTS_PER_ROW; i += 1) {
    top.push(pointAtDistance(viewer, 13 + i));
    bottom.push(pointAtDistance(viewer, POINTS_PER_ROW - i));
  }
  return { top, bottom };
}

/**
 * CSS grid column for a slot index. Columns 1..6 are the left half, 7 is the
 * bar, 8..13 the right half, 14 the tray stack.
 */
export function gridColumnForSlot(index: number): number {
  return index < 6 ? index + 1 : index + 2;
}

/** True for the six points making up the viewer's own home board. */
export function isViewerHome(viewer: Player, point: number): boolean {
  const d = distanceOfPoint(viewer, point);
  return d >= 1 && d <= 6;
}

/** Stable string key for a MovePoint, for Set/Map lookups. */
export function locationKey(location: MovePoint): string {
  return typeof location === 'number' ? `p${location}` : location;
}

/**
 * How far a stack of `count` checkers may overlap, expressed as a fraction of
 * the checker diameter. Five checkers sit edge to edge; anything taller is
 * squeezed so the stack still occupies exactly five checkers of height and can
 * never overflow the point, even at the theoretical maximum of fifteen.
 */
export function stackOverlapRatio(count: number, freeStack = 5): number {
  if (count <= freeStack) return 0;
  return (count - freeStack) / (count - 1);
}
