import {
  BACKGROUND_COUNT,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  collides,
  decodeGrid,
  decodeThumbnail,
  dragTowards,
  EittrisPiece,
  EMPTY_CELL,
  emptyGrid,
  encodeGrid,
  encodeThumbnail,
  gravityStep,
  hardDrop,
  initTargetRing,
  isResting,
  lockAndClear,
  makeBoard,
  MIN_INTERVAL_MS,
  moveTowardColumn,
  NEXT_PREVIEW_COUNT,
  NEXT_QUEUE_DEPTH,
  refillNextQueue,
  SPECIAL_MIN_ROW_GAP,
  defaultSettings,
  sanitizeSettings,
  rollAllowedSpecial,
  ANTIDOTE_MAX,
  nextLivingTarget,
  PIECE_COLORS,
  PIECE_COUNT,
  pieceCells,
  randomPieceType,
  rankBoards,
  retargetOnDeath,
  scoreForClear,
  slamHorizontal,
  SPAWN_X,
  SPAWN_Y,
  spawnNextFromQueue,
  spawnPiece,
  START_INTERVAL_MS,
  EXP_DECAY_PER_SEC,
  LINEAR_DECAY_MS_PER_SEC,
  tryMove,
  tryRotateCW,
  ANTIDOTES_AT_START,
  collectAndShiftMarkers,
  IMPLEMENTED_SPECIALS,
  occupiedCellIndices,
  pickSpecialCell,
  pruneOrphanedSpecials,
  specialsAreAnchored,
  rollSpecialType,
  SpecialType,
  countCoveredGaps,
  contactCount,
  scorePlacement,
  stackHeight,
  heightCost,
  heightZoneMultiplier,
  AI_GAP_PENALTY,
  AI_HEIGHT_UNIT,
  AI_CONTACT_WEIGHT,
  withPieceSettled,
  dropDestination,
  planPlacement,
  nextAiMove,
  makeWallShape,
  paintStencilRow,
  liftPieceClear,
  WALL_ROWS,
  GARBAGE_CELL,
  ESCALATOR_SHAPE,
  stencilShapeFor,
  SHACKLE_SHAPE,
  TOWER_SHAPE,
  TOWER_CELL,
  stencilCellFor,
  bridgeTopRow,
  paintBridgeColumn,
  SLOWDOWN_FACTOR,
  SPEEDUP_FACTOR,
  effectiveIntervalMs,
  cureAfflictions,
  EVIL_PIECE_COUNT,
  hasAfflictions,
  Z_PIECE_TYPES,
  PSYCHO_COLOR_COUNT,
  psychoPalette,
  emptyPsychoOverlay,
  xorPsychoOverlay,
  stampPsychoTrail,
  encodePsychoOverlay,
  decodePsychoOverlay,
  landingCells,
  classifyTap,
  CLEAR_FALL_MS,
  clearFallMs,
  fallProgress,
  rowDropAmounts,
  finalRowDrops,
  maxRowDrop,
  cellsLeftInEatenRow,
  collapseRows,
  lockOnly,
  MAX_ROBOTS,
  MAX_ROBOTS_STRESS,
  planBoardLayout,
  panelWidthFor,
  panelHeightFor,
  BOARD_MIN_CELL_PX,
  BOARD_MAX_CELL_PX,
  robotRoster,
  isRobotId,
  tryRotateCCW,
  AFFLICTION_DURATION_MS,
  AFFLICTION_TIMERS,
  startAffliction,
  afflictionMsLeft,
  tickAfflictions,
  jumbleOnce,
  JUMBLE_NUDGES,
  swapColumn,
} from "./eittrisLogic";

// Sorted "x,y" strings for order-independent cell comparison
function cellKeys(cells: { x: number; y: number }[]): string[] {
  return cells.map((c) => `${c.x},${c.y}`).sort();
}

function pieceAt(type: number, rot = 0, x = 0, y = 0): EittrisPiece {
  return { type, rot, x, y };
}

// ------------------------------------------------------------------------------------------
// Shapes + rotation
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - piece shapes and rotation", () => {
  it("has 7 pieces, each with a color and exactly 4 cells in every rotation", () => {
    expect(PIECE_COUNT).toBe(7);
    // ...plus the attack cells (garbage and the tower's stone)
    expect(PIECE_COLORS.length).toBeGreaterThanOrEqual(PIECE_COUNT);
    expect(PIECE_COLORS[GARBAGE_CELL]).toBeDefined();
    for (let type = 0; type < PIECE_COUNT; type++) expect(PIECE_COLORS[type]).toBeDefined();
    for (let type = 0; type < PIECE_COUNT; type++) {
      for (let rot = 0; rot < 4; rot++) {
        const cells = pieceCells(pieceAt(type, rot));
        expect(cells.length).toBe(4);
        // no duplicate cells
        expect(new Set(cellKeys(cells)).size).toBe(4);
      }
    }
  });

  it("matches the verbatim C# base shapes at rotation 0", () => {
    expect(cellKeys(pieceCells(pieceAt(0)))).toEqual(
      cellKeys([
        { x: -1, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
      ]),
    ); // T
    expect(cellKeys(pieceCells(pieceAt(1)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
      ]),
    ); // I
    expect(cellKeys(pieceCells(pieceAt(2)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ); // L
    expect(cellKeys(pieceCells(pieceAt(3)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 1 },
      ]),
    ); // reverse L
    expect(cellKeys(pieceCells(pieceAt(4)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: -1, y: -1 },
        { x: 1, y: 0 },
      ]),
    ); // Z
    expect(cellKeys(pieceCells(pieceAt(5)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 1, y: -1 },
        { x: -1, y: 0 },
      ]),
    ); // reverse Z
    expect(cellKeys(pieceCells(pieceAt(6)))).toEqual(
      cellKeys([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ); // O
  });

  it("R rotation maps (x,y) -> (-y,x): the T's flat row goes vertical", () => {
    // T rot 1: (-1,0)->(0,-1), (0,0)->(0,0), (1,0)->(0,1), (0,-1)->(1,0)
    expect(cellKeys(pieceCells(pieceAt(0, 1)))).toEqual(
      cellKeys([
        { x: 0, y: -1 },
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ]),
    );
  });

  it("returns to the original shape after 4 clockwise rotations (all pieces)", () => {
    for (let type = 0; type < PIECE_COUNT; type++) {
      expect(cellKeys(pieceCells(pieceAt(type, 4)))).toEqual(cellKeys(pieceCells(pieceAt(type))));
    }
  });

  it("corner rotation keeps the O piece's footprint identical in every rotation", () => {
    const base = cellKeys(pieceCells(pieceAt(6, 0)));
    for (let rot = 1; rot < 4; rot++) {
      expect(cellKeys(pieceCells(pieceAt(6, rot)))).toEqual(base);
    }
  });

  it("every rotation of every piece stays within a 5x5 neighborhood of its origin", () => {
    for (let type = 0; type < PIECE_COUNT; type++) {
      for (let rot = 0; rot < 4; rot++) {
        for (const c of pieceCells(pieceAt(type, rot))) {
          expect(Math.abs(c.x)).toBeLessThanOrEqual(2);
          expect(Math.abs(c.y)).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});

// ------------------------------------------------------------------------------------------
// Collision
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - collision", () => {
  it("flags out-of-bounds left, right, and bottom", () => {
    const grid = emptyGrid();
    expect(collides(grid, [{ x: -1, y: 5 }])).toBe(true);
    expect(collides(grid, [{ x: BOARD_WIDTH, y: 5 }])).toBe(true);
    expect(collides(grid, [{ x: 5, y: BOARD_HEIGHT }])).toBe(true);
    expect(collides(grid, [{ x: 5, y: BOARD_HEIGHT - 1 }])).toBe(false);
  });

  it("treats cells above the board (y < 0) as legal and non-colliding", () => {
    const grid = emptyGrid();
    expect(collides(grid, [{ x: 5, y: -1 }])).toBe(false);
    expect(collides(grid, [{ x: 5, y: -5 }])).toBe(false);
  });

  it("flags occupied cells (y >= 0 only)", () => {
    const grid = emptyGrid();
    grid[10][4] = 2;
    expect(collides(grid, [{ x: 4, y: 10 }])).toBe(true);
    expect(collides(grid, [{ x: 4, y: 9 }])).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------
// Movement
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - movement", () => {
  it("tryMove refuses a move into the wall (no wall kicks)", () => {
    const grid = emptyGrid();
    const atLeftWall = pieceAt(6, 0, 0, 5); // O occupies x 0..1
    expect(tryMove(grid, atLeftWall, -1, 0)).toBeNull();
    expect(tryMove(grid, atLeftWall, 1, 0)).not.toBeNull();
  });

  it("tryRotateCW refuses a blocked rotation and leaves rot unchanged", () => {
    const grid = emptyGrid();
    // T at rot 0 occupies (4,5)(5,5)(6,5)(5,4).  Rot 1 needs (5,4)(5,5)(5,6)(6,5).
    grid[6][5] = 0; // block (5,6)
    const piece = pieceAt(0, 0, 5, 5);
    expect(tryRotateCW(grid, piece)).toBeNull();
    grid[6][5] = EMPTY_CELL;
    expect(tryRotateCW(grid, piece)?.rot).toBe(1);
  });

  it("moveTowardColumn follows the target and stops at an obstruction", () => {
    const grid = emptyGrid();
    const piece = pieceAt(0, 0, 5, 5); // T, occupies x 4..6
    expect(moveTowardColumn(grid, piece, 8).x).toBe(8);
    expect(moveTowardColumn(grid, piece, 1).x).toBe(1);
    grid[5][8] = 3; // wall at x=8 in the piece's row
    expect(moveTowardColumn(grid, piece, 9).x).toBe(6); // right edge reaches x=7 -> origin 6
  });

  it("slamHorizontal runs to the walls", () => {
    const grid = emptyGrid();
    const piece = pieceAt(0, 0, 5, 5); // T needs x-1 and x+1 clear
    expect(slamHorizontal(grid, piece, -1).x).toBe(1);
    expect(slamHorizontal(grid, piece, 1).x).toBe(8);
  });

  it("hardDrop reports the rows dropped and rests on the stack", () => {
    const grid = emptyGrid();
    const piece = pieceAt(0, 0, 5, 0); // T flat row at y=0
    const dropped = hardDrop(grid, piece);
    expect(dropped.piece.y).toBe(BOARD_HEIGHT - 1);
    expect(dropped.rowsDropped).toBe(BOARD_HEIGHT - 1);

    grid[20][5] = 1; // one block under the center
    const resting = hardDrop(grid, piece);
    expect(resting.piece.y).toBe(BOARD_HEIGHT - 2);
  });
});

// ------------------------------------------------------------------------------------------
// Locking, clearing, scoring
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - lock + clear + score", () => {
  it("scores n*n*1000 for n cleared rows", () => {
    expect(scoreForClear(0)).toBe(0);
    expect(scoreForClear(1)).toBe(1000);
    expect(scoreForClear(2)).toBe(4000);
    expect(scoreForClear(3)).toBe(9000);
    expect(scoreForClear(4)).toBe(16000);
  });

  it("locks a piece into the grid without clearing anything", () => {
    const grid = emptyGrid();
    const result = lockAndClear(grid, pieceAt(0, 0, 5, BOARD_HEIGHT - 1));
    expect(result.cleared).toBe(0);
    expect(result.scoreGained).toBe(0);
    expect(result.grid[BOARD_HEIGHT - 1][4]).toBe(0);
    expect(result.grid[BOARD_HEIGHT - 1][5]).toBe(0);
    expect(result.grid[BOARD_HEIGHT - 1][6]).toBe(0);
    expect(result.grid[BOARD_HEIGHT - 2][5]).toBe(0);
    // the input grid is untouched (pure)
    expect(grid[BOARD_HEIGHT - 1][5]).toBe(EMPTY_CELL);
  });

  it("discards locked cells above the top of the board", () => {
    const grid = emptyGrid();
    // I piece vertical at y=0 spans y -1..2; the y=-1 cell just disappears
    const result = lockAndClear(grid, pieceAt(1, 0, 5, 0));
    expect(result.grid[0][5]).toBe(1);
    expect(result.grid[1][5]).toBe(1);
    expect(result.grid[2][5]).toBe(1);
    expect(result.grid.length).toBe(BOARD_HEIGHT);
  });

  it("clears a single full row and shifts the stack down", () => {
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) if (x < 4 || x > 6) grid[20][x] = 1;
    grid[19][0] = 2; // a marker block above the full row

    // T lands flat filling (4..6, 20) with its bump at (5,19)
    const result = lockAndClear(grid, pieceAt(0, 0, 5, 20));
    expect(result.cleared).toBe(1);
    expect(result.scoreGained).toBe(1000);
    // row 20 cleared; the marker and the T bump shifted down one row
    expect(result.grid[20][0]).toBe(2);
    expect(result.grid[20][5]).toBe(0);
    expect(result.grid[20][1]).toBe(EMPTY_CELL);
  });

  it("clears four rows at once with the I piece (16000 points)", () => {
    const grid = emptyGrid();
    for (let y = 17; y <= 20; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) if (x !== 9) grid[y][x] = 1;
    }
    // vertical I at x=9 fills rows 17..20 (y=18 spans y-1..y+2)
    const result = lockAndClear(grid, pieceAt(1, 0, 9, 18));
    expect(result.cleared).toBe(4);
    expect(result.scoreGained).toBe(16000);
    expect(result.grid.every((row) => row.every((cell) => cell === EMPTY_CELL))).toBe(true);
  });

  it("clears non-adjacent full rows atomically", () => {
    const grid = emptyGrid();
    for (let x = 1; x < BOARD_WIDTH; x++) {
      grid[18][x] = 1; // row 18: missing only x=0
      if (x !== 5) grid[19][x] = 2; // row 19: missing x=0 AND x=5 - stays partial
      grid[20][x] = 3; // row 20: missing only x=0
    }

    // vertical I at x=0, y=18 fills (0,17)(0,18)(0,19)(0,20): completes rows 18 and 20
    const result = lockAndClear(grid, pieceAt(1, 0, 0, 18));
    expect(result.cleared).toBe(2);
    expect(result.scoreGained).toBe(4000);
    // the partial row 19 survives (with the I's cell at x=0), now at the bottom
    expect(result.grid[20][0]).toBe(1);
    expect(result.grid[20][1]).toBe(2);
    expect(result.grid[20][5]).toBe(EMPTY_CELL);
    // old row 17's lone I cell lands just above it
    expect(result.grid[19][0]).toBe(1);
    expect(result.grid[19][1]).toBe(EMPTY_CELL);
  });
});

// ------------------------------------------------------------------------------------------
// Gravity curve
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - gravity curve", () => {
  it("decays exponentially above the knee", () => {
    const next = gravityStep(1000, 1);
    expect(next).toBeCloseTo(1000 * Math.exp(-EXP_DECAY_PER_SEC), 6);
  });

  it("decays linearly below the knee", () => {
    expect(gravityStep(400, 2)).toBeCloseTo(400 - 2 * LINEAR_DECAY_MS_PER_SEC, 6);
  });

  it("is monotonically decreasing over a long simulated game", () => {
    let interval = START_INTERVAL_MS;
    let previous = interval;
    for (let t = 0; t < 5000; t++) {
      // Long enough to reach the clamp even at the slower decay
      interval = gravityStep(interval, 1);
      expect(interval).toBeLessThanOrEqual(previous);
      previous = interval;
    }
    expect(interval).toBe(MIN_INTERVAL_MS);
  });

  it("clamps at the minimum interval", () => {
    expect(gravityStep(MIN_INTERVAL_MS, 10)).toBe(MIN_INTERVAL_MS);
    expect(gravityStep(81, 100)).toBe(MIN_INTERVAL_MS);
  });

  it("takes several minutes to halve, which is the point of the slower tuning", () => {
    // The game used to reach half its starting interval in about two minutes; it was
    // landing pieces faster than people could think about them.  Both the start speed
    // and the acceleration were cut by 60%, so this should now take far longer.
    let interval = START_INTERVAL_MS;
    let seconds = 0;
    while (interval > START_INTERVAL_MS / 2 && seconds < 3000) {
      interval = gravityStep(interval, 1);
      seconds++;
    }
    expect(seconds).toBeGreaterThan(240);
  });

  it("starts slow enough to think about", () => {
    // One row every two and a half seconds at the start, not one per second
    expect(START_INTERVAL_MS).toBe(2500);
  });
});

