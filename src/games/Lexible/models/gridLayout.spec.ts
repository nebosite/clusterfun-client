import {
  DEFAULT_GRID_HEIGHT,
  MAX_GRID_HEIGHT,
  MIN_GRID_HEIGHT,
  PLAY_AREA_HEIGHT,
  PLAY_AREA_WIDTH,
  blockSizeForHeight,
  gridWidthForHeight,
  sanitizeGridHeight,
} from "./gridLayout";

// The host picks a row count; everything else is derived so the board fills the screen.
// The property that matters is that it FITS: the old sizing came from a fixed ratio times a
// player-count guess, and left a band of empty backing panel at most sizes.

describe("sanitizeGridHeight", () => {
  it("keeps a sensible value untouched", () => {
    expect(sanitizeGridHeight(14)).toBe(14);
  });

  it("clamps to the slider's range", () => {
    expect(sanitizeGridHeight(1)).toBe(MIN_GRID_HEIGHT);
    expect(sanitizeGridHeight(9999)).toBe(MAX_GRID_HEIGHT);
  });

  it("rounds, because a grid cannot have half a row", () => {
    expect(sanitizeGridHeight(14.4)).toBe(14);
    expect(sanitizeGridHeight(14.6)).toBe(15);
  });

  it("falls back to the default for nonsense", () => {
    expect(sanitizeGridHeight(NaN)).toBe(DEFAULT_GRID_HEIGHT);
    expect(sanitizeGridHeight(Infinity)).toBe(DEFAULT_GRID_HEIGHT);
  });
});

describe("board sizing", () => {
  it("makes the rows exactly fill the height", () => {
    for (let rows = MIN_GRID_HEIGHT; rows <= MAX_GRID_HEIGHT; rows++) {
      expect(blockSizeForHeight(rows) * rows).toBeCloseTo(PLAY_AREA_HEIGHT, 6);
    }
  });

  it("never lets the columns overflow the width", () => {
    for (let rows = MIN_GRID_HEIGHT; rows <= MAX_GRID_HEIGHT; rows++) {
      const size = blockSizeForHeight(rows);
      expect(gridWidthForHeight(rows) * size).toBeLessThanOrEqual(PLAY_AREA_WIDTH);
    }
  });

  it("fits as many columns as it can - one more would overflow", () => {
    for (let rows = MIN_GRID_HEIGHT; rows <= MAX_GRID_HEIGHT; rows++) {
      const size = blockSizeForHeight(rows);
      expect((gridWidthForHeight(rows) + 1) * size).toBeGreaterThan(PLAY_AREA_WIDTH);
    }
  });

  it("gives more rows smaller tiles and more columns", () => {
    expect(blockSizeForHeight(10)).toBeGreaterThan(blockSizeForHeight(20));
    expect(gridWidthForHeight(10)).toBeLessThan(gridWidthForHeight(20));
  });

  it("always leaves room for both teams' starting columns", () => {
    // A owns column 0 and B column 1, so a board narrower than that is not a
    // board.  The minimum slider position must still clear it comfortably.
    expect(gridWidthForHeight(MIN_GRID_HEIGHT)).toBeGreaterThan(2);
  });

  it("clamps a silly row count before doing any of this", () => {
    expect(gridWidthForHeight(0)).toBe(gridWidthForHeight(MIN_GRID_HEIGHT));
    expect(blockSizeForHeight(0)).toBe(blockSizeForHeight(MIN_GRID_HEIGHT));
  });

  it("honours a custom play area, so the numbers are not baked in", () => {
    // 100 tall, 10 rows -> 10px tiles -> 25 columns across 250px.
    expect(blockSizeForHeight(10, 100)).toBe(10);
    expect(gridWidthForHeight(10, 250, 100)).toBe(25);
  });
});
