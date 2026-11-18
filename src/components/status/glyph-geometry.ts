/**
 * The BU mark, cut into parts. The original part IDs remain stable so the
 * existing choreographies keep their timings, groups and transitions.
 *
 * Redrawn on the existing 20-unit grid: the frame is unchanged, the first
 * letter has two bowls and the U is shifted right to leave a clear gap.
 *
 * Every part is one box. A pose moves a box with transform and opacity only,
 * so nothing here ever triggers layout while a run is going.
 */

export const GRID = 20

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type CornerId = 'c0' | 'c1' | 'c2' | 'c3'
export type StrokeId = 'lb' | 'lf' | 'ul' | 'ub' | 'ur'
export type GroupId = 'root' | 'F' | 'G' | 'GL' | 'GU' | 'T'
export type TokenId = `t${number}`
export type PartId = GroupId | CornerId | StrokeId | TokenId | 'gh'

/** Centres of the sixteen tokens the letters fall apart into. Each one sits on the ink of its letter. */
export const TOKEN_HOMES: ReadonlyArray<readonly [number, number]> = [
  // B: stem and the upper, middle and lower ink of the bowls.
  [3.85, 6], [3.85, 9], [3.85, 13], [6.4, 6], [6.5, 10], [6.4, 14],
  // U: left stem, the bowl along its centre line, right stem
  [11.85, 6], [11.85, 8], [11.85, 10],
  [11.85, 12.3], [13, 13.9], [15, 13.9], [16.15, 12.3],
  [16.15, 10], [16.15, 8], [16.15, 6],
]

export const TOKEN_COUNT = TOKEN_HOMES.length
export const TOKEN_SIZE = 2

export const tokenId = (i: number): TokenId => `t${i}`
export const TOKEN_IDS: readonly TokenId[] = TOKEN_HOMES.map((_, i) => tokenId(i))

const full: Box = { x: 0, y: 0, w: GRID, h: GRID }

/** Where each part sits when the mark is at rest, in grid units, measured from the glyph's top left. */
const FIXED_BOXES: Record<Exclude<PartId, TokenId>, Box> = {
  root: full,
  gh: full,
  F: full,
  c0: { x: 0, y: 0, w: 10, h: 10 },
  c1: { x: 10, y: 0, w: 10, h: 10 },
  c2: { x: 10, y: 10, w: 10, h: 10 },
  c3: { x: 0, y: 10, w: 10, h: 10 },
  G: full,
  GL: { x: 3, y: 5, w: 6.3, h: 10 },
  lb: { x: 3, y: 5, w: 1.7, h: 10 },
  lf: { x: 4.6, y: 5, w: 4.7, h: 10 },
  GU: { x: 11, y: 5, w: 6, h: 10 },
  // The stems reach 0.3 into the bowl so the join never shows a hairline at sizes off the grid.
  ul: { x: 11, y: 5, w: 1.7, h: 7.3 },
  ub: { x: 11, y: 12, w: 6, h: 3 },
  ur: { x: 15.3, y: 5, w: 1.7, h: 7.3 },
  T: full,
}

export function boxOf(id: PartId): Box {
  if (id in FIXED_BOXES) return FIXED_BOXES[id as Exclude<PartId, TokenId>]
  const [cx, cy] = TOKEN_HOMES[Number(id.slice(1))]
  return { x: cx - TOKEN_SIZE / 2, y: cy - TOKEN_SIZE / 2, w: TOKEN_SIZE, h: TOKEN_SIZE }
}

export function centreOf(id: PartId): { x: number; y: number } {
  const b = boxOf(id)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

/** The part a box is nested in. A child's transform rides on its parent's. */
export const PARENT: Partial<Record<Exclude<PartId, TokenId>, GroupId>> = {
  F: 'root', G: 'root', T: 'root',
  c0: 'F', c1: 'F', c2: 'F', c3: 'F',
  GL: 'G', GU: 'G',
  lb: 'GL', lf: 'GL',
  ul: 'GU', ub: 'GU', ur: 'GU',
}

/** Every part, parents before children. */
export const PART_IDS: readonly PartId[] = [
  'gh', 'root', 'F', 'c0', 'c1', 'c2', 'c3', 'G', 'GL', 'lb', 'lf', 'GU', 'ul', 'ub', 'ur', 'T', ...TOKEN_IDS,
]

/** Opacity of a part when no state says otherwise: the mark shows, tokens and the echo ring do not. */
export function restOpacity(id: PartId): number {
  return id === 'gh' || id.startsWith('t') ? 0 : 1
}

/**
 * The drawing of each visible part, in absolute grid units. `stroke` parts are
 * centre lines of the frame (width 1, square ends that meet on the grid),
 * `fill` parts are closed shapes.
 */
export const SHAPES: Partial<Record<PartId, { kind: 'stroke' | 'fill'; d: string }>> = {
  c0: { kind: 'stroke', d: 'M1 10V4.9A3.9 3.9 0 0 1 4.9 1H10' },
  c1: { kind: 'stroke', d: 'M10 1H15.1A3.9 3.9 0 0 1 19 4.9V10' },
  c2: { kind: 'stroke', d: 'M19 10V15.1A3.9 3.9 0 0 1 15.1 19H10' },
  c3: { kind: 'stroke', d: 'M10 19H4.9A3.9 3.9 0 0 1 1 15.1V10' },
  gh: { kind: 'stroke', d: 'M4.9 1H15.1A3.9 3.9 0 0 1 19 4.9V15.1A3.9 3.9 0 0 1 15.1 19H4.9A3.9 3.9 0 0 1 1 15.1V4.9A3.9 3.9 0 0 1 4.9 1Z' },
  lb: { kind: 'fill', d: 'M3 5H4.7V15H3Z' },
  // Legacy "lf" now carries both B bowls; animation track identities stay intact.
  lf: { kind: 'fill', d: 'M4.6 5H6.1C8 5 9 5.9 9 7.5C9 8.6 8.5 9.3 7.8 9.7C8.8 10.1 9.3 10.9 9.3 12.2C9.3 14 8.1 15 6.1 15H4.6V13.3H6C7.1 13.3 7.6 12.9 7.6 12.1C7.6 11.3 7.1 10.9 6 10.9H4.6V9.2H5.9C6.9 9.2 7.4 8.8 7.4 8C7.4 7.2 6.9 6.8 5.9 6.8H4.6Z' },
  ul: { kind: 'fill', d: 'M11 5H12.7V12.3H11Z' },
  ub: { kind: 'fill', d: 'M11 12A3 3 0 0 0 17 12H15.3A1.3 1.3 0 0 1 12.7 12Z' },
  ur: { kind: 'fill', d: 'M15.3 5H17V12.3H15.3Z' },
}

/** Corner radius of a token, as a share of its side. The frame's own ratio, so a token reads as a small frame. */
export const TOKEN_RADIUS = 0.5