// ------------------------------------------------------------------------------------------
// Spawning + queue
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - spawning", () => {
  it("spawns at the spawn point with the requested rotation normalized", () => {
    const piece = spawnPiece(3, 5);
    expect(piece.x).toBe(SPAWN_X);
    expect(piece.y).toBe(SPAWN_Y);
    expect(piece.rot).toBe(1);
  });

  it("randomPieceType covers all 7 types uniformly at the boundaries", () => {
    expect(randomPieceType(() => 0)).toBe(0);
    expect(randomPieceType(() => 0.999999)).toBe(6);
  });

  it("spawnNextFromQueue consumes the head and keeps the preview stocked", () => {
    let calls = 0;
    const rand = () => {
      // types 2 then rotation etc - just cycle small values
      calls++;
      return 0.3;
    };
    const first = spawnNextFromQueue([4], rand);
    expect(first.piece.type).toBe(4); // the head is what falls
    // and the tray is restocked, so the phone always has something to show
    expect(first.queue.length).toBe(NEXT_QUEUE_DEPTH);
    expect(calls).toBeGreaterThan(0);

    // An empty queue is filled before anything is taken from it
    const fromEmpty = spawnNextFromQueue([], rand);
    expect(fromEmpty.piece).not.toBeNull();
    expect(fromEmpty.queue.length).toBe(NEXT_QUEUE_DEPTH);
  });

  it("a fresh spawn into a blocked spawn area collides (board death condition)", () => {
    const grid = emptyGrid();
    grid[0][5] = 2;
    const piece = spawnPiece(0, 0); // T occupies (4,0)(5,0)(6,0)(5,-1)
    expect(collides(grid, pieceCells(piece))).toBe(true);
  });

  it("makeBoard builds a live board with a piece, a stocked queue, and a background", () => {
    const board = makeBoard("p1", () => 0.1);
    expect(board.alive).toBe(true);
    expect(board.piece).not.toBeNull();
    expect(board.nextQueue.length).toBe(NEXT_QUEUE_DEPTH);
    expect(board.intervalMs).toBe(START_INTERVAL_MS);
    expect(board.grid.length).toBe(BOARD_HEIGHT);
    expect(board.grid[0].length).toBe(BOARD_WIDTH);
    expect(board.backgroundIndex).toBeGreaterThanOrEqual(0);
    expect(board.backgroundIndex).toBeLessThan(BACKGROUND_COUNT);
    expect(board.targetId).toBeNull();
    expect(board.pieceSeq).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------
// Ranking
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - rankBoards", () => {
  function board(playerId: string, alive: boolean, deathOrder: number, score: number) {
    return { ...makeBoard(playerId, () => 0), alive, deathOrder, score };
  }

  it("ranks survivors first (by score), then later deaths, then score", () => {
    const ranked = rankBoards([
      board("earlyDeath", false, 1, 99999),
      board("survivor", true, 0, 100),
      board("lateDeath", false, 2, 50),
    ]);
    expect(ranked.map((b) => b.playerId)).toEqual(["survivor", "lateDeath", "earlyDeath"]);
  });

  it("breaks a same-death-order tie by score", () => {
    const ranked = rankBoards([board("low", false, 1, 100), board("high", false, 1, 2000)]);
    expect(ranked[0].playerId).toBe("high");
  });
});

// ------------------------------------------------------------------------------------------
// Free 2D drag
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - dragTowards", () => {
  it("moves horizontally AND down at once toward the target", () => {
    const grid = emptyGrid();
    const result = dragTowards(grid, pieceAt(0, 0, 5, 5), 8, 8);
    expect(result.piece.x).toBe(8);
    expect(result.piece.y).toBe(8);
    expect(result.rowsDescended).toBe(3);
  });

  it("never moves up (a target row above the piece is ignored)", () => {
    const grid = emptyGrid();
    const result = dragTowards(grid, pieceAt(0, 0, 5, 5), 7, 2);
    expect(result.piece.x).toBe(7);
    expect(result.piece.y).toBe(5);
    expect(result.rowsDescended).toBe(0);
  });

  it("stops at a horizontal obstruction when it cannot descend past it", () => {
    const grid = emptyGrid();
    grid[5][8] = 1; // blocks the T (occupies x-1..x+1) from reaching x=7 at y=5
    const result = dragTowards(grid, pieceAt(0, 0, 5, 5), 8, 5);
    expect(result.piece.x).toBe(6);
    expect(result.piece.y).toBe(5);
  });

  it("navigates around an obstruction by descending below it", () => {
    const grid = emptyGrid();
    grid[5][8] = 1; // same wall, but the drag also goes down
    const result = dragTowards(grid, pieceAt(0, 0, 5, 5), 8, 8);
    expect(result.piece.x).toBe(8);
    expect(result.piece.y).toBe(8);
  });

  it("stops descending on the stack but keeps sliding sideways - and does NOT lock", () => {
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) grid[8][x] = 2; // a full shelf at row 8
    const result = dragTowards(grid, pieceAt(0, 0, 5, 5), 8, 15);
    expect(result.piece.y).toBe(7); // resting on the shelf
    expect(result.piece.x).toBe(8);
    expect(result.rowsDescended).toBe(2);
    // still a live piece - locking is the caller's decision (release/gravity)
    expect(isResting(grid, result.piece)).toBe(true);
  });
});

