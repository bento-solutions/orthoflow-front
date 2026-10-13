/**
 * The measurements every part of the waiting-room plan agrees on.
 *
 * The designer, the canvas and the little previews in the picker all draw the same
 * furniture, so the geometry lives here rather than in any one of them. Everything is in
 * room units — the canvas scales them on the way to the screen, and what gets stored is
 * always these.
 */

export type FurnitureKind = 'BENCH' | 'SOFA';

export const MIN_SEATS = 1;
export const MAX_SEATS = 5;
export const SEAT_CAPACITIES: readonly number[] = [1, 2, 3, 4, 5];

/** One seating position, the unit both kinds are built from. */
const SEAT_WIDTH = 40;

/** A bench is the seats and nothing else; a sofa adds an armrest at each end. */
const BENCH_DEPTH = 44;
const SOFA_DEPTH = 48;
const SOFA_ARM = 11;

/** The grid furniture snaps to, and the room it is placed in. */
export const GRID = 10;
export const ROOM_WIDTH = 900;
export const ROOM_HEIGHT = 560;

export interface Size {
  readonly w: number;
  readonly h: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export function clampSeats(seats: number): number {
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(seats)));
}

/** The module's own size, before any rotation. */
export function moduleSize(kind: FurnitureKind, seats: number): Size {
  const n = clampSeats(seats);
  return kind === 'SOFA'
    ? { w: n * SEAT_WIDTH + SOFA_ARM * 2, h: SOFA_DEPTH }
    : { w: n * SEAT_WIDTH, h: BENCH_DEPTH };
}

/**
 * The footprint once turned. A quarter or three-quarter turn swaps width and height,
 * which is what keeps a rotated module inside the room and out of its neighbours.
 */
export function rotatedSize(kind: FurnitureKind, seats: number, rotation: number): Size {
  const { w, h } = moduleSize(kind, seats);
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/**
 * Where each seat's middle sits inside the module, left to right, before rotation.
 * Index 0 is the leftmost seat and stays index 0 however the module is turned — that
 * stability is what lets a stored assignment survive a move.
 */
export function seatCentres(kind: FurnitureKind, seats: number): Point[] {
  const n = clampSeats(seats);
  const { h } = moduleSize(kind, seats);
  const left = kind === 'SOFA' ? SOFA_ARM : 0;
  // Sat slightly forward of centre: the back of the seat is at the top, so the person
  // reads as sitting on the cushion rather than floating over the frame.
  const y = kind === 'SOFA' ? h / 2 + 4 : h / 2 + 3;
  return Array.from({ length: n }, (_, i) => ({ x: left + i * SEAT_WIDTH + SEAT_WIDTH / 2, y }));
}

/**
 * A seat's middle in room coordinates, with the module's rotation applied. Markers are
 * placed with this so they land on the cushion whichever way the furniture faces.
 */
export function seatCentreInRoom(
  kind: FurnitureKind,
  seats: number,
  rotation: number,
  origin: Point,
  seatIndex: number,
): Point {
  const local = seatCentres(kind, seats)[seatIndex];
  if (!local) {
    return origin;
  }
  const { w, h } = moduleSize(kind, seats);
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  // Turn about the module's own middle, then re-anchor to the rotated bounding box so
  // origin stays the top-left of what the user actually sees.
  const dx = local.x - w / 2;
  const dy = local.y - h / 2;
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const box = rotatedSize(kind, seats, rotation);
  return { x: origin.x + box.w / 2 + rx, y: origin.y + box.h / 2 + ry };
}

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

/** Keeps a module's top-left inside the room given its rotated footprint. */
export function clampToRoom(origin: Point, size: Size): Point {
  return {
    x: Math.min(Math.max(0, origin.x), Math.max(0, ROOM_WIDTH - size.w)),
    y: Math.min(Math.max(0, origin.y), Math.max(0, ROOM_HEIGHT - size.h)),
  };
}

/** Whether two placed modules share any floor. Touching edges are allowed. */
export function overlaps(a: { origin: Point; size: Size }, b: { origin: Point; size: Size }): boolean {
  return (
    a.origin.x < b.origin.x + b.size.w &&
    b.origin.x < a.origin.x + a.size.w &&
    a.origin.y < b.origin.y + b.size.h &&
    b.origin.y < a.origin.y + a.size.h
  );
}
