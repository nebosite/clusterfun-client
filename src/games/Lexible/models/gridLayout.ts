// ==========================================================================================
// How big the board is, and how big a tile is on the shared screen.
//
// The host picks ONE number - how many rows they want - and everything else follows from the
// space available:
//
//   tile size = play area height / rows        (so the rows exactly fill the height)
//   columns   = play area width / tile size    (so the columns exactly fill the width)
//
// Fewer rows means bigger tiles and a shorter, wider-feeling board; more rows means a denser
// one.  Either way the board fills the screen, which it did not before: the old size came
// from a fixed 34:24 ratio times a player-count guess, so it left a band of empty backing
// panel at most player counts and overflowed at others.
//
// The play area is in UINormalizer virtual pixels (1920x1080 canvas), so these numbers are
// resolution-independent - see Presenter.module.css .playColumn, which must match.
// ==========================================================================================

export const PLAY_AREA_WIDTH = 1535;

/**
 * Breathing room above and below the board.  The play column is 980 tall, but a board that
 * runs edge to edge in it collides with the round badge and sits uncomfortably against the
 * panel above, so the fillable area is inset by this much top and bottom.
 */
export const PLAY_AREA_VERTICAL_MARGIN = 50;
export const PLAY_AREA_HEIGHT = 980 - PLAY_AREA_VERTICAL_MARGIN * 2;

export const MIN_GRID_HEIGHT = 8;
export const MAX_GRID_HEIGHT = 30;
export const DEFAULT_GRID_HEIGHT = 18;

/** Keep a height inside the slider's range, and whole. */
export function sanitizeGridHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_GRID_HEIGHT;
  return Math.max(MIN_GRID_HEIGHT, Math.min(MAX_GRID_HEIGHT, Math.round(height)));
}

/** Tile size, in virtual pixels, that makes `rows` rows fill the play area's height. */
export function blockSizeForHeight(rows: number, areaHeight: number = PLAY_AREA_HEIGHT): number {
  return areaHeight / sanitizeGridHeight(rows);
}

/**
 * The most columns that fit across the play area at that tile size.  Floor, not round: a
 * partial column would be cut off by the play area's overflow and look like a rendering bug.
 */
export function gridWidthForHeight(
  rows: number,
  areaWidth: number = PLAY_AREA_WIDTH,
  areaHeight: number = PLAY_AREA_HEIGHT,
): number {
  return Math.max(1, Math.floor(areaWidth / blockSizeForHeight(rows, areaHeight)));
}