describe("eittrisLogic - isResting", () => {
  it("is false in open air and true on the floor or the stack", () => {
    const grid = emptyGrid();
    expect(isResting(grid, pieceAt(0, 0, 5, 5))).toBe(false);
    expect(isResting(grid, pieceAt(0, 0, 5, BOARD_HEIGHT - 1))).toBe(true);
    grid[6][5] = 1; // block right under the T's center
    expect(isResting(grid, pieceAt(0, 0, 5, 5))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------
// Target targeting
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - target targeting", () => {
  function boardsFor(ids: string[]) {
    return ids.map((id) => makeBoard(id, () => 0));
  }

  it("initTargetRing points each player at the next one (and null when solo)", () => {
    const boards = boardsFor(["A", "B", "C"]);
    initTargetRing(boards);
    expect(boards.map((b) => b.targetId)).toEqual(["B", "C", "A"]);

    const solo = boardsFor(["A"]);
    initTargetRing(solo);
    expect(solo[0].targetId).toBeNull();
  });

  it("nextLivingTarget walks the ring, skipping the dead and self", () => {
    const ring = ["A", "B", "C", "D"];
    expect(nextLivingTarget(ring, new Set(["A", "C"]), "A", "B")).toBe("C");
    expect(nextLivingTarget(ring, new Set(["A", "D"]), "A", "B")).toBe("D");
    // nobody left but me
    expect(nextLivingTarget(["A", "B"], new Set(["A"]), "A", "B")).toBeNull();
    // unknown fromId
    expect(nextLivingTarget(ring, new Set(ring), "A", "ghost")).toBeNull();
  });

  it("retargetOnDeath re-aims every board that targeted the dead player", () => {
    const boards = boardsFor(["A", "B", "C"]);
    initTargetRing(boards); // A->B, B->C, C->A
    boards[1].alive = false; // B dies
    const changed = retargetOnDeath(boards, "B");
    expect(changed).toEqual(["A"]);
    expect(boards[0].targetId).toBe("C"); // A re-aims past dead B
    expect(boards[1].targetId).toBe("C"); // B (dead) untouched - wasn't targeting B
    expect(boards[2].targetId).toBe("A");
  });

  it("retargets to null when the dead target was the last other player", () => {
    const boards = boardsFor(["A", "B"]);
    initTargetRing(boards); // A->B, B->A
    boards[1].alive = false;
    retargetOnDeath(boards, "B");
    expect(boards[0].targetId).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------
// 1-bit thumbnails
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - thumbnails", () => {
  it("encodes 210 cells into a 36-char base64 string and round-trips", () => {
    const grid = emptyGrid();
    grid[20][0] = 1;
    grid[20][9] = 2;
    grid[10][5] = 3;

    const thumb = encodeThumbnail(grid);
    expect(thumb.length).toBe(36);
    expect(thumb).toMatch(/^[A-Za-z0-9+/]+$/);

    const cells = decodeThumbnail(thumb);
    expect(cells.length).toBe(BOARD_WIDTH * BOARD_HEIGHT);
    const on = (x: number, y: number) => cells[y * BOARD_WIDTH + x];
    expect(on(0, 20)).toBe(true);
    expect(on(9, 20)).toBe(true);
    expect(on(5, 10)).toBe(true);
    expect(cells.filter(Boolean).length).toBe(3);
  });

  it("ignores the falling piece, so a board only changes when a piece settles", () => {
    // This is what lets an unchanged board be left out of the broadcast entirely.
    const grid = emptyGrid();
    grid[20][0] = 1;
    const before = encodeThumbnail(grid);

    // A piece hanging in mid-air over that same grid must encode identically
    const piece = pieceAt(0, 0, 5, 5);
    expect(piece).toBeTruthy();
    expect(encodeThumbnail(grid)).toBe(before);

    // Settling it is what changes the picture
    grid[5][5] = 1;
    expect(encodeThumbnail(grid)).not.toBe(before);
  });

  it("an empty board with no piece is all zeros", () => {
    const thumb = encodeThumbnail(emptyGrid());
    expect(thumb).toBe("A".repeat(36)); // base64 'A' = 000000
    expect(decodeThumbnail(thumb).every((cell) => !cell)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------
// Wire encoding
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - grid encoding", () => {
  it("encodes to a 210-char string and round-trips", () => {
    const grid = emptyGrid();
    grid[0][0] = 0;
    grid[10][5] = 6;
    grid[20][9] = 3;
    const encoded = encodeGrid(grid);
    expect(encoded.length).toBe(BOARD_WIDTH * BOARD_HEIGHT);
    expect(encoded[0]).toBe("0");
    expect(encoded[10 * BOARD_WIDTH + 5]).toBe("6");
    expect(encoded[20 * BOARD_WIDTH + 9]).toBe("3");
    expect(decodeGrid(encoded)).toEqual(grid);
  });

  it("an empty grid is all dots", () => {
    expect(encodeGrid(emptyGrid())).toBe(".".repeat(BOARD_WIDTH * BOARD_HEIGHT));
  });
});

// ------------------------------------------------------------------------------------------
// Specials (powerups)
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - special markers", () => {
  const gridWithRow = (row: number) => {
    const g = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) g[row][x] = 0;
    return g;
  };

  it("only offers settled blocks as marker sites", () => {
    const g = emptyGrid();
    g[5][3] = 2;
    expect(occupiedCellIndices(g)).toEqual([5 * BOARD_WIDTH + 3]);
    expect(pickSpecialCell(g, [], () => 0)).toBe(5 * BOARD_WIDTH + 3);
  });

  it("never double-tags a block, and reports none when the grid is bare", () => {
    const g = emptyGrid();
    g[5][3] = 2;
    const taken = [{ index: 5 * BOARD_WIDTH + 3, type: SpecialType.Antidote }];
    expect(pickSpecialCell(g, taken, () => 0)).toBeNull();
    expect(pickSpecialCell(emptyGrid(), [], () => 0)).toBeNull();
  });

  it("rolls an antidote at the configured rate", () => {
    expect(rollSpecialType(() => 0.1, 0.5)).toBe(SpecialType.Antidote);
    // above the threshold it draws from the implemented pool
    expect(IMPLEMENTED_SPECIALS).toContain(rollSpecialType(() => 0.9, 0.5));
  });

  it("collects markers on cleared rows and rides the rest down", () => {
    const markers = [
      { index: 20 * BOARD_WIDTH + 4, type: SpecialType.Antidote }, // on the cleared row
      { index: 18 * BOARD_WIDTH + 7, type: SpecialType.Antidote }, // above it
    ];
    const { collected, markers: left } = collectAndShiftMarkers(markers, [20]);
    expect(collected).toEqual([SpecialType.Antidote]);
    expect(left.length).toBe(1);
    // shifted down one row, same column
    expect(left[0].index).toBe(19 * BOARD_WIDTH + 7);
  });

  it("leaves markers alone when nothing cleared", () => {
    const markers = [{ index: 42, type: SpecialType.Antidote }];
    const out = collectAndShiftMarkers(markers, []);
    expect(out.collected).toEqual([]);
    expect(out.markers).toBe(markers);
  });

  it("reports which rows cleared so markers can be resolved", () => {
    const g = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (x < 4 || x > 6) g[BOARD_HEIGHT - 1][x] = 1;
    }
    const result = lockAndClear(g, spawnPiece(0, 0)); // T fills 4..6 - wrong row though
    expect(result.clearedRows).toEqual([]);

    // now really fill the bottom row
    const full = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) full[BOARD_HEIGHT - 1][x] = 1;
    const cleared = lockAndClear(full, { type: 0, rot: 0, x: 5, y: 0 });
    expect(cleared.clearedRows).toEqual([BOARD_HEIGHT - 1]);
  });

  it("starts a board with one antidote and no specials", () => {
    const board = makeBoard("p1", () => 0.1);
    expect(board.antidotes).toBe(ANTIDOTES_AT_START);
    expect(board.specials).toEqual([]);
    expect(board.shieldMs).toBe(0);
    expect(board.forcedSpecial).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------
// Computer player
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - AI placement", () => {
  const gridWith = (fill: (g: number[][]) => void) => {
    const g = emptyGrid();
    fill(g);
    return g;
  };

  it("counts covered gaps, not open space", () => {
    const open = gridWith((g) => {
      g[BOARD_HEIGHT - 1][0] = 1; // a lone block, nothing above it
    });
    expect(countCoveredGaps(open)).toBe(0);

    const holed = gridWith((g) => {
      g[BOARD_HEIGHT - 2][0] = 1; // roof...
      // ...with BOARD_HEIGHT-1 empty underneath = one covered gap
    });
    expect(countCoveredGaps(holed)).toBe(1);
  });

  it("counts contact with the floor, walls and settled blocks", () => {
    const g = emptyGrid();
    // O piece resting in the bottom-left corner
    const piece = { type: 6, rot: 0, x: 0, y: BOARD_HEIGHT - 2 };
    // 2 floor contacts + 2 left-wall contacts
    expect(contactCount(g, piece)).toBe(4);
  });

  it("prefers a flush landing over one that roofs a hole", () => {
    // A one-column notch: dropping flat over it would cover the hole
    const g = gridWith((grid) => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x !== 3) grid[BOARD_HEIGHT - 1][x] = 1;
      }
    });
    const flat = { type: 1, rot: 1, x: 3, y: 0 }; // horizontal I over the notch
    const upright = { type: 1, rot: 0, x: 3, y: 0 }; // vertical I into the notch
    const flatScore = scorePlacement(g, dropDestination(g, flat));
    const uprightScore = scorePlacement(g, dropDestination(g, upright));
    expect(uprightScore).toBeGreaterThan(flatScore);
  });

  it("plans a legal placement for every piece on an empty board", () => {
    const g = emptyGrid();
    for (let type = 0; type < PIECE_COUNT; type++) {
      const plan = planPlacement(g, spawnPiece(type, 0));
      expect(plan).not.toBeNull();
      expect(plan!.x).toBeGreaterThanOrEqual(0);
      expect(plan!.x).toBeLessThan(BOARD_WIDTH);
      expect(plan!.rot).toBeGreaterThanOrEqual(0);
      expect(plan!.rot).toBeLessThan(4);
      // The plan must actually be placeable
      expect(collides(g, pieceCells({ ...spawnPiece(type, 0), rot: plan!.rot, x: plan!.x }))).toBe(
        false,
      );
    }
  });

  it("still prefers the clean placement when both sit equally low", () => {
    // Nothing has changed about preferring not to bury cells - only about
    // what that preference is worth against height.
    const shallow = gridWith((grid) => {
      for (let x = 0; x < BOARD_WIDTH; x++) if (x !== 8) grid[BOARD_HEIGHT - 1][x] = 1;
    });
    const O = { type: 6, rot: 0, x: 2, y: 0, evil: false };
    const clean = dropDestination(shallow, O);
    const overTheWell = dropDestination(shallow, { ...O, x: 7 });
    expect(scorePlacement(shallow, clean)).toBeGreaterThan(scorePlacement(shallow, overTheWell));
  });

  it("takes the option with fewer covered gaps when it must choose", () => {
    // Flat ground: a horizontal Z leaves a hole, so the planner should reach
    // for the orientation/column that leaves the fewest
    const g = emptyGrid();
    const plan = planPlacement(g, spawnPiece(4, 0))!; // Z
    const landed = dropDestination(g, { type: 4, rot: plan.rot, x: plan.x, y: 0 });
    const after = g.map((row) => row.slice());
    for (const c of pieceCells(landed)) {
      if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) after[c.y][c.x] = 4;
    }
    expect(countCoveredGaps(after)).toBeLessThanOrEqual(1);
  });

  it("walks toward the plan one step at a time: rotate, then sideways", () => {
    const piece = { type: 0, rot: 0, x: 5, y: 0 };
    expect(nextAiMove(piece, { rot: 2, x: 5, score: 0 })).toBe("rotate");
    expect(nextAiMove(piece, { rot: 0, x: 2, score: 0 })).toBe("left");
    expect(nextAiMove(piece, { rot: 0, x: 8, score: 0 })).toBe("right");
    expect(nextAiMove(piece, { rot: 0, x: 5, score: 0 })).toBeNull(); // let it fall
  });
});

// ------------------------------------------------------------------------------------------
// Attack stencils (TheWall)
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - attack stencils", () => {
  it("builds a wall of solid rows, each with exactly one gap", () => {
    const shape = makeWallShape(() => 0.35);
    expect(shape.length).toBe(WALL_ROWS);
    for (const row of shape) {
      expect(row.length).toBe(BOARD_WIDTH);
      expect((row.match(/-/g) || []).length).toBe(1);
      expect((row.match(/#/g) || []).length).toBe(BOARD_WIDTH - 1);
    }
  });

  it("paints from the bottom up, overwriting what was there", () => {
    const grid = emptyGrid();
    grid[BOARD_HEIGHT - 1][0] = 2; // an existing block the wall will bury
    const shape = ["##########", "#########-"];

    // row 0 = the shape's LAST row, landing on the grid's bottom row
    const after = paintStencilRow(grid, shape, 0, false);
    expect(after[BOARD_HEIGHT - 1][0]).toBe(GARBAGE_CELL); // overwritten
    expect(after[BOARD_HEIGHT - 1][BOARD_WIDTH - 1]).toBe(EMPTY_CELL); // '-' cleared it
    expect(after[BOARD_HEIGHT - 2].every((c) => c === EMPTY_CELL)).toBe(true); // untouched

    // row 1 lands one higher
    const after2 = paintStencilRow(after, shape, 1, false);
    expect(after2[BOARD_HEIGHT - 2].every((c) => c === GARBAGE_CELL)).toBe(true);
  });

  it("mirrors the shape when reversed", () => {
    const grid = emptyGrid();
    const shape = ["-#########"]; // gap at the far left
    const normal = paintStencilRow(grid, shape, 0, false);
    const mirrored = paintStencilRow(grid, shape, 0, true);
    expect(normal[BOARD_HEIGHT - 1][0]).toBe(EMPTY_CELL);
    expect(mirrored[BOARD_HEIGHT - 1][BOARD_WIDTH - 1]).toBe(EMPTY_CELL);
    expect(mirrored[BOARD_HEIGHT - 1][0]).toBe(GARBAGE_CELL);
  });

  it("never fills a row completely, so a wall alone cannot score", () => {
    const shape = makeWallShape(() => 0.5);
    let grid = emptyGrid();
    for (let r = 0; r < shape.length; r++) grid = paintStencilRow(grid, shape, r, false);
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      expect(grid[y].every((c) => c !== EMPTY_CELL)).toBe(false);
    }
  });

  it("lifts a buried piece clear of the new blocks", () => {
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) grid[BOARD_HEIGHT - 1][x] = GARBAGE_CELL;
    const buried = { type: 6, rot: 0, x: 4, y: BOARD_HEIGHT - 1 }; // O inside the wall
    const lifted = liftPieceClear(grid, buried);
    expect(lifted).not.toBeNull();
    expect(collides(grid, pieceCells(lifted!))).toBe(false);
    expect(lifted!.y).toBeLessThan(buried.y);
  });

  it("pushes the piece above a packed board rather than losing it", () => {
    // Cells above the board are legal (that is where pieces spawn), so a
    // fully buried piece ends up overhead - the board then tops out on the
    // next lock, which is the right outcome.
    const grid = emptyGrid();
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) grid[y][x] = GARBAGE_CELL;
    }
    const lifted = liftPieceClear(grid, { type: 6, rot: 0, x: 4, y: 5 });
    expect(lifted).not.toBeNull();
    expect(lifted!.y).toBeLessThan(0);
    expect(collides(grid, pieceCells(lifted!))).toBe(false);
  });
});

describe("eittrisLogic - Escalator", () => {
  it("is a staircase that climbs one column per row", () => {
    expect(ESCALATOR_SHAPE.length).toBe(10);
    for (const row of ESCALATOR_SHAPE) expect(row.length).toBe(BOARD_WIDTH);
    // Bottom row builds at the far left, each row up shifts one right
    expect(ESCALATOR_SHAPE[ESCALATOR_SHAPE.length - 1].indexOf("#")).toBe(0);
    expect(ESCALATOR_SHAPE[0].indexOf("#")).toBe(BOARD_WIDTH - 1);
    for (let i = 1; i < ESCALATOR_SHAPE.length; i++) {
      const above = ESCALATOR_SHAPE[i - 1].indexOf("#");
      const below = ESCALATOR_SHAPE[i].indexOf("#");
      expect(above - below).toBe(1);
    }
  });

  it("is registered as a stencil attack", () => {
    expect(stencilShapeFor(SpecialType.Escalator, () => 0.5)).toEqual(ESCALATOR_SHAPE);
    expect(stencilShapeFor(SpecialType.TheWall, () => 0.5)!.length).toBe(WALL_ROWS);
    expect(stencilShapeFor(SpecialType.Antidote, () => 0.5)).toBeNull();
  });

  it("paints a rising staircase of garbage", () => {
    let grid = emptyGrid();
    for (let r = 0; r < ESCALATOR_SHAPE.length; r++) {
      grid = paintStencilRow(grid, ESCALATOR_SHAPE, r, false);
    }
    // one block on the bottom row at column 0, climbing one column per row up
    expect(grid[BOARD_HEIGHT - 1][0]).toBe(GARBAGE_CELL);
    expect(grid[BOARD_HEIGHT - 2][1]).toBe(GARBAGE_CELL);
    expect(grid[BOARD_HEIGHT - 10][9]).toBe(GARBAGE_CELL);
    // and it leaves the rest of each row alone
    expect(grid[BOARD_HEIGHT - 1][5]).toBe(EMPTY_CELL);
  });
});

describe("eittrisLogic - Shackle", () => {
  it("is a hollow ring: a solid outline around an empty middle", () => {
    expect(SHACKLE_SHAPE.length).toBe(11);
    for (const row of SHACKLE_SHAPE) expect(row.length).toBe(BOARD_WIDTH);
    // the widest rows reach both walls
    expect(SHACKLE_SHAPE[4][0]).toBe("#");
    expect(SHACKLE_SHAPE[4][BOARD_WIDTH - 1]).toBe("#");
    // and their middles are untouched
    expect(SHACKLE_SHAPE[4].slice(2, 8)).toBe("......");
  });

  it("paints a ring whose inside stays empty", () => {
    let grid = emptyGrid();
    for (let r = 0; r < SHACKLE_SHAPE.length; r++) {
      grid = paintStencilRow(grid, SHACKLE_SHAPE, r, false);
    }
    // ring wall present on the widest row (shape row 4 -> 11-1-4 = 6 up)
    const wideY = BOARD_HEIGHT - 1 - 6;
    expect(grid[wideY][0]).toBe(GARBAGE_CELL);
    expect(grid[wideY][BOARD_WIDTH - 1]).toBe(GARBAGE_CELL);
    // hollow middle
    expect(grid[wideY][4]).toBe(EMPTY_CELL);
    expect(grid[wideY][5]).toBe(EMPTY_CELL);
  });

  it("carves away blocks under its '-' outline", () => {
    const grid = emptyGrid();
    // fill the row the ring's bottom lands on
    for (let x = 0; x < BOARD_WIDTH; x++) grid[BOARD_HEIGHT - 1][x] = 1;
    const after = paintStencilRow(grid, SHACKLE_SHAPE, 0, false);
    // bottom shape row is "..-####-.." - '-' at index 2 and 7 clear blocks
    expect(after[BOARD_HEIGHT - 1][2]).toBe(EMPTY_CELL);
    expect(after[BOARD_HEIGHT - 1][7]).toBe(EMPTY_CELL);
    expect(after[BOARD_HEIGHT - 1][3]).toBe(GARBAGE_CELL);
    expect(after[BOARD_HEIGHT - 1][0]).toBe(1); // '.' left alone
  });
});

describe("eittrisLogic - TowerOfEit", () => {
  it("is a 12-row tower with crenellations on top", () => {
    expect(TOWER_SHAPE.length).toBe(12);
    for (const row of TOWER_SHAPE) expect(row.length).toBe(BOARD_WIDTH);
    expect(TOWER_SHAPE[0]).toBe("-#-#--#-#-"); // battlements
    expect(TOWER_SHAPE[TOWER_SHAPE.length - 1]).toBe("--######--"); // solid base
  });

  it("lays its own darker stone, not ordinary garbage", () => {
    expect(stencilCellFor(SpecialType.TowerOfEit)).toBe(TOWER_CELL);
    expect(stencilCellFor(SpecialType.TheWall)).toBe(GARBAGE_CELL);
    expect(stencilCellFor(SpecialType.Escalator)).toBe(GARBAGE_CELL);
    expect(PIECE_COLORS[TOWER_CELL]).toBeDefined();
    expect(PIECE_COLORS[TOWER_CELL]).not.toBe(PIECE_COLORS[GARBAGE_CELL]);
  });

  it("paints in stone when asked to", () => {
    let grid = emptyGrid();
    grid = paintStencilRow(grid, TOWER_SHAPE, 0, false, TOWER_CELL);
    // bottom row "--######--": columns 2..7 are stone, edges untouched
    expect(grid[BOARD_HEIGHT - 1][2]).toBe(TOWER_CELL);
    expect(grid[BOARD_HEIGHT - 1][7]).toBe(TOWER_CELL);
    expect(grid[BOARD_HEIGHT - 1][0]).toBe(EMPTY_CELL);
  });
});

describe("eittrisLogic - Bridge", () => {
  it("finds the row just above the stack", () => {
    const grid = emptyGrid();
    expect(bridgeTopRow(grid)).toBe(BOARD_HEIGHT - 2); // empty board (matches the original)
    grid[10][3] = 1;
    expect(bridgeTopRow(grid)).toBe(9); // one row above the highest block
  });

  it("roofs the stack with two rows, one gap each", () => {
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) grid[15][x] = 1; // a stack topping at row 15
    const plan = { topY: 14, skipX: [2, 5], column: 0, timerMs: 0, blockCell: GARBAGE_CELL };

    let painted = grid;
    for (let c = 0; c < BOARD_WIDTH; c++) {
      painted = paintBridgeColumn(painted, { ...plan, column: c });
    }
    // row 14 solid except its gap at column 2
    expect(painted[14][2]).toBe(EMPTY_CELL);
    expect(painted[14][0]).toBe(GARBAGE_CELL);
    // row 13 solid except its gap at column 5
    expect(painted[13][5]).toBe(EMPTY_CELL);
    expect(painted[13][0]).toBe(GARBAGE_CELL);
    // the stack below is untouched
    expect(painted[15].every((c) => c === 1)).toBe(true);
  });

  it("destroys what is under its gaps", () => {
    const grid = emptyGrid();
    grid[14][2] = 3; // a block right where the gap will fall
    const plan = { topY: 14, skipX: [2, 5], column: 2, timerMs: 0, blockCell: GARBAGE_CELL };
    const painted = paintBridgeColumn(grid, plan);
    expect(painted[14][2]).toBe(EMPTY_CELL);
  });

  it("clips safely against the top of the board", () => {
    const grid = emptyGrid();
    const plan = { topY: 0, skipX: [4, 4], column: 3, timerMs: 0, blockCell: GARBAGE_CELL };
    expect(() => paintBridgeColumn(grid, plan)).not.toThrow();
    const painted = paintBridgeColumn(grid, plan);
    expect(painted[0][3]).toBe(GARBAGE_CELL); // row 0 painted, row -1 skipped
  });
});

describe("eittrisLogic - SlowDown", () => {
  it("eases gravity, the mirror of Speedup", () => {
    const base = 1000;
    expect(effectiveIntervalMs(base, 0, 1)).toBeCloseTo(base * SLOWDOWN_FACTOR, 5);
    expect(effectiveIntervalMs(base, 0, 2)).toBeCloseTo(base * SLOWDOWN_FACTOR ** 2, 5);
    expect(effectiveIntervalMs(base, 0, 1)).toBeGreaterThan(base);
  });

  it("cancels out against Speedup", () => {
    const base = 1000;
    const both = effectiveIntervalMs(base, 1, 1);
    expect(both).toBeCloseTo(base * SPEEDUP_FACTOR * SLOWDOWN_FACTOR, 5);
    expect(both).toBeLessThan(base); // speedup is the stronger multiplier
  });

  it("is NOT washed off by an antidote (it is your own buff)", () => {
    const board = makeBoard("p1", () => 0.1);
    board.speedupStacks = 2;
    board.slowdownStacks = 3;
    cureAfflictions(board, () => 0.5);
    expect(board.speedupStacks).toBe(0);
    expect(board.slowdownStacks).toBe(3);
  });
});

describe("eittrisLogic - EvilPieces", () => {
  it("offers nothing but the two Z pieces", () => {
    expect(EVIL_PIECE_COUNT).toBe(2);
    // Both handednesses, and both are the same shape as the normal Z pieces
    for (let type = 0; type < EVIL_PIECE_COUNT; type++) {
      const evilCells = pieceCells(spawnPiece(type, 0, true));
      expect(evilCells.length).toBe(4);
      const normalCells = pieceCells(spawnPiece(Z_PIECE_TYPES[type], 0, false));
      expect(new Set(evilCells.map((c) => `${c.x},${c.y}`))).toEqual(
        new Set(normalCells.map((c) => `${c.x},${c.y}`)),
      );
    }
  });

  it("always leaves a hole on flat ground, whichever way you turn it", () => {
    for (let type = 0; type < EVIL_PIECE_COUNT; type++) {
      for (let rot = 0; rot < 4; rot++) {
        const landed = hardDrop(emptyGrid(), spawnPiece(type, rot, true)).piece;
        const settled = lockAndClear(emptyGrid(), landed).grid;
        expect(countCoveredGaps(settled)).toBeGreaterThan(0);
      }
    }
  });

  it("draws evil pieces only when the flag is set", () => {
    const normal = spawnNextFromQueue([], () => 0.99, false);
    const evil = spawnNextFromQueue([], () => 0.99, true);
    expect(normal.piece.evil).toBe(false);
    expect(evil.piece.evil).toBe(true);
    expect(evil.piece.type).toBeLessThan(EVIL_PIECE_COUNT);
  });

  it("settles into single-digit cells so the wire encoding still works", () => {
    const grid = emptyGrid();
    // the biggest evil piece, dropped in
    const piece = { type: 5, rot: 0, x: 5, y: BOARD_HEIGHT - 3, evil: true };
    const result = lockAndClear(grid, piece);
    const encoded = encodeGrid(result.grid);
    expect(encoded.length).toBe(BOARD_WIDTH * BOARD_HEIGHT);
    for (const ch of encoded) expect(ch === "." || /[0-8]/.test(ch)).toBe(true);
    expect(decodeGrid(encoded)).toEqual(result.grid);
  });

  it("is an affliction an antidote washes off", () => {
    const board = makeBoard("p1", () => 0.1);
    board.evilPieces = true;
    expect(hasAfflictions(board)).toBe(true);
    cureAfflictions(board, () => 0.5);
    expect(board.evilPieces).toBe(false);
  });
});

describe("eittrisLogic - Psycho", () => {
  it("builds the same 32-color palette on both ends from just the seed", () => {
    const palette = psychoPalette(1234);
    expect(palette.length).toBe(PSYCHO_COLOR_COUNT);
    for (const c of palette) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(psychoPalette(1234)).toEqual(palette); // the phone derives the same one
    expect(psychoPalette(1235)).not.toEqual(palette);
  });

  it("XORs the whole background to a new scramble on each new piece", () => {
    let overlay = emptyPsychoOverlay();
    overlay[3][4] = 7;
    overlay = xorPsychoOverlay(overlay, 5);
    expect(overlay[3][4]).toBe(7 ^ 5);
    expect(overlay[0][0]).toBe(5); // even untouched cells flip
    // XOR is its own inverse, so the same skew twice is a round trip
    expect(xorPsychoOverlay(overlay, 5)[3][4]).toBe(7);
    // and nothing can escape the palette
    for (const row of xorPsychoOverlay(overlay, PSYCHO_COLOR_COUNT - 1)) {
      for (const v of row) expect(v).toBeLessThan(PSYCHO_COLOR_COUNT);
    }
  });

  it("smears the falling piece's color into the overlay as a trail", () => {
    const piece = spawnPiece(1, 0, false); // the I piece, easy to spot
    const overlay = stampPsychoTrail(emptyPsychoOverlay(), piece);
    for (const c of pieceCells(piece)) {
      if (c.y >= 0) expect(overlay[c.y][c.x]).toBe(1);
    }
    // A cell the piece never touched is untouched
    expect(overlay[BOARD_HEIGHT - 1][0]).toBe(0);
  });

  it("survives the wire in 210 characters", () => {
    let overlay = xorPsychoOverlay(emptyPsychoOverlay(), 19);
    overlay = stampPsychoTrail(overlay, spawnPiece(4, 0, false));
    const encoded = encodePsychoOverlay(overlay);
    expect(encoded.length).toBe(BOARD_WIDTH * BOARD_HEIGHT);
    expect(decodePsychoOverlay(encoded)).toEqual(overlay);
  });

  it("is an affliction the antidote clears", () => {
    const board = makeBoard("p1", () => 0.1);
    board.psychoSeed = 42;
    board.psychoOverlay = emptyPsychoOverlay();
    expect(hasAfflictions(board)).toBe(true);
    cureAfflictions(board, () => 0.5);
    expect(board.psychoSeed).toBe(0);
    expect(board.psychoOverlay).toBeNull();
  });
});

describe("eittrisLogic - Jumble", () => {
  it("moves a block into a neighbouring gap without creating or destroying any", () => {
    const grid = emptyGrid();
    grid[10][5] = 3;
    const after = jumbleOnce(grid, () => 0.5);
    const count = (g: number[][]) => g.flat().filter((c) => c !== EMPTY_CELL).length;
    expect(count(after)).toBe(1); // still exactly one block
    // and it did not stay put
    expect(after[10][5] === 3 && count(after) === 1).toBe(false);
  });

  it("leaves a fully boxed-in block alone", () => {
    const grid = emptyGrid();
    // fill a 3x3 island; the middle block has nowhere to go
    for (let y = 9; y <= 11; y++) for (let x = 4; x <= 6; x++) grid[y][x] = 1;
    const before = JSON.stringify(grid);
    // force the pick onto the middle cell by making it the only occupied one
    const solo = emptyGrid();
    for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) solo[y][x] = 1; // no empties at all
    expect(jumbleOnce(solo, () => 0.5)).toEqual(solo);
    expect(JSON.stringify(grid)).toBe(before); // untouched by the solo call
  });

  it("does nothing on an empty board", () => {
    const grid = emptyGrid();
    expect(jumbleOnce(grid, () => 0.5)).toEqual(grid);
  });

  it("conserves the total block count over many nudges", () => {
    let grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) {
      grid[BOARD_HEIGHT - 1][x] = 1;
      grid[BOARD_HEIGHT - 2][x] = 2;
    }
    const before = grid.flat().filter((c) => c !== EMPTY_CELL).length;
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < JUMBLE_NUDGES; i++) grid = jumbleOnce(grid, rand);
    expect(grid.flat().filter((c) => c !== EMPTY_CELL).length).toBe(before);
  });
});

describe("eittrisLogic - swapColumn", () => {
  it("exchanges one column between two grids", () => {
    const a = emptyGrid();
    const b = emptyGrid();
    a[5][3] = 1;
    b[9][3] = 2;
    const out = swapColumn(a, b, 3);
    expect(out.a[9][3]).toBe(2);
    expect(out.a[5][3]).toBe(EMPTY_CELL);
    expect(out.b[5][3]).toBe(1);
    expect(out.b[9][3]).toBe(EMPTY_CELL);
  });

  it("leaves other columns and the originals alone", () => {
    const a = emptyGrid();
    const b = emptyGrid();
    a[5][3] = 1;
    a[5][4] = 7;
    const out = swapColumn(a, b, 3);
    expect(out.a[5][4]).toBe(7); // untouched column
    expect(a[5][3]).toBe(1); // inputs not mutated
  });

  it("ignores an out-of-range column", () => {
    const a = emptyGrid();
    const b = emptyGrid();
    a[5][3] = 1;
    expect(swapColumn(a, b, 99).a[5][3]).toBe(1);
  });
});

// ------------------------------------------------------------------------------------------
// SeeShadows + what a tap on the board means
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - the landing ghost", () => {
  it("puts the ghost exactly where a hard drop would land the piece", () => {
    const grid = emptyGrid();
    grid[BOARD_HEIGHT - 1][5] = 0; // a lump to land on
    const piece = spawnPiece(6, 0, false); // O at the spawn column
    const cells = landingCells(grid, piece);
    const landed = hardDrop(grid, piece).piece;
    expect(cells).toEqual(new Set(pieceCells(landed).map((c) => c.y * BOARD_WIDTH + c.x)));
    expect(cells.size).toBe(4);
  });

  it("has no ghost with no piece", () => {
    expect(landingCells(emptyGrid(), null).size).toBe(0);
  });
});

describe("eittrisLogic - taps", () => {
  it("rotates on a tap, wherever it landed", () => {
    expect(classifyTap(true)).toBe("rotate");
  });

  it("treats every tap independently - two taps are two rotations, never a drop", () => {
    // Taps used to pair up into a drop, which made a deliberate second rotation a
    // gamble.  Nothing about one tap may depend on the one before it.
    expect(classifyTap(true)).toBe("rotate");
    expect(classifyTap(true)).toBe("rotate");
  });

  it("does nothing at all during the spawn gap", () => {
    expect(classifyTap(false)).toBe("none");
  });
});

describe("eittrisLogic - taking a rotation back", () => {
  it("tryRotateCCW is the exact inverse of tryRotateCW", () => {
    const grid = emptyGrid();
    for (let type = 0; type < PIECE_COUNT; type++) {
      const piece = spawnPiece(type, 0, false);
      const turned = tryRotateCW(grid, { ...piece, y: 10 })!;
      expect(turned).not.toBeNull();
      expect(tryRotateCCW(grid, turned)!.rot).toBe(((piece.rot % 4) + 4) % 4);
    }
  });

  it("refuses to un-rotate into a wall, so the caller can just drop as-is", () => {
    const grid = emptyGrid();
    // An I piece lying flat against the floor cannot stand back up
    const flat = { type: 1, rot: 1, x: 5, y: BOARD_HEIGHT - 1, evil: false };
    expect(tryRotateCCW(grid, flat)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------
// Afflictions wear off on their own
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - affliction expiry", () => {
  // Turn an affliction on the way the presenter does
  function afflict(board: ReturnType<typeof makeBoard>, spec: (typeof AFFLICTION_TIMERS)[0]) {
    if (spec.type === SpecialType.Speedup) board.speedupStacks = 1;
    if (spec.type === SpecialType.EvilPieces) board.evilPieces = true;
    if (spec.type === SpecialType.CrazyIvan) board.crazyIvan = true;
    if (spec.type === SpecialType.FreezeDried) board.freezeDried = true;
    if (spec.type === SpecialType.Transparency) board.transparency = true;
    if (spec.type === SpecialType.Psycho) board.psychoSeed = 7;
    startAffliction(board, spec.type);
  }

  it("lifts every affliction after 22 seconds, and not a tick before", () => {
    for (const spec of AFFLICTION_TIMERS) {
      const board = makeBoard("p1", () => 0.1);
      afflict(board, spec);
      expect(spec.isOn(board)).toBe(true);
      expect(afflictionMsLeft(board, spec.type)).toBe(AFFLICTION_DURATION_MS);

      // One millisecond short: still afflicted
      tickAfflictions(board, AFFLICTION_DURATION_MS - 1, () => 0.5);
      expect(spec.isOn(board)).toBe(true);

      expect(tickAfflictions(board, 1, () => 0.5)).toEqual([spec.type]);
      expect(spec.isOn(board)).toBe(false);
      expect(afflictionMsLeft(board, spec.type)).toBe(0);
    }
  });

  it("refreshes the clock on a repeat hit instead of stacking a second one", () => {
    const board = makeBoard("p1", () => 0.1);
    board.speedupStacks = 1;
    startAffliction(board, SpecialType.Speedup);
    tickAfflictions(board, 20000, () => 0.5);
    expect(afflictionMsLeft(board, SpecialType.Speedup)).toBe(2000);

    // Hit again: full clock, and the stack survives
    board.speedupStacks++;
    startAffliction(board, SpecialType.Speedup);
    expect(afflictionMsLeft(board, SpecialType.Speedup)).toBe(AFFLICTION_DURATION_MS);
    expect(board.speedupStacks).toBe(2);

    // When it finally runs out, every stack goes at once
    tickAfflictions(board, AFFLICTION_DURATION_MS, () => 0.5);
    expect(board.speedupStacks).toBe(0);
  });

  it("leaves an unafflicted board completely alone", () => {
    const board = makeBoard("p1", () => 0.1);
    expect(tickAfflictions(board, 5000, () => 0.5)).toEqual([]);
    expect(hasAfflictions(board)).toBe(false);
    for (const spec of AFFLICTION_TIMERS) expect(afflictionMsLeft(board, spec.type)).toBe(0);
  });

  it("does not touch the self-buffs - SlowDown and SeeShadows are yours to keep", () => {
    const board = makeBoard("p1", () => 0.1);
    board.slowdownStacks = 2;
    board.seeShadows = true;
    tickAfflictions(board, AFFLICTION_DURATION_MS * 2, () => 0.5);
    expect(board.slowdownStacks).toBe(2);
    expect(board.seeShadows).toBe(true);
  });

  it("gives a clock to an affliction restored without one, rather than letting it linger", () => {
    const board = makeBoard("p1", () => 0.1);
    board.crazyIvan = true; // an old checkpoint: flag set, timer still zero
    expect(afflictionMsLeft(board, SpecialType.CrazyIvan)).toBe(0);
    tickAfflictions(board, 16, () => 0.5);
    expect(afflictionMsLeft(board, SpecialType.CrazyIvan)).toBe(AFFLICTION_DURATION_MS);
    expect(board.crazyIvan).toBe(true);
  });

  it("an antidote still wipes everything, clocks and all", () => {
    const board = makeBoard("p1", () => 0.1);
    for (const spec of AFFLICTION_TIMERS) afflict(board, spec);
    expect(hasAfflictions(board)).toBe(true);
    cureAfflictions(board, () => 0.5);
    expect(hasAfflictions(board)).toBe(false);
    for (const spec of AFFLICTION_TIMERS) expect(afflictionMsLeft(board, spec.type)).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------
// Robot players
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - the robot roster", () => {
  it("builds the number the host asked for", () => {
    expect(robotRoster(0)).toEqual([]);
    expect(robotRoster(3).length).toBe(3);
    expect(robotRoster(MAX_ROBOTS).length).toBe(MAX_ROBOTS);
  });

  it("never builds more than the cap, or a negative number of robots", () => {
    expect(robotRoster(99).length).toBe(MAX_ROBOTS_STRESS);
    expect(robotRoster(-4)).toEqual([]);
    expect(robotRoster(NaN)).toEqual([]);
  });

  it("gives each robot a distinct id, name, avatar and colour", () => {
    const roster = robotRoster(MAX_ROBOTS);
    expect(new Set(roster.map((r) => r.playerId)).size).toBe(MAX_ROBOTS);
    expect(new Set(roster.map((r) => r.name)).size).toBe(MAX_ROBOTS);
    expect(new Set(roster.map((r) => r.avatarId)).size).toBe(MAX_ROBOTS);
    expect(new Set(roster.map((r) => r.avatarColor)).size).toBe(MAX_ROBOTS);
  });

  it("still gives every robot a distinct id and name at stress-test scale", () => {
    // Avatars repeat past MAX_ROBOTS - there are only so many - but the ids
    // must stay unique or boards would collide.
    const roster = robotRoster(MAX_ROBOTS_STRESS);
    expect(roster.length).toBe(MAX_ROBOTS_STRESS);
    expect(new Set(roster.map((r) => r.playerId)).size).toBe(MAX_ROBOTS_STRESS);
    expect(new Set(roster.map((r) => r.name)).size).toBe(MAX_ROBOTS_STRESS);
  });

  it("is derived purely from the count, so only the count needs saving", () => {
    expect(robotRoster(2)).toEqual(robotRoster(2));
  });

  it("uses ids no real player could collide with, and recognises them", () => {
    for (const robot of robotRoster(MAX_ROBOTS)) expect(isRobotId(robot.playerId)).toBe(true);
    // Real ids come from the relay's generatePersonalId
    expect(isRobotId("A1b2C3")).toBe(false);
    expect(isRobotId("robot")).toBe(false);
    expect(isRobotId("")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------
// Clearing rows as an animation
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - the row-clear animation", () => {
  it("puts a four-row drop at exactly the reference time", () => {
    expect(clearFallMs(4)).toBeCloseTo(CLEAR_FALL_MS, 5);
  });

  it("makes a shorter drop take less time, but not proportionally less", () => {
    // Falling accelerates, so one row takes HALF the time of four, not a quarter
    expect(clearFallMs(1)).toBeCloseTo(CLEAR_FALL_MS / 2, 5);
    expect(clearFallMs(2)).toBeCloseTo(CLEAR_FALL_MS / Math.SQRT2, 5);
    expect(clearFallMs(0)).toBe(0);
    expect(clearFallMs(-3)).toBe(0);
  });

  it("accelerates: the first half of the time covers a quarter of the distance", () => {
    expect(fallProgress(0, 300)).toBe(0);
    expect(fallProgress(150, 300)).toBeCloseTo(0.25, 5);
    expect(fallProgress(300, 300)).toBe(1);
    expect(fallProgress(9999, 300)).toBe(1); // never overshoots
    expect(fallProgress(50, 0)).toBe(1); // a zero-length fall is already done
  });

  it("drops each row by the number of cleared rows beneath it", () => {
    const drops = rowDropAmounts([18, 20]);
    expect(drops[17]).toBe(2); // two cleared rows below it
    expect(drops[19]).toBe(1); // only row 20 is below
    expect(drops[18]).toBe(0); // a cleared row does not fall, it goes
    expect(drops[20]).toBe(0);
    expect(maxRowDrop([18, 20])).toBe(2);
    expect(maxRowDrop([])).toBe(0);
  });

  it("eats a row away left to right over the eat time", () => {
    expect(cellsLeftInEatenRow(0, 300)).toBe(BOARD_WIDTH);
    expect(cellsLeftInEatenRow(150, 300)).toBe(BOARD_WIDTH / 2);
    expect(cellsLeftInEatenRow(300, 300)).toBe(0);
    expect(cellsLeftInEatenRow(600, 300)).toBe(0); // never negative
  });

  it("collapses exactly the rows it promised, even if one got refilled", () => {
    // An attack can land while the rows are vanishing.  The player was already
    // told those rows were going, so they go.
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) {
      grid[20][x] = 1;
      grid[19][x] = 2;
    }
    grid[18][3] = 3; // a lone block above

    const collapsed = collapseRows(grid, [19, 20]);
    expect(collapsed.length).toBe(BOARD_HEIGHT);
    expect(collapsed[20][3]).toBe(3); // the lone block fell two rows
    expect(collapsed[20].filter((c) => c !== EMPTY_CELL).length).toBe(1);
    expect(collapsed[0].every((c) => c === EMPTY_CELL)).toBe(true);
  });

  it("lockOnly stamps a piece without taking any rows out", () => {
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH - 1; x++) grid[20][x] = 1;
    const piece = { type: 1, rot: 1, x: BOARD_WIDTH - 1, y: 20, evil: false };
    const locked = lockOnly(grid, piece);
    // The row is now full, and still there - that is the point
    expect(locked[20].every((c) => c !== EMPTY_CELL)).toBe(true);
    expect(lockAndClear(grid, piece).grid[20].every((c) => c === EMPTY_CELL)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------
// Several powerups at once, but never two in reach of one piece
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - powerup placement", () => {
  function fullGrid(): number[][] {
    const grid = emptyGrid();
    for (let y = 0; y < BOARD_HEIGHT; y++) for (let x = 0; x < BOARD_WIDTH; x++) grid[y][x] = 1;
    return grid;
  }

  it("keeps a new powerup at least four rows from an existing one", () => {
    const grid = fullGrid();
    const existing = [{ index: 10 * BOARD_WIDTH + 3, type: SpecialType.Antidote }];
    // Try every random draw - none of them may land too close
    for (let r = 0; r < 200; r++) {
      const index = pickSpecialCell(grid, existing, () => r / 200);
      if (index === null) continue;
      const row = Math.floor(index / BOARD_WIDTH);
      expect(Math.abs(row - 10)).toBeGreaterThanOrEqual(SPECIAL_MIN_ROW_GAP);
    }
  });

  it("still allows several at once, spread out", () => {
    const grid = fullGrid();
    const markers: { index: number; type: SpecialType }[] = [];
    for (let i = 0; i < 4; i++) {
      const index = pickSpecialCell(grid, markers, () => 0.01 + i * 0.24);
      if (index !== null) markers.push({ index, type: SpecialType.Antidote });
    }
    expect(markers.length).toBeGreaterThan(1);
    const rows = markers.map((m) => Math.floor(m.index / BOARD_WIDTH));
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        expect(Math.abs(rows[i] - rows[j])).toBeGreaterThanOrEqual(SPECIAL_MIN_ROW_GAP);
      }
    }
  });

  it("gives up rather than crowding when there is nowhere legal left", () => {
    // A board only four rows tall in practice: one marker blocks the lot
    const grid = emptyGrid();
    for (let x = 0; x < BOARD_WIDTH; x++) grid[BOARD_HEIGHT - 1][x] = 1;
    const existing = [{ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Antidote }];
    expect(pickSpecialCell(grid, existing, () => 0.5)).toBeNull();
  });

  it("never picks a cell that already carries a marker", () => {
    const grid = fullGrid();
    const taken = 5 * BOARD_WIDTH + 2;
    const index = pickSpecialCell(grid, [{ index: taken, type: SpecialType.Antidote }], () => 0);
    expect(index).not.toBe(taken);
  });
});

// ------------------------------------------------------------------------------------------
// Host settings
// ------------------------------------------------------------------------------------------
describe("eittrisLogic - host settings", () => {
  it("starts from sensible defaults", () => {
    const settings = defaultSettings();
    expect(settings.startingAntidotes).toBe(ANTIDOTES_AT_START);
    expect(settings.fourRowAward).toBe(SpecialType.Antidote);
    expect(settings.allowedSpecials).toEqual(IMPLEMENTED_SPECIALS);
  });

  it("clamps the starting antidotes to what a player can hold", () => {
    expect(sanitizeSettings({ startingAntidotes: 99 }).startingAntidotes).toBe(ANTIDOTE_MAX);
    expect(sanitizeSettings({ startingAntidotes: -5 }).startingAntidotes).toBe(0);
  });

  it("refuses an award that could never appear", () => {
    expect(sanitizeSettings({ fourRowAward: 999 as SpecialType }).fourRowAward).toBe(
      SpecialType.Antidote,
    );
    expect(sanitizeSettings({ fourRowAward: SpecialType.Bridge }).fourRowAward).toBe(
      SpecialType.Bridge,
    );
  });

  it("never leaves the pool empty, however hard the host tries", () => {
    // An empty pool would deadlock every roll, so unticking everything falls
    // back to antidotes rather than to a game where clearing rows does nothing.
    expect(sanitizeSettings({ allowedSpecials: [] }).allowedSpecials).toEqual([
      SpecialType.Antidote,
    ]);
    expect(sanitizeSettings({ allowedSpecials: [999 as SpecialType] }).allowedSpecials).toEqual([
      SpecialType.Antidote,
    ]);
  });

  it("only rolls specials the host allowed", () => {
    const allowed = [SpecialType.Speedup, SpecialType.TheWall];
    for (let r = 0; r < 100; r++) {
      const rolled = rollAllowedSpecial(() => r / 100, 0.5, allowed);
      expect(allowed).toContain(rolled);
    }
  });

  it("keeps the antidote's share of the rolls when it is switched on", () => {
    expect(rollAllowedSpecial(() => 0.1, 0.5, IMPLEMENTED_SPECIALS)).toBe(SpecialType.Antidote);
  });

  it("does not sneak an antidote in when the host turned it off", () => {
    const allowed = [SpecialType.Speedup, SpecialType.TheWall];
    for (let r = 0; r < 100; r++) {
      expect(rollAllowedSpecial(() => r / 100, 0.9, allowed)).not.toBe(SpecialType.Antidote);
    }
  });
});

describe("eittrisLogic - where the fallen rows came from", () => {
  it("says how far the row at each FINAL position fell", () => {
    // Clearing rows 19 and 20 drops everything above by two
    const drops = finalRowDrops([19, 20]);
    expect(drops[BOARD_HEIGHT - 1]).toBe(2); // what was row 18 is now row 20
    expect(drops[BOARD_HEIGHT - 2]).toBe(2);
    expect(drops[0]).toBe(0); // the refilled rows on top did not fall
    expect(drops[1]).toBe(0);
  });

  it("matches what collapseRows actually does", () => {
    // The renderer lifts each row by this much; if it disagrees with the
    // collapse, blocks slide to the wrong place.
    const clearedRows = [15, 18, 20];
    const grid = emptyGrid();
    for (let y = 0; y < BOARD_HEIGHT; y++) grid[y][0] = y; // tag each row
    const collapsed = collapseRows(grid, clearedRows);
    const drops = finalRowDrops(clearedRows);
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      const tag = collapsed[y][0];
      if (tag === EMPTY_CELL) continue;
      // The row now at y started at `tag`, and drops says how far it moved
      expect(y - drops[y]).toBe(tag);
    }
  });

  it("is all zeroes when nothing was cleared", () => {
    expect(finalRowDrops([]).every((d) => d === 0)).toBe(true);
  });
});

describe("eittrisLogic - the computer player weighs holes against height", () => {
  // Left half built ten rows high and flat; right half bare floor with a
  // single bump.  Placing on the left is clean but perches the piece high;
  // placing over the bump on the right is low but buries one cell.
  function highLeftLowRight(): number[][] {
    const grid = emptyGrid();
    for (let y = BOARD_HEIGHT - 10; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x <= 4; x++) grid[y][x] = 1;
    }
    grid[BOARD_HEIGHT - 1][6] = 1; // the bump
    return grid;
  }

  it("prefers a low placement that makes a hole over a high one that does not", () => {
    const grid = highLeftLowRight();
    const O = (x: number) => ({ type: 6, rot: 0, x, y: 0, evil: false });
    const lowWithHole = dropDestination(grid, O(6)); // rests on the bump
    const highButClean = dropDestination(grid, O(0)); // on top of the stack

    // It buries a cell...
    const buried = countCoveredGaps(withPieceSettled(grid, lowWithHole)) - countCoveredGaps(grid);
    expect(buried).toBeGreaterThan(0);
    // ...and is still the better move, because the alternative is up in the air
    expect(scorePlacement(grid, lowWithHole)).toBeGreaterThan(scorePlacement(grid, highButClean));
  });

  it("still avoids a hole when both options sit at the same height", () => {
    // Nothing has changed about hating holes for their own sake - only about
    // what they are worth relative to height.
    const grid = emptyGrid();
    grid[BOARD_HEIGHT - 1][0] = 1; // a bump that would trap a cell beside it
    const clean = dropDestination(grid, { type: 6, rot: 0, x: 4, y: 0, evil: false });
    const overBump = dropDestination(grid, { type: 6, rot: 0, x: 0, y: 0, evil: false });
    expect(scorePlacement(grid, clean)).toBeGreaterThan(scorePlacement(grid, overBump));
  });

  it("measures how tall the stack is", () => {
    expect(stackHeight(emptyGrid())).toBe(0);
    const grid = emptyGrid();
    grid[BOARD_HEIGHT - 1][3] = 1;
    expect(stackHeight(grid)).toBe(1);
    grid[BOARD_HEIGHT - 5][7] = 1;
    expect(stackHeight(grid)).toBe(5);
  });

  it("penalises a taller result even when nothing is buried", () => {
    const grid = emptyGrid();
    const onFloor = dropDestination(grid, { type: 6, rot: 0, x: 0, y: 0, evil: false });
    const scoreLow = scorePlacement(grid, onFloor);
    // The same piece on a board that is already high scores worse
    const tall = emptyGrid();
    for (let y = BOARD_HEIGHT - 10; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) tall[y][x] = 1;
    }
    const onTop = dropDestination(tall, { type: 6, rot: 0, x: 0, y: 0, evil: false });
    expect(scorePlacement(tall, onTop)).toBeLessThan(scoreLow);
  });
});

describe("eittrisLogic - the piece queue follows the piece table in use", () => {
  // A queue holds INDEXES, and evil pieces index a different table.  A queue
  // left over from before a switch would show - and deal - the wrong shapes.
  it("is rebuilt with evil pieces when EvilPieces lifts and normal ones return", () => {
    const board = makeBoard("p1", () => 0.5);
    board.evilPieces = true;
    startAffliction(board, SpecialType.EvilPieces); // as the presenter does
    board.nextQueue = refillNextQueue(() => 0.5, true);
    expect(board.nextQueue.length).toBe(NEXT_QUEUE_DEPTH);
    expect(board.nextQueue.every((type) => type < EVIL_PIECE_COUNT)).toBe(true);

    // When it wears off, the queue is rebuilt against the normal table
    tickAfflictions(board, AFFLICTION_DURATION_MS, () => 0.5);
    expect(board.evilPieces).toBe(false);
    expect(board.nextQueue.length).toBe(NEXT_QUEUE_DEPTH);
    expect(board.nextQueue.every((type) => type < PIECE_COUNT)).toBe(true);
  });

  it("is rebuilt when an antidote cures EvilPieces too", () => {
    const board = makeBoard("p1", () => 0.5);
    board.evilPieces = true;
    startAffliction(board, SpecialType.EvilPieces);
    board.nextQueue = refillNextQueue(() => 0.5, true);
    cureAfflictions(board, () => 0.5);
    expect(board.evilPieces).toBe(false);
    expect(board.nextQueue.length).toBe(NEXT_QUEUE_DEPTH);
  });

  it("never leaves the queue empty across the switch", () => {
    // An empty queue is a blank Next tray, which looks like a bug to a player
    const board = makeBoard("p1", () => 0.5);
    board.evilPieces = true;
    startAffliction(board, SpecialType.EvilPieces);
    board.nextQueue = refillNextQueue(() => 0.5, true);
    for (let i = 0; i < 5; i++) {
      tickAfflictions(board, AFFLICTION_DURATION_MS, () => 0.5);
      expect(board.nextQueue.length).toBeGreaterThan(0);
    }
  });
});

describe("eittrisLogic - a powerup always sits on a block", () => {
  function gridWithBlockAt(index: number): number[][] {
    const grid = emptyGrid();
    grid[Math.floor(index / BOARD_WIDTH)][index % BOARD_WIDTH] = 1;
    return grid;
  }

  it("keeps a marker whose block is still there", () => {
    const index = 15 * BOARD_WIDTH + 4;
    const markers = [{ index, type: SpecialType.Antidote }];
    expect(pruneOrphanedSpecials(gridWithBlockAt(index), markers)).toEqual(markers);
  });

  it("drops a marker whose block has gone", () => {
    // This is the bug: something moved the grid and left the icon behind,
    // floating in mid-air where it could never be collected.
    const index = 15 * BOARD_WIDTH + 4;
    const markers = [{ index, type: SpecialType.Antidote }];
    expect(pruneOrphanedSpecials(emptyGrid(), markers)).toEqual([]);
  });

  it("drops a marker that ended up off the board entirely", () => {
    const grid = emptyGrid();
    for (const index of [-1, BOARD_WIDTH * BOARD_HEIGHT, 99999]) {
      expect(pruneOrphanedSpecials(grid, [{ index, type: SpecialType.Antidote }])).toEqual([]);
    }
  });

  it("survives every kind of grid upheaval", () => {
    // The four things that actually move a grid under a marker
    const index = (BOARD_HEIGHT - 1) * BOARD_WIDTH + 3;
    const markers = [{ index, type: SpecialType.Antidote }];
    const grid = gridWithBlockAt(index);

    // A row collapsing out from under it
    expect(specialsAreAnchored(collapseRows(grid, [BOARD_HEIGHT - 1]), markers)).toBe(false);
    // A jumble shaking the block somewhere else
    let jumbled = grid;
    for (let i = 0; i < 50; i++) jumbled = jumbleOnce(jumbled, Math.random);
    // ...either it moved (orphan, must prune) or it did not (still anchored) -
    // what matters is that the check agrees with the grid, never guesses
    expect(specialsAreAnchored(jumbled, markers)).toBe(
      jumbled[Math.floor(index / BOARD_WIDTH)][index % BOARD_WIDTH] !== EMPTY_CELL,
    );
  });

  it("keeps the ones that are fine while dropping the ones that are not", () => {
    const kept = 10 * BOARD_WIDTH + 2;
    const lost = 3 * BOARD_WIDTH + 7;
    const grid = gridWithBlockAt(kept);
    const pruned = pruneOrphanedSpecials(grid, [
      { index: kept, type: SpecialType.Antidote },
      { index: lost, type: SpecialType.Speedup },
    ]);
    expect(pruned.length).toBe(1);
    expect(pruned[0].index).toBe(kept);
  });
});

describe("eittrisLogic - what the computer player pays for height", () => {
  it("charges nothing at the floor and more the higher you go", () => {
    expect(heightCost(BOARD_HEIGHT - 1)).toBe(0);
    expect(heightCost(BOARD_HEIGHT - 2)).toBeGreaterThan(0);
    // Strictly increasing as the row climbs
    for (let y = BOARD_HEIGHT - 1; y > 0; y--) {
      expect(heightCost(y - 1)).toBeGreaterThan(heightCost(y));
    }
  });

  it("charges double in the middle third and triple up top", () => {
    expect(heightZoneMultiplier(BOARD_HEIGHT - 1)).toBe(1); // floor
    expect(heightZoneMultiplier(Math.floor(BOARD_HEIGHT / 2))).toBe(2); // middle
    expect(heightZoneMultiplier(0)).toBe(3); // ceiling
  });

  it("costs the same for one buried cell as for many", () => {
    // The whole point: a board riddled with holes must not paralyse the bot.
    // A three-deep well one column wide, roofed by anything, buries three.
    const grid = emptyGrid();
    for (let y = BOARD_HEIGHT - 3; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) if (x !== 4) grid[y][x] = 1;
    }

    // Search for placements burying exactly one cell and more than one
    const gapsFor = (landed: EittrisPiece) =>
      countCoveredGaps(withPieceSettled(grid, landed)) - countCoveredGaps(grid);
    const penaltyFor = (landed: EittrisPiece) => {
      const noGapScore =
        -heightCost(Math.min(...pieceCells(landed).map((c) => c.y))) +
        AI_CONTACT_WEIGHT * contactCount(grid, landed);
      return noGapScore - scorePlacement(grid, landed);
    };

    const penalties = new Set<number>();
    let sawMany = false;
    for (let type = 0; type < PIECE_COUNT; type++) {
      for (let rot = 0; rot < 4; rot++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          const candidate = { type, rot, x, y: 0, evil: false };
          if (collides(grid, pieceCells(candidate))) continue;
          const landed = dropDestination(grid, candidate);
          const buried = gapsFor(landed);
          if (buried <= 0) continue;
          if (buried > 1) sawMany = true;
          penalties.add(penaltyFor(landed));
        }
      }
    }

    expect(sawMany).toBe(true); // the board really does offer a multi-gap move
    // ...and every gap-making placement paid the same flat price
    expect([...penalties]).toEqual([AI_GAP_PENALTY]);
  });

  it("prices a gap at three rows of height near the floor", () => {
    expect(AI_GAP_PENALTY).toBe(3 * AI_HEIGHT_UNIT);
  });
});

describe("eittrisLogic - fitting the host's boards on screen", () => {
  const W = 1880;
  const H = 960;

  // Does the chosen layout actually fit in the space it was given?
  function fits(layout: { columns: number; rows: number; cellPx: number }, gap = 10) {
    const width = layout.columns * panelWidthFor(layout.cellPx) + gap * (layout.columns - 1);
    const height = layout.rows * panelHeightFor(layout.cellPx) + gap * (layout.rows - 1);
    return width <= W && height <= H;
  }

  it("keeps a handful of players on one row", () => {
    for (const count of [1, 2, 3, 4]) {
      const layout = planBoardLayout(count, W, H);
      expect(layout.rows).toBe(1);
      expect(layout.columns).toBe(count);
    }
  });

  it("wraps into rows rather than running off the screen", () => {
    // This is the bug the 20-robot stress test found: one row of 24 boards
    // ran off the right edge and the last few could not be seen at all.
    const layout = planBoardLayout(24, W, H);
    expect(layout.rows).toBeGreaterThan(1);
    expect(fits(layout)).toBe(true);
  });

  it("fits at every player count a game can reach", () => {
    for (let count = 1; count <= 24; count++) {
      const layout = planBoardLayout(count, W, H);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(fits(layout)).toBe(true);
    }
  });

  it("uses the space: fewer players means bigger boards", () => {
    const sizes = [1, 4, 8, 16, 24].map((n) => planBoardLayout(n, W, H).cellPx);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    }
    expect(sizes[0]).toBe(BOARD_MAX_CELL_PX); // a solo board is as big as allowed
  });

  it("never returns a size too small to see, or one that ignores the cap", () => {
    for (let count = 1; count <= 40; count++) {
      const { cellPx } = planBoardLayout(count, W, H);
      expect(cellPx).toBeGreaterThanOrEqual(BOARD_MIN_CELL_PX);
      expect(cellPx).toBeLessThanOrEqual(BOARD_MAX_CELL_PX);
    }
  });

  it("copes with no boards at all", () => {
    expect(() => planBoardLayout(0, W, H)).not.toThrow();
    expect(planBoardLayout(0, W, H).cellPx).toBeGreaterThan(0);
  });
});
