// ==========================================================================================
// PURE game rules for EITtris.  No MobX, no session, no DOM - data in, data out.
// Shapes, rotation, collision, and the gravity curve are verbatim ports from the
// original C# eitrix (see DESIGN.md).  All rule changes happen here, with
// coverage in eittrisLogic.spec.ts; the models only orchestrate.
// ==========================================================================================

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 21; // row 0 at top; gravity is y++
// Where a new piece's bounding box lands: SRS's own spawn column on a ten-wide board, with
// the box's top row at the top of the board.  Its own top row is empty for every piece
// except I and O, so what the player sees is a piece arriving on row 1, as before.
export const SPAWN_X = 3;
export const SPAWN_Y = 0;
export const NEXT_PREVIEW_COUNT = 1; // the phone's tray normally shows one piece
// ...but CrystalBall shows three, so the queue always holds that many.  The
// preview depth is a display choice; the queue depth is what makes it possible.
export const CRYSTAL_BALL_PREVIEW = 3;
export const NEXT_QUEUE_DEPTH = CRYSTAL_BALL_PREVIEW;

// Gravity, tuned down from the original: the game was landing pieces faster than
// people could think about them.  Both the starting speed and the rate it speeds up
// are 60% lower - the interval is the reciprocal of speed, hence 1000/0.4 = 2500.
export const START_INTERVAL_MS = 2500; // gravity starts at one row per 2.5 seconds
export const MIN_INTERVAL_MS = 80; // sane floor for the gravity interval
export const EXP_DECAY_PER_SEC = 0.0024; // interval *= exp(-0.0024 * dt) above the knee
export const LINEAR_KNEE_MS = 500; // below this the decay goes linear
export const LINEAR_DECAY_MS_PER_SEC = 1.2; // interval -= 1.2ms per elapsed second

// Garbage painted into a board by an attack.  Not a playable piece type -
// it just occupies cells and renders in its own color.
export const GARBAGE_CELL = 7;
// TowerOfEit lays its own darker stone (the original forces DarkGray)
export const TOWER_CELL = 8;

// Specials: a settled block gets tagged every 8s, but only ever ONE at a
// time - it stays put until the player clears its row, and nothing new
// appears until then.  Every switched-on powerup is equally likely.  You may
// bank 4 antidotes, and a fired one shields/cures for 10s.
export const SPECIAL_INTERVAL_MS = 8000;
export const ANTIDOTE_MAX = 3;
// Earthquake: bank up to three, and each one shakes the board for this long before the
// stack drops.  The shake is not decoration - it is the beat that says "something is about
// to happen to your board", which is the difference between a satisfying powerup and the
// grid mysteriously rearranging itself.
// SeeShadows runs out.  It used to be yours for the rest of the round, which made the
// board strictly easier to read from the moment you picked one up and never again harder -
// a powerup you collect once and then stop thinking about.  Half a minute is long enough to
// dig yourself out of trouble with and short enough to want another one.
export const SEE_SHADOWS_DURATION_MS = 30000;
export const EARTHQUAKE_MAX = 3;
export const EARTHQUAKE_SHAKE_MS = 700;
// ...and then the stack comes down, at the same unhurried pace a cleared row's stack falls
// at.  Blocks that teleport into their new places read as a redraw; blocks that fall read
// as gravity, which is the thing the powerup is pretending to be.
export const EARTHQUAKE_FALL_MS = 420;
// Every this many rows cleared earns one, on top of any that are collected
export const EARTHQUAKE_EVERY_ROWS = 22;
export const ANTIDOTE_DURATION_MS = 10000;
// Every affliction wears off on its own after this long.  Getting hit again
// with the same one refreshes the clock rather than stacking a second timer.
export const AFFLICTION_DURATION_MS = 22000;
export const ANTIDOTES_AT_START = 1;
// Speedup: the victim's gravity interval is permanently multiplied by this
// (verbatim from the original), floored at MIN_INTERVAL_MS so a stack of
// them can't make a board literally unplayable.
export const SPEEDUP_FACTOR = 0.6;
// SlowDown is the mirror image, and a gift to yourself rather than an attack
export const SLOWDOWN_FACTOR = 1.3;
// TheWall: 8 solid rows, each with one random gap, painted into the bottom
// of the victim's board one row per 100ms (the original's ShapeDraw cadence)
export const WALL_ROWS = 8;
export const STENCIL_ROW_MS = 100;
export const EMPTY_CELL = -1;

// ------------------------------------------------------------------------------------------
// Piece definitions - the Super Rotation System (https://tetris.wiki/Super_Rotation_System).
//
// This is the rotation every modern tetris uses, and the reason to adopt it is that people
// already know it: the shapes turn where a player expects them to, and a rotation that would
// not fit is nudged - "kicked" - into a place where it does, rather than being refused.  The
// original's rotate-about-a-cell scheme did neither, so a piece flush against a wall or
// wedged in a well simply would not turn.
//
// Each piece is four rotation states of a bounding box - 3x3 for T L J S Z, 4x4 for I, and
// 2x2 for O, which is symmetrical and never turns at all.  A piece's x,y is the TOP-LEFT of
// that box, so rotation is a table lookup rather than arithmetic about an origin.  Type
// indices are unchanged: they are also the settled cell's colour.
//
// The colours are still the original's deliberately non-standard ones.  Only the geometry
// is standard.
// ------------------------------------------------------------------------------------------

export interface Cell {
  x: number;
  y: number;
}

/** Shorthand for a rotation state: "cols per row", one string per row of the box. */
function shape(...rows: string[]): Cell[] {
  const cells: Cell[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== ".") cells.push({ x, y });
  });
  return cells;
}

// Indexed by piece type, then by rotation state 0 / R / 2 / L (clockwise).
const PIECE_SHAPES: Cell[][][] = [
  // 0: T
  [
    shape(".X.", "XXX", "..."),
    shape(".X.", ".XX", ".X."),
    shape("...", "XXX", ".X."),
    shape(".X.", "XX.", ".X."),
  ],
  // 1: I
  [
    shape("....", "XXXX", "....", "...."),
    shape("..X.", "..X.", "..X.", "..X."),
    shape("....", "....", "XXXX", "...."),
    shape(".X..", ".X..", ".X..", ".X.."),
  ],
  // 2: L
  [
    shape("..X", "XXX", "..."),
    shape(".X.", ".X.", ".XX"),
    shape("...", "XXX", "X.."),
    shape("XX.", ".X.", ".X."),
  ],
  // 3: J ("reverse L")
  [
    shape("X..", "XXX", "..."),
    shape(".XX", ".X.", ".X."),
    shape("...", "XXX", "..X"),
    shape(".X.", ".X.", "XX."),
  ],
  // 4: Z
  [
    shape("XX.", ".XX", "..."),
    shape("..X", ".XX", ".X."),
    shape("...", "XX.", ".XX"),
    shape(".X.", "XX.", "X.."),
  ],
  // 5: S ("reverse Z")
  [
    shape(".XX", "XX.", "..."),
    shape(".X.", ".XX", "..X"),
    shape("...", ".XX", "XX."),
    shape("X..", "XX.", ".X."),
  ],
  // 6: O
  [shape("XX", "XX"), shape("XX", "XX"), shape("XX", "XX"), shape("XX", "XX")],
];

export const PIECE_COUNT = PIECE_SHAPES.length;

// The EvilPieces affliction deals nothing but S and Z, left- and right-handed.  Both leave a
// hole on flat ground however they are turned, so an afflicted stack rots from underneath
// however well the victim places.  They are the ordinary S and Z pieces - hence a lookup
// into the table above rather than a table of their own.
export const Z_PIECE_TYPES = [4, 5];
export const EVIL_PIECE_COUNT = Z_PIECE_TYPES.length;

// eitrix's own (deliberately non-standard) piece colors, indexed by type
export const PIECE_COLORS = [
  "#00FFFF", // T cyan
  "#FF0000", // I red
  "#00FF00", // L green
  "#FF00FF", // reverse L magenta
  "#FF8E00", // Z orange
  "#FFFF00", // reverse Z yellow
  "#0000FF", // O blue
  "#8a8a8a", // 7: garbage painted by an attack
  "#4f4f4f", // 8: TowerOfEit's darker stone
];

// The falling piece: type index, rotation state 0-3 clockwise from spawn, and the top-left
// of its bounding box on the board.  `evil` selects the S/Z pair instead of the full set.
export interface EittrisPiece {
  type: number;
  rot: number;
  x: number;
  y: number;
  evil?: boolean;
}

/** Which entry of PIECE_SHAPES this piece is really made of. */
function shapeIndex(piece: EittrisPiece): number {
  return piece.evil
    ? Z_PIECE_TYPES[((piece.type % EVIL_PIECE_COUNT) + EVIL_PIECE_COUNT) % EVIL_PIECE_COUNT]
    : ((piece.type % PIECE_COUNT) + PIECE_COUNT) % PIECE_COUNT;
}

// Evil pieces ARE the two normal Z pieces, so they settle wearing the normal
// Z colors - which also keeps every settled cell a single digit and the grid
// encoding at 210 characters.
export function pieceColorIndex(piece: EittrisPiece): number {
  return shapeIndex(piece);
}

// The four absolute board cells a piece occupies
export function pieceCells(piece: EittrisPiece): Cell[] {
  const states = PIECE_SHAPES[shapeIndex(piece)];
  const cells = states[((piece.rot % 4) + 4) % 4];
  return cells.map((c) => ({ x: piece.x + c.x, y: piece.y + c.y }));
}

// ------------------------------------------------------------------------------------------
// Wall kicks.
//
// A rotation is tried at the piece's own position first; if that collides, four offsets are
// tried in order and the first that fits wins.  This is what lets a piece turn while it is
// flush against a wall or down a one-wide well - and it is where the T-spin comes from.
//
// The numbers are the standard tables, written exactly as tetris.wiki has them, which means
// POSITIVE Y IS UP.  This board's y grows downward, so the y is negated where they are
// applied - the alternative is a table nobody can check against the source.
// ------------------------------------------------------------------------------------------
type KickTable = Record<string, Cell[]>;

const KICKS_JLSTZ: KickTable = {
  "0>1": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -2 },
    { x: -1, y: -2 },
  ],
  "1>0": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  "1>2": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: -1 },
    { x: 0, y: 2 },
    { x: 1, y: 2 },
  ],
  "2>1": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: -2 },
    { x: -1, y: -2 },
  ],
  "2>3": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
  ],
  "3>2": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: 2 },
    { x: -1, y: 2 },
  ],
  "3>0": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: 2 },
    { x: -1, y: 2 },
  ],
  "0>3": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
  ],
};

const KICKS_I: KickTable = {
  "0>1": [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: -1 },
    { x: 1, y: 2 },
  ],
  "1>0": [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 1 },
    { x: -1, y: -2 },
  ],
  "1>2": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 2 },
    { x: 2, y: -1 },
  ],
  "2>1": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: -2 },
    { x: -2, y: 1 },
  ],
  "2>3": [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 1 },
    { x: -1, y: -2 },
  ],
  "3>2": [
    { x: 0, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: -1 },
    { x: 1, y: 2 },
  ],
  "3>0": [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -2, y: 0 },
    { x: 1, y: -2 },
    { x: -2, y: 1 },
  ],
  "0>3": [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 2, y: 0 },
    { x: -1, y: 2 },
    { x: 2, y: -1 },
  ],
};

/** The offsets to try, in order, for one rotation of one piece. */
export function kicksFor(piece: EittrisPiece, from: number, to: number): Cell[] {
  const type = shapeIndex(piece);
  if (type === 6) return [{ x: 0, y: 0 }]; // O never needs one - it does not move when it turns
  const table = type === 1 ? KICKS_I : KICKS_JLSTZ;
  return table[`${from}>${to}`] ?? [{ x: 0, y: 0 }];
}

// ------------------------------------------------------------------------------------------
// Grid - number[BOARD_HEIGHT][BOARD_WIDTH], EMPTY_CELL or a piece-type index.
// Cells with y < 0 are legal and NON-colliding (pieces spawn partially above).
// ------------------------------------------------------------------------------------------
export function emptyGrid(): number[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => Array(BOARD_WIDTH).fill(EMPTY_CELL));
}

export function collides(grid: number[][], cells: Cell[]): boolean {
  return cells.some(
    (c) =>
      c.x < 0 ||
      c.x >= BOARD_WIDTH ||
      c.y >= BOARD_HEIGHT ||
      (c.y >= 0 && grid[c.y][c.x] !== EMPTY_CELL),
  );
}

// ------------------------------------------------------------------------------------------
// Movement - all moves/rotations that collide are simply refused (no wall kicks)
// ------------------------------------------------------------------------------------------
export function tryMove(
  grid: number[][],
  piece: EittrisPiece,
  dx: number,
  dy: number,
): EittrisPiece | null {
  const moved = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return collides(grid, pieceCells(moved)) ? null : moved;
}

// Rotate, kicking the piece into whatever nearby space will take it (see kicksFor).  The
// first offset in every table is no offset at all, so a rotation with room simply happens.
// null means all five candidates collided, which is the only case where a rotation is
// refused outright.
function tryRotate(grid: number[][], piece: EittrisPiece, quarters: 1 | 3): EittrisPiece | null {
  const from = ((piece.rot % 4) + 4) % 4;
  const to = (from + quarters) % 4;
  for (const kick of kicksFor(piece, from, to)) {
    // The tables are written y-up, as published; this board is y-down
    const candidate = { ...piece, rot: to, x: piece.x + kick.x, y: piece.y - kick.y };
    if (!collides(grid, pieceCells(candidate))) return candidate;
  }
  return null;
}

export function tryRotateCW(grid: number[][], piece: EittrisPiece): EittrisPiece | null {
  return tryRotate(grid, piece, 1);
}

export function tryRotateCCW(grid: number[][], piece: EittrisPiece): EittrisPiece | null {
  return tryRotate(grid, piece, 3);
}

// ------------------------------------------------------------------------------------------
// Where a piece's BOX may sit.
//
// A piece's x is the corner of its bounding box, and most rotations do not fill their box:
// a vertical I is one column of a four-wide box, and a T on its side is two of three.  So
// the box has to be allowed off the edge of the board - a vertical I needs its box at -2
// to put its bar in column 0 - and clamping x to 0..9, as the drag handler used to, left
// every one of those pieces unable to reach the wall.
// ------------------------------------------------------------------------------------------
export function pieceColumnRange(piece: EittrisPiece): { min: number; max: number } {
  const columns = pieceCells(piece).map((c) => c.x - piece.x);
  return {
    min: -Math.min(...columns),
    max: BOARD_WIDTH - 1 - Math.max(...columns),
  };
}

export function pieceRowLimit(piece: EittrisPiece): number {
  const rows = pieceCells(piece).map((c) => c.y - piece.y);
  return BOARD_HEIGHT - 1 - Math.max(...rows);
}

/** Fold a requested drag target into somewhere the piece could actually be. */
export function clampDragTarget(
  piece: EittrisPiece,
  column: number,
  row: number,
): { x: number; y: number } {
  const range = pieceColumnRange(piece);
  return {
    x: Math.max(range.min, Math.min(range.max, Math.floor(column))),
    y: Math.min(pieceRowLimit(piece), Math.floor(row)),
  };
}

// Step column-by-column toward targetX, stopping at the first obstruction
export function moveTowardColumn(
  grid: number[][],
  piece: EittrisPiece,
  targetX: number,
): EittrisPiece {
  let current = piece;
  const dir = Math.sign(targetX - piece.x);
  while (current.x !== targetX && dir !== 0) {
    const next = tryMove(grid, current, dir, 0);
    if (!next) break;
    current = next;
  }
  return current;
}

// Slam all the way left (-1) or right (+1)
export function slamHorizontal(grid: number[][], piece: EittrisPiece, dir: -1 | 1): EittrisPiece {
  let current = piece;
  for (;;) {
    const next = tryMove(grid, current, dir, 0);
    if (!next) return current;
    current = next;
  }
}

// Can the piece not move down any further?
export function isResting(grid: number[][], piece: EittrisPiece): boolean {
  return tryMove(grid, piece, 0, 1) === null;
}

// ------------------------------------------------------------------------------------------
// Free 2D drag - step toward the target column AND down toward the target row
// at once (never up), collision-checked one cell at a time, stopping on the
// blocked axis while the other keeps going.  Drag contact NEVER locks; the
// caller decides locking on release / natural gravity.
// ------------------------------------------------------------------------------------------
export function dragTowards(
  grid: number[][],
  piece: EittrisPiece,
  targetX: number,
  targetY: number,
): { piece: EittrisPiece; rowsDescended: number } {
  let current = piece;
  let rowsDescended = 0;
  const dir = Math.sign(targetX - piece.x);
  for (;;) {
    let progressed = false;
    if (dir !== 0 && current.x !== targetX) {
      const stepped = tryMove(grid, current, dir, 0);
      if (stepped) {
        current = stepped;
        progressed = true;
      }
    }
    if (current.y < targetY) {
      const dropped = tryMove(grid, current, 0, 1);
      if (dropped) {
        current = dropped;
        rowsDescended++;
        progressed = true;
      }
    }
    if (!progressed) return { piece: current, rowsDescended };
  }
}

// Drop to the floor; the caller locks it
export function hardDrop(
  grid: number[][],
  piece: EittrisPiece,
): { piece: EittrisPiece; rowsDropped: number } {
  let current = piece;
  let rowsDropped = 0;
  for (;;) {
    const next = tryMove(grid, current, 0, 1);
    if (!next) return { piece: current, rowsDropped };
    current = next;
    rowsDropped++;
  }
}

// ------------------------------------------------------------------------------------------
// Locking + clearing.  Returns a NEW grid; cells above the top (y < 0) are
// discarded.  Full rows are spliced atomically and everything above shifts down.
// ------------------------------------------------------------------------------------------
export interface LockResult {
  grid: number[][];
  cleared: number;
  clearedRows: number[]; // row indices in the PRE-clear grid (specials need these)
}

export function lockAndClear(grid: number[][], piece: EittrisPiece): LockResult {
  const locked = grid.map((row) => row.slice());
  const color = pieceColorIndex(piece);
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      locked[c.y][c.x] = color;
    }
  }

  // Find the full rows first, in original coordinates, then rebuild - that
  // keeps clearedRows meaningful for shifting special markers.
  const clearedRows: number[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (locked[y].every((cell) => cell !== EMPTY_CELL)) clearedRows.push(y);
  }
  const kept = locked.filter((_, y) => !clearedRows.includes(y));
  const newGrid = [
    ...Array.from({ length: clearedRows.length }, () => Array(BOARD_WIDTH).fill(EMPTY_CELL)),
    ...kept,
  ];

  return {
    grid: newGrid,
    cleared: clearedRows.length,
    clearedRows,
  };
}

// ==========================================================================================
// Specials (powerups) - the eitrix catalog.  Enum order matches the original C#
// so the icon strip (assets/images/specials.png, 16 icons) indexes directly.
// ==========================================================================================
export enum SpecialType {
  Speedup = 0,
  Escalator = 1,
  SlowDown = 2,
  Jumble = 3,
  Psycho = 4,
  Antidote = 5,
  TheWall = 6,
  SeeShadows = 7,
  Bridge = 8,
  EvilPieces = 9,
  CrazyIvan = 10,
  Shackle = 11,
  TowerOfEit = 12,
  SwitchScreens = 13,
  FreezeDried = 14,
  Transparency = 15,
  // A perk of our own, not from the original: see further down the queue
  CrystalBall = 16,
  // Also ours: shake the stack until it settles, closing the holes you left behind
  Earthquake = 17,
}

// Icons in assets/images/specials.png, one per SpecialType, in enum order
export const SPECIAL_ICON_COUNT = 18;

export const SPECIAL_NAMES: string[] = [
  "Speedup",
  "Escalator",
  "SlowDown",
  "Jumble",
  "Psycho",
  "Antidote",
  "TheWall",
  "SeeShadows",
  "Bridge",
  "EvilPieces",
  "CrazyIvan",
  "Shackle",
  "TowerOfEit",
  "SwitchScreens",
  "FreezeDried",
  "Transparency",
  "CrystalBall",
  "Earthquake",
];

// Specials that actually DO something today.  Random rolls and the dev
// selector only ever produce these; the rest land in later increments.
export const IMPLEMENTED_SPECIALS: SpecialType[] = [
  SpecialType.Antidote,
  SpecialType.Speedup,
  SpecialType.TheWall,
  SpecialType.Escalator,
  SpecialType.Shackle,
  SpecialType.TowerOfEit,
  SpecialType.Bridge,
  SpecialType.SlowDown,
  SpecialType.SeeShadows,
  SpecialType.EvilPieces,
  SpecialType.CrazyIvan,
  SpecialType.FreezeDried,
  SpecialType.Transparency,
  SpecialType.Psycho,
  SpecialType.Jumble,
  SpecialType.SwitchScreens,
  SpecialType.CrystalBall,
  SpecialType.Earthquake,
];

// Specials that are fired AT your target rather than kept for yourself
export const OFFENSIVE_SPECIALS: SpecialType[] = [
  SpecialType.Speedup,
  SpecialType.TheWall,
  SpecialType.Escalator,
  SpecialType.Shackle,
  SpecialType.TowerOfEit,
  SpecialType.Bridge,
  SpecialType.EvilPieces,
  SpecialType.CrazyIvan,
  SpecialType.FreezeDried,
  SpecialType.Transparency,
  SpecialType.Psycho,
  SpecialType.Jumble,
  SpecialType.SwitchScreens,
];

export function isOffensive(type: SpecialType): boolean {
  return OFFENSIVE_SPECIALS.includes(type);
}

// Afflictions modify gravity WITHOUT touching the natural curve, so an
// antidote can simply clear them and the board goes back to normal speed.
export function effectiveIntervalMs(
  baseIntervalMs: number,
  speedupStacks: number,
  slowdownStacks: number = 0,
): number {
  const multiplier =
    Math.pow(SPEEDUP_FACTOR, Math.max(0, speedupStacks)) *
    Math.pow(SLOWDOWN_FACTOR, Math.max(0, slowdownStacks));
  return Math.max(MIN_INTERVAL_MS, baseIntervalMs * multiplier);
}

// ------------------------------------------------------------------------------------------
// Afflictions and their clocks.  Each entry knows how to read its timer, how
// to tell whether the affliction is on, and how to lift it when time is up -
// so expiry, curing, and the status chips all work off one table instead of
// six near-identical branches.
// ------------------------------------------------------------------------------------------
export interface AfflictionSpec {
  type: SpecialType;
  timerField: keyof EittrisBoard;
  isOn: (board: EittrisBoard) => boolean;
  // `rand` is here for EvilPieces, which has to rebuild the preview queue
  lift: (board: EittrisBoard, rand: () => number) => void;
}

export const AFFLICTION_TIMERS: AfflictionSpec[] = [
  {
    type: SpecialType.Speedup,
    timerField: "speedupMs",
    isOn: (b) => b.speedupStacks > 0,
    // Every stack goes at once - one clock covers the affliction, not the hits
    lift: (b) => {
      b.speedupStacks = 0;
    },
  },
  {
    type: SpecialType.EvilPieces,
    timerField: "evilPiecesMs",
    isOn: (b) => b.evilPieces,
    lift: (b, rand) => {
      b.evilPieces = false;
      // Swap the evil preview for a normal one right away, so the tray never
      // sits empty waiting on the next spawn
      b.nextQueue = refillNextQueue(rand, false);
    },
  },
  {
    type: SpecialType.CrazyIvan,
    timerField: "crazyIvanMs",
    isOn: (b) => b.crazyIvan,
    lift: (b) => {
      b.crazyIvan = false;
    },
  },
  {
    type: SpecialType.FreezeDried,
    timerField: "freezeDriedMs",
    isOn: (b) => b.freezeDried,
    lift: (b) => {
      b.freezeDried = false;
    },
  },
  {
    type: SpecialType.Transparency,
    timerField: "transparencyMs",
    isOn: (b) => b.transparency,
    lift: (b) => {
      b.transparency = false;
    },
  },
  {
    type: SpecialType.Psycho,
    timerField: "psychoMs",
    isOn: (b) => b.psychoSeed > 0,
    lift: (b) => {
      b.psychoSeed = 0;
      b.psychoOverlay = null;
    },
  },
];

// A fresh hit puts the clock back to a full duration
export function startAffliction(board: EittrisBoard, type: SpecialType): void {
  const spec = AFFLICTION_TIMERS.find((a) => a.type === type);
  if (spec) (board as any)[spec.timerField] = AFFLICTION_DURATION_MS;
}

export function afflictionMsLeft(board: EittrisBoard, type: SpecialType): number {
  const spec = AFFLICTION_TIMERS.find((a) => a.type === type);
  return spec ? ((board as any)[spec.timerField] as number) : 0;
}

// Age every clock and lift whatever ran out.  Returns the afflictions that
// ended, so the caller can re-send the board and announce them.
export function tickAfflictions(
  board: EittrisBoard,
  dtMs: number,
  rand: () => number,
): SpecialType[] {
  const ended: SpecialType[] = [];
  for (const spec of AFFLICTION_TIMERS) {
    const left = (board as any)[spec.timerField] as number;
    if (left <= 0) {
      // An affliction with no clock (restored from an older checkpoint) still
      // needs one, or it would hang around forever
      if (spec.isOn(board)) (board as any)[spec.timerField] = AFFLICTION_DURATION_MS;
      continue;
    }
    const next = Math.max(0, left - dtMs);
    (board as any)[spec.timerField] = next;
    if (next === 0) {
      spec.lift(board, rand);
      ended.push(spec.type);
    }
  }
  return ended;
}

// Everything an antidote washes off.  Returns what was actually lifted, so
// the same "an affliction ended" announcement covers curing too.
export function cureAfflictions(board: EittrisBoard, rand: () => number): SpecialType[] {
  const ended: SpecialType[] = [];
  for (const spec of AFFLICTION_TIMERS) {
    if (spec.isOn(board)) ended.push(spec.type);
    spec.lift(board, rand);
    (board as any)[spec.timerField] = 0;
  }
  return ended;
}

// Does this board have anything an antidote would cure?
export function hasAfflictions(board: EittrisBoard): boolean {
  return AFFLICTION_TIMERS.some((spec) => spec.isOn(board));
}

// A special sitting on one settled block.  It never decays: it waits there
// until the player clears its row, and no other special appears while it
// is still on the board.
export interface SpecialMarker {
  index: number; // cell index = y * BOARD_WIDTH + x
  type: SpecialType;
}

// Every settled cell that could carry a marker
export function occupiedCellIndices(grid: number[][]): number[] {
  const out: number[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (grid[y][x] !== EMPTY_CELL) out.push(y * BOARD_WIDTH + x);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// A powerup belongs to a BLOCK, not to a coordinate.
//
// Markers are stored as a cell index, and half a dozen things move the grid out from under
// them - a row collapsing, an attack painting over the stack, a jumble shaking it apart, a
// screen swap.  Any of those can leave a marker sitting on a cell that no longer holds a
// block, and it would be drawn floating in mid-air and never be collectable.
//
// Rather than remembering to prune at each of those call sites - and forgetting at the next
// one someone adds - the invariant is enforced centrally, every tick: a marker whose cell is
// empty is not a powerup, it is a leftover.
// ------------------------------------------------------------------------------------------
export function pruneOrphanedSpecials(grid: number[][], markers: SpecialMarker[]): SpecialMarker[] {
  return markers.filter((marker) => {
    const y = Math.floor(marker.index / BOARD_WIDTH);
    const x = marker.index % BOARD_WIDTH;
    if (y < 0 || y >= BOARD_HEIGHT || x < 0 || x >= BOARD_WIDTH) return false;
    return grid[y][x] !== EMPTY_CELL;
  });
}

// True when every marker still has a block under it
export function specialsAreAnchored(grid: number[][], markers: SpecialMarker[]): boolean {
  return pruneOrphanedSpecials(grid, markers).length === markers.length;
}

// A board may carry several powerups at once, but never two close enough
// vertically to be cleared by the same piece - landing one brick and setting
// off two attacks at once is a lottery, not a play.
export const SPECIAL_MIN_ROW_GAP = 4;

// Pick a settled block to tag: never one that already carries a marker, and
// never within SPECIAL_MIN_ROW_GAP rows of an existing one.
export function pickSpecialCell(
  grid: number[][],
  markers: SpecialMarker[],
  rand: () => number,
): number | null {
  const taken = new Set(markers.map((m) => m.index));
  const busyRows = markers.map((m) => Math.floor(m.index / BOARD_WIDTH));
  const free = occupiedCellIndices(grid).filter((i) => {
    if (taken.has(i)) return false;
    const row = Math.floor(i / BOARD_WIDTH);
    return busyRows.every((busy) => Math.abs(busy - row) >= SPECIAL_MIN_ROW_GAP);
  });
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

// Clearing a row collects the specials sitting on it; markers above the
// cleared rows ride down with their blocks.
export function collectAndShiftMarkers(
  markers: SpecialMarker[],
  clearedRows: number[],
): { collected: SpecialType[]; markers: SpecialMarker[] } {
  if (clearedRows.length === 0) return { collected: [], markers };
  const collected: SpecialType[] = [];
  const survivors: SpecialMarker[] = [];
  for (const marker of markers) {
    const row = Math.floor(marker.index / BOARD_WIDTH);
    const col = marker.index % BOARD_WIDTH;
    if (clearedRows.includes(row)) {
      collected.push(marker.type);
      continue;
    }
    const shift = clearedRows.filter((r) => r > row).length;
    survivors.push({ ...marker, index: (row + shift) * BOARD_WIDTH + col });
  }
  return { collected, markers: survivors };
}

// ------------------------------------------------------------------------------------------
// Gravity - eitrix's continuous curve in per-second form: exponential decay
// above the knee, a linear floor below it, clamped to a sane minimum.
// ------------------------------------------------------------------------------------------
export function gravityStep(intervalMs: number, dtSeconds: number, speedUp = 1): number {
  let next: number;
  if (intervalMs < LINEAR_KNEE_MS) {
    next = intervalMs - LINEAR_DECAY_MS_PER_SEC * speedUp * dtSeconds;
  } else {
    next = intervalMs * Math.exp(-EXP_DECAY_PER_SEC * speedUp * dtSeconds);
  }
  return Math.max(MIN_INTERVAL_MS, next);
}

// ------------------------------------------------------------------------------------------
// Spawning - uniform random type (no 7-bag), random initial rotation, at the
// spawn point.  `rand` is a 0..1 source (inject Math.random, or a fixed value
// in tests).  A fresh spawn that immediately collides kills the board.
// ------------------------------------------------------------------------------------------
export function randomPieceType(rand: () => number): number {
  return Math.min(PIECE_COUNT - 1, Math.floor(rand() * PIECE_COUNT));
}

// ------------------------------------------------------------------------------------------
// The seven-bag.
//
// Pieces come one bag at a time: all seven, shuffled, then another seven.  Drawing each
// piece independently means a player can go twenty pieces without the I they are holding a
// well open for, or get four S pieces in a row and lose to the dice.  A bag bounds the
// drought at twelve pieces and makes the game about placing what comes rather than about
// what comes - which is what every modern tetris does, and for the same reason.
//
// The bag is not stored anywhere: the preview queue IS the bag.  A whole shuffled seven is
// appended whenever the queue runs short, so the order survives a checkpoint and a rejoin
// without a second field to keep in step with it.
// ------------------------------------------------------------------------------------------
export function shuffledBag(rand: () => number): number[] {
  const bag = Array.from({ length: PIECE_COUNT }, (_, i) => i);
  // Fisher-Yates, forwards, on the injected randomness so a test can pin the order.  Taken
  // forwards rather than backwards for one reason: a rand() that always returns 0 then
  // shuffles nothing, which is what makes a fixed-randomness test readable.
  for (let i = 0; i < bag.length - 1; i++) {
    const j = Math.min(bag.length - 1, i + Math.floor(rand() * (bag.length - i)));
    const swap = bag[i];
    bag[i] = bag[j];
    bag[j] = swap;
  }
  return bag;
}

/** Top the queue up so it can always answer the deepest preview.  Mutates in place. */
function topUpQueue(queue: number[], rand: () => number, evil: boolean) {
  while (queue.length < NEXT_QUEUE_DEPTH) {
    if (evil) {
      // EvilPieces deals nothing but S and Z; there is no bag to draw, only the two
      queue.push(Math.min(EVIL_PIECE_COUNT - 1, Math.floor(rand() * EVIL_PIECE_COUNT)));
    } else {
      queue.push(...shuffledBag(rand));
    }
  }
}

export function spawnPiece(type: number, rotations: number, evil = false): EittrisPiece {
  return { type, rot: ((rotations % 4) + 4) % 4, x: SPAWN_X, y: SPAWN_Y, evil };
}

// Pull the next piece off the queue (topping it up) and spawn it with a random rotation
export function spawnNextFromQueue(
  nextQueue: number[],
  rand: () => number,
  evil = false,
): { piece: EittrisPiece; queue: number[] } {
  const queue = nextQueue.slice();
  topUpQueue(queue, rand, evil);
  const type = queue.shift()!;
  topUpQueue(queue, rand, evil);
  return { piece: spawnPiece(type, Math.floor(rand() * 4), evil), queue };
}

// Build a full preview queue from scratch.  Used whenever an affliction
// switches which table pieces come from - clearing the queue without
// refilling it would leave the phone's Next tray empty until the next spawn.
export function refillNextQueue(rand: () => number, evil = false): number[] {
  const queue: number[] = [];
  topUpQueue(queue, rand, evil);
  return queue;
}

// ------------------------------------------------------------------------------------------
// One player's whole board - a plain serializable struct owned by the presenter
// ------------------------------------------------------------------------------------------
export const BACKGROUND_COUNT = 7; // Grid00.png .. Grid06.png

export interface EittrisBoard {
  playerId: string;
  grid: number[][];
  piece: EittrisPiece | null; // null once the board is dead
  nextQueue: number[]; // upcoming piece types
  rows: number; // total rows cleared
  alive: boolean;
  intervalMs: number; // current gravity interval
  dropTimerMs: number; // accumulator toward the next gravity step
  deathOrder: number; // 0 while alive; 1 = first board to top out
  backgroundIndex: number; // which Grid background this board draws
  targetId: string | null; // current powerup target (groundwork for specials)
  // Bumped every time a new piece spawns.  Phones use it to notice that the
  // piece they were dragging got placed, so the rest of that gesture can't
  // leak onto the next one.
  pieceSeq: number;
  // A row clear playing out: the rows are eaten away, then the stack above
  // falls into the gap.  While this is set the board holds the PRE-collapse
  // grid, no piece is falling, and the spawn gap has not started yet.
  clearing: { rows: number[]; elapsedMs: number; eatMs: number; fallMs: number } | null;
  // Milliseconds left in the post-lock gap before the next piece appears
  // (0 = not waiting).  While piece is null and this is counting down, the
  // board accepts no input at all.
  spawnDelayMs: number;
  // Specials sitting on settled blocks, waiting to be cleared for
  specials: SpecialMarker[];
  specialTimerMs: number; // countdown to tagging the next block
  antidotes: number; // stored antidote charges (max ANTIDOTE_MAX)
  // Banked earthquakes, and how much of the current shake is left (0 = not shaking)
  earthquakes: number;
  quakeMs: number;
  // The stack coming down after a shake: how far each block fell, and how far through the
  // fall we are.  null when nothing is falling.
  quakeFall: { drops: number[]; elapsedMs: number; fallMs: number } | null;
  // Rows cleared at the last earthquake award, so the every-22 count survives a checkpoint
  quakeRowMark: number;
  // Afflictions laid on this board by other players' specials.  Kept apart
  // from intervalMs (the natural gravity curve) so an antidote can wipe them.
  speedupStacks: number;
  // SlowDown is a self-buff, so an antidote does NOT wash it off
  slowdownStacks: number;
  // SeeShadows: the landing ghost, on for the rest of the round once earned
  seeShadows: boolean;
  seeShadowsMs: number; // 0 when it is off
  // CrystalBall: see three pieces ahead instead of one.  A perk, like
  // SeeShadows - yours for the round, and no antidote takes it away.
  crystalBall: boolean;
  // EvilPieces: this board draws from the nastier table until cured
  evilPieces: boolean;
  // CrazyIvan: left/right and rotation are inverted until cured
  crazyIvan: boolean;
  // FreezeDried: settled blocks shrivel to jittered specks until cured
  freezeDried: boolean;
  // Transparency: the settled stack is invisible until cured
  transparency: boolean;
  // Milliseconds left on each affliction (0 = not afflicted).  One clock per
  // affliction, refreshed by a fresh hit; see AFFLICTION_TIMERS.
  speedupMs: number;
  evilPiecesMs: number;
  crazyIvanMs: number;
  freezeDriedMs: number;
  transparencyMs: number;
  psychoMs: number;
  // Psycho: colors are remapped, reshuffled on every new piece
  psychoSeed: number; // 0 = not afflicted
  // Psycho's per-cell palette indices - the XOR'd background plus the trail
  // the falling piece leaves behind.  null whenever psychoSeed is 0.
  psychoOverlay: number[][] | null;
  shieldMs: number; // remaining antidote shield/cure time (0 = inactive)
  forcedSpecial: SpecialType | null; // dev selector: only ever spawn this
  // DEV: hand this board to the computer player
  aiControlled: boolean;
  // A robot is standing in because the player dropped out.  Kept apart from
  // aiControlled so that handing the seat back restores whatever the player
  // had chosen, rather than always switching the bot off.
  robotTakeover: boolean;
  aiTimerMs: number; // countdown to the bot's next move
  // A Bridge painting itself across the top of this board
  pendingBridge: PendingBridge | null;
  // Jumble shaking this board apart, a nudge at a time
  jumbleLeft: number;
  jumbleTimerMs: number;
  // SwitchScreens trading columns with another board
  pendingSwap: PendingSwap | null;
  // An attack stencil currently painting itself into this board
  pendingStencil: PendingStencil | null;
}

export function makeBoard(
  playerId: string,
  rand: () => number,
  speed: EittrisSpeed = "slow",
): EittrisBoard {
  const spawned = spawnNextFromQueue([], rand);
  return {
    playerId,
    grid: emptyGrid(),
    piece: spawned.piece,
    nextQueue: spawned.queue,
    rows: 0,
    alive: true,
    intervalMs: startIntervalFor(speed),
    dropTimerMs: 0,
    deathOrder: 0,
    backgroundIndex: Math.min(BACKGROUND_COUNT - 1, Math.floor(rand() * BACKGROUND_COUNT)),
    targetId: null,
    pieceSeq: 1,
    spawnDelayMs: 0,
    specials: [],
    specialTimerMs: SPECIAL_INTERVAL_MS,
    antidotes: ANTIDOTES_AT_START,
    earthquakes: 0,
    quakeMs: 0,
    quakeFall: null,
    quakeRowMark: 0,
    speedupStacks: 0,
    slowdownStacks: 0,
    seeShadows: false,
    seeShadowsMs: 0,
    crystalBall: false,
    evilPieces: false,
    crazyIvan: false,
    freezeDried: false,
    transparency: false,
    speedupMs: 0,
    evilPiecesMs: 0,
    crazyIvanMs: 0,
    freezeDriedMs: 0,
    transparencyMs: 0,
    psychoMs: 0,
    psychoSeed: 0,
    psychoOverlay: null,
    shieldMs: 0,
    forcedSpecial: null,
    aiControlled: false,
    robotTakeover: false,
    aiTimerMs: 0,
    clearing: null,
    pendingStencil: null,
    pendingBridge: null,
    jumbleLeft: 0,
    pendingSwap: null,
    jumbleTimerMs: 0,
  };
}

// ------------------------------------------------------------------------------------------
// Target targeting - initialized as a ring (player i targets i+1), re-aimed
// when a target dies.  Ring order is the board-array order.
// ------------------------------------------------------------------------------------------

// Assign the initial ring: each board targets the next one (null when solo)
export function initTargetRing(boards: EittrisBoard[]): void {
  boards.forEach((board, i) => {
    board.targetId = boards.length > 1 ? boards[(i + 1) % boards.length].playerId : null;
  });
}

// The next living, non-self player in ring order after `fromId` (null if none)
export function nextLivingTarget(
  ringOrder: string[],
  aliveIds: Set<string>,
  selfId: string,
  fromId: string,
): string | null {
  const start = ringOrder.indexOf(fromId);
  if (start < 0) return null;
  for (let step = 1; step <= ringOrder.length; step++) {
    const candidate = ringOrder[(start + step) % ringOrder.length];
    if (candidate !== selfId && aliveIds.has(candidate)) return candidate;
  }
  return null;
}

// A player died: every board targeting them re-aims at the next live player in
// ring order.  Returns the ids of the boards whose target changed.
export function retargetOnDeath(boards: EittrisBoard[], deadId: string): string[] {
  const ringOrder = boards.map((b) => b.playerId);
  const aliveIds = new Set(boards.filter((b) => b.alive).map((b) => b.playerId));
  const changed: string[] = [];
  for (const board of boards) {
    if (board.targetId === deadId) {
      board.targetId = nextLivingTarget(ringOrder, aliveIds, board.playerId, deadId);
      changed.push(board.playerId);
    }
  }
  return changed;
}

// ------------------------------------------------------------------------------------------
// 1-bit board thumbnails - one bit per SETTLED cell, 210 bits packed MSB-first
// into 27 bytes, base64'd to a 36-char string.  Broadcast to every phone for the
// target list.
//
// The falling piece is deliberately left out.  Including it changed the thumbnail
// every time gravity moved a piece one row, which meant every board's thumbnail
// differed on every broadcast and none of them could ever be skipped - the piece
// was costing far more in bandwidth than four moving dots are worth at this size.
// ------------------------------------------------------------------------------------------
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeThumbnail(grid: number[][]): string {
  const bytes = new Uint8Array(27); // 216 bits; the last 6 stay zero
  const setBit = (index: number) => {
    bytes[index >> 3] |= 0x80 >> (index & 7);
  };
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (grid[y][x] !== EMPTY_CELL) setBit(y * BOARD_WIDTH + x);
    }
  }
  // 27 bytes = 9 groups of 3 = exactly 36 base64 chars, no padding needed
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >> 18) & 63] +
      B64_ALPHABET[(n >> 12) & 63] +
      B64_ALPHABET[(n >> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  return out;
}

// Decode back to one boolean per cell (length 210, row-major)
export function decodeThumbnail(thumb: string): boolean[] {
  const bytes = new Uint8Array(27);
  for (let i = 0, b = 0; i + 4 <= thumb.length && b + 3 <= bytes.length; i += 4, b += 3) {
    const n =
      (B64_ALPHABET.indexOf(thumb[i]) << 18) |
      (B64_ALPHABET.indexOf(thumb[i + 1]) << 12) |
      (B64_ALPHABET.indexOf(thumb[i + 2]) << 6) |
      B64_ALPHABET.indexOf(thumb[i + 3]);
    bytes[b] = (n >> 16) & 0xff;
    bytes[b + 1] = (n >> 8) & 0xff;
    bytes[b + 2] = n & 0xff;
  }
  const cells: boolean[] = [];
  for (let index = 0; index < BOARD_WIDTH * BOARD_HEIGHT; index++) {
    cells.push((bytes[index >> 3] & (0x80 >> (index & 7))) !== 0);
  }
  return cells;
}

// Rank for game end: survivors first, then the dead - died later is better.  Rows cleared
// breaks ties, which used to be the score's job; the score measured how long you had been
// pressing buttons more than how well you were playing (see DESIGN.md "Game over").
export function rankBoards(boards: EittrisBoard[]): EittrisBoard[] {
  return boards.slice().sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.rows - a.rows;
    if (a.deathOrder !== b.deathOrder) return b.deathOrder - a.deathOrder;
    return b.rows - a.rows;
  });
}

// ------------------------------------------------------------------------------------------
// The earthquake's collapse.
//
// Every settled block falls straight down as far as it can, column by column, closing every
// hole underneath it.  That is what makes the powerup worth having: the buried gaps a
// player has been carrying around are exactly what stops them clearing rows, and no amount
// of good placement digs them out again.
//
// Powerup markers belong to blocks, so they travel with them.  Anything left behind would
// be a marker floating over an empty cell, which the simulation prunes a frame later - the
// player would simply lose it.
// ------------------------------------------------------------------------------------------
export function collapseGravity(
  grid: number[][],
  markers: SpecialMarker[] = [],
): { grid: number[][]; markers: SpecialMarker[]; drops: number[] } {
  const out = emptyGrid();
  const moved = new Map<number, number>(); // old cell index -> new cell index
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let write = BOARD_HEIGHT - 1;
    for (let y = BOARD_HEIGHT - 1; y >= 0; y--) {
      if (grid[y][x] === EMPTY_CELL) continue;
      out[write][x] = grid[y][x];
      moved.set(y * BOARD_WIDTH + x, write * BOARD_WIDTH + x);
      write--;
    }
  }
  // How far each block fell, indexed by where it ENDED UP - which is what an animation
  // needs, because it draws the new grid and offsets each block back to where it came from.
  const drops: number[] = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(0);
  for (const [from, to] of moved) {
    drops[to] = Math.floor(to / BOARD_WIDTH) - Math.floor(from / BOARD_WIDTH);
  }
  return {
    grid: out,
    drops,
    markers: markers
      .filter((m) => moved.has(m.index))
      .map((m) => ({ ...m, index: moved.get(m.index)! })),
  };
}

// The per-cell drops on the wire.  One character per cell, base 36, '.' for a block that
// did not move - the same shape as the grid string, and just as cheap to read.
export function encodeDrops(drops: number[]): string {
  return drops.map((d) => (d > 0 ? d.toString(36) : ".")).join("");
}

export function decodeDrops(encoded: string): number[] {
  const out: number[] = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(0);
  for (let i = 0; i < out.length && i < encoded.length; i++) {
    const c = encoded[i];
    if (c !== ".") out[i] = parseInt(c, 36);
  }
  return out;
}

/** Which rows are full right now.  The earthquake needs this without locking a piece. */
export function fullRows(grid: number[][]): number[] {
  const rows: number[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (grid[y].every((cell) => cell !== EMPTY_CELL)) rows.push(y);
  }
  return rows;
}

// ------------------------------------------------------------------------------------------
// Wire encoding - the 210-char grid string ('.' empty, digit 0-6 = piece type)
// ------------------------------------------------------------------------------------------
export function encodeGrid(grid: number[][]): string {
  let out = "";
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const v = grid[y][x];
      out += v === EMPTY_CELL ? "." : String(v);
    }
  }
  return out;
}

export function decodeGrid(encoded: string): number[][] {
  const grid = emptyGrid();
  for (let i = 0; i < Math.min(encoded.length, BOARD_WIDTH * BOARD_HEIGHT); i++) {
    const ch = encoded[i];
    grid[Math.floor(i / BOARD_WIDTH)][i % BOARD_WIDTH] = ch === "." ? EMPTY_CELL : Number(ch);
  }
  return grid;
}

// ==========================================================================================
// Computer player (one difficulty for now).
//
// It only rotates and moves left/right - it never drops - so it plays by
// steering the piece to a chosen column/rotation and letting gravity finish
// the job.  The plan is scored the way a person eyeballs it:
//   - land as low as possible
//   - touch as much existing material as possible
//   - never roof over an empty cell (a gap blocked from above is a disaster)
// ==========================================================================================

export interface AiPlan {
  rot: number; // desired rotation (0-3)
  x: number; // desired piece origin column
  score: number;
}

// Where would this piece come to rest if it fell from here?
export function dropDestination(grid: number[][], piece: EittrisPiece): EittrisPiece {
  return hardDrop(grid, piece).piece;
}

// How many of the piece's faces would touch a wall, the floor, or a settled
// block once it lands?
export function contactCount(grid: number[][], piece: EittrisPiece): number {
  const cells = pieceCells(piece);
  const own = new Set(cells.map((c) => `${c.x},${c.y}`));
  let contacts = 0;
  for (const c of cells) {
    const neighbors = [
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y + 1 },
    ];
    for (const n of neighbors) {
      if (own.has(`${n.x},${n.y}`)) continue;
      if (n.x < 0 || n.x >= BOARD_WIDTH || n.y >= BOARD_HEIGHT) {
        contacts++; // wall or floor
      } else if (n.y >= 0 && grid[n.y][n.x] !== EMPTY_CELL) {
        contacts++; // settled block
      }
    }
  }
  return contacts;
}

// Empty cells with something solid above them - the holes we must not create
export function countCoveredGaps(grid: number[][]): number {
  let gaps = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let covered = false;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (grid[y][x] !== EMPTY_CELL) covered = true;
      else if (covered) gaps++;
    }
  }
  return gaps;
}

// Settle a piece into a copy of the grid (no row clearing - the AI only
// needs the resulting shape)
export function withPieceSettled(grid: number[][], piece: EittrisPiece): number[][] {
  const next = grid.map((row) => row.slice());
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      next[c.y][c.x] = piece.type;
    }
  }
  return next;
}

// Weights for the placement score.
//
// Two deliberate choices, both learned from watching the bot lose:
//
// GAPS ARE A FLAT PENALTY, not a per-hole one.  A board that has been hit with
// TowerOfEit is riddled with holes, and counting each one stymied the bot
// completely - every legal move looked catastrophic, so it made the shortest-
// sighted one available.  Burying a cell is a yes/no fact about a placement:
// one hole or five, the answer is "this is not a clean placement", worth about
// three rows of height.
//
// HEIGHT IS ZONED.  A row near the floor is cheap; the same row two-thirds of
// the way up is worth double, and in the top third triple.  Stacking low is
// mildly good, stacking high is genuinely dangerous, and a linear cost does
// not say that.
export const AI_HEIGHT_UNIT = 3;
export const AI_GAP_PENALTY = 3 * AI_HEIGHT_UNIT; // any gaps at all cost this
export const AI_CONTACT_WEIGHT = 3;
// Clearing rows is the only thing that ever makes a board better, so it is worth more than
// any tidiness: four at once is worth more than four singles, which is what stops the bot
// from nibbling one row at a time and never digging itself out.
export const AI_CLEAR_WEIGHT = 14;
// Dropping a block into a column that already has a hole under it buries that hole deeper.
// Per block, because a piece lying flat across three bad columns is three times the sin.
export const AI_BURY_PENALTY = 8;
// How much the NEXT piece's best placement counts toward this one's score.  Less than the
// present, because the next piece is a fact and the one after it is not.
export const AI_LOOKAHEAD_WEIGHT = 0.6;
// How many of this piece's placements are worth looking a move ahead from.  All of them is
// forty times the work for the benefit of ranking placements that were never in contention.
export const AI_LOOKAHEAD_CANDIDATES = 6;

// 1 in the bottom third of the board, 2 in the middle, 3 up top
export function heightZoneMultiplier(row: number): number {
  const third = BOARD_HEIGHT / 3;
  if (row >= BOARD_HEIGHT - third) return 1;
  if (row >= BOARD_HEIGHT - 2 * third) return 2;
  return 3;
}

// What it costs to leave a block sitting at this row
export function heightCost(row: number): number {
  const rowsAboveFloor = Math.max(0, BOARD_HEIGHT - 1 - row);
  return rowsAboveFloor * AI_HEIGHT_UNIT * heightZoneMultiplier(row);
}

// How many rows tall the stack is (0 = empty board)
export function stackHeight(grid: number[][]): number {
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (grid[y].some((cell) => cell !== EMPTY_CELL)) return BOARD_HEIGHT - y;
  }
  return 0;
}

/** Which columns have a hole somewhere under their stack right now. */
export function columnsWithGaps(grid: number[][]): boolean[] {
  const bad: boolean[] = new Array(BOARD_WIDTH).fill(false);
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let covered = false;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (grid[y][x] !== EMPTY_CELL) covered = true;
      else if (covered) {
        bad[x] = true;
        break;
      }
    }
  }
  return bad;
}

/** How full the board is, 0..1.  What the bot uses to decide how frightened to be. */
export function fillFraction(grid: number[][]): number {
  let filled = 0;
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) if (grid[y][x] !== EMPTY_CELL) filled++;
  }
  return filled / (BOARD_WIDTH * BOARD_HEIGHT);
}

/**
 * How badly this board wants the next piece kept LOW.
 *
 * On an empty board a piece landing high costs almost nothing - there is all the room in
 * the world.  On a board two thirds full the same placement is most of a death, and the bot
 * used to price the two the same and go on politely tidying its edges while the stack came
 * up to meet it.
 */
export function heightUrgency(grid: number[][]): number {
  return 1 + 2 * (stackHeight(grid) / BOARD_HEIGHT);
}

export function scorePlacement(grid: number[][], landed: EittrisPiece): number {
  const settled = withPieceSettled(grid, landed);
  const madeGaps = countCoveredGaps(settled) > countCoveredGaps(grid);
  // The piece's TOP cell is how high up this placement reaches
  const highest = Math.min(...pieceCells(landed).map((c) => c.y));

  // Rows this placement completes, and blocks it drops onto a column that is already
  // hiding a hole - piling onto a hole is how a bot buries itself past digging out.
  const alreadyFull = new Set(fullRows(grid));
  const cleared = fullRows(settled).filter((row) => !alreadyFull.has(row)).length;
  const bad = columnsWithGaps(grid);
  let buried = 0;
  for (const c of pieceCells(landed)) if (bad[c.x]) buried++;

  return (
    -(madeGaps ? AI_GAP_PENALTY : 0) -
    heightCost(highest) * heightUrgency(grid) -
    AI_BURY_PENALTY * buried +
    AI_CLEAR_WEIGHT * cleared * cleared +
    AI_CONTACT_WEIGHT * contactCount(grid, landed)
  );
}

/** The board as it would be after this placement, rows and all. */
export function boardAfter(grid: number[][], landed: EittrisPiece): number[][] {
  const settled = withPieceSettled(grid, landed);
  const rows = fullRows(settled);
  return rows.length > 0 ? collapseRows(settled, rows) : settled;
}

// Try every rotation at every reachable column and keep the best landing.
// Columns are only considered if the piece can actually slide there from its
// current position, since the AI moves one step at a time.
/** Every landing this piece could reach from here, scored on its own merits. */
function everyPlacement(
  grid: number[][],
  piece: EittrisPiece,
): { plan: AiPlan; landed: EittrisPiece }[] {
  const out: { plan: AiPlan; landed: EittrisPiece }[] = [];
  for (let rot = 0; rot < 4; rot++) {
    const rotated = { ...piece, rot: (piece.rot + rot) % 4 };
    // From wherever this rotation's box has to sit to reach column 0, to wherever it has to
    // sit to reach the far wall.  Starting at 0 would leave the robot unable to use the
    // leftmost columns with half the pieces.
    const range = pieceColumnRange(rotated);
    for (let x = range.min; x <= range.max; x++) {
      const candidate = { ...rotated, x };
      if (collides(grid, pieceCells(candidate))) continue;
      const landed = dropDestination(grid, candidate);
      out.push({ plan: { rot: candidate.rot, x, score: scorePlacement(grid, landed) }, landed });
    }
  }
  return out;
}

/**
 * Where to put this piece, given what is coming after it.
 *
 * The bot used to judge a placement entirely on its own, which is how it walked into the
 * hole it could not get out of: the tidiest place for the piece in hand is often the place
 * that leaves nowhere for the next one.  With `nextType` it plays both, and scores the
 * pair.
 *
 * Only the best few placements are looked ahead from.  Doing it for all forty is forty
 * times the work to rank placements that were never in contention.
 */
export function planPlacement(
  grid: number[][],
  piece: EittrisPiece,
  nextType?: number,
): AiPlan | null {
  const placements = everyPlacement(grid, piece);
  if (placements.length === 0) return null;
  if (nextType === undefined) {
    return placements.reduce((a, b) => (b.plan.score > a.plan.score ? b : a)).plan;
  }

  const shortlist = placements
    .slice()
    .sort((a, b) => b.plan.score - a.plan.score)
    .slice(0, AI_LOOKAHEAD_CANDIDATES);

  let best: AiPlan | null = null;
  for (const { plan, landed } of shortlist) {
    const after = boardAfter(grid, landed);
    const nextPiece: EittrisPiece = { ...piece, type: nextType, rot: 0, x: SPAWN_X, y: SPAWN_Y };
    const followUps = everyPlacement(after, nextPiece);
    const followUp = followUps.length
      ? followUps.reduce((a, b) => (b.plan.score > a.plan.score ? b : a)).plan.score
      : // Nowhere to put the next piece at all: that is the board being dead, and by far
        // the worst thing a placement can lead to.
        -1000;
    const total = plan.score + AI_LOOKAHEAD_WEIGHT * followUp;
    if (!best || total > best.score) best = { rot: plan.rot, x: plan.x, score: total };
  }
  return best;
}

// The single step to take right now to work toward the plan: rotate first,
// then walk sideways.  null means "already lined up - just let it fall".
export type AiMove = "rotate" | "left" | "right" | null;

export function nextAiMove(piece: EittrisPiece, plan: AiPlan): AiMove {
  if (piece.rot !== plan.rot) return "rotate";
  if (piece.x > plan.x) return "left";
  if (piece.x < plan.x) return "right";
  return null;
}

// ==========================================================================================
// Attack stencils - the eitrix signature.  An attack paints a shape into the
// BOTTOM of the victim's grid, one row per STENCIL_ROW_MS, overwriting what
// is there (it does NOT push the stack up).  Shapes are arrays of rows,
// bottom row last, using:
//    '#' put a garbage block here
//    '-' destroy whatever is here
//    '.' leave this cell alone
// The whole shape is randomly mirrored, exactly like the original.
// ==========================================================================================

// A stencil mid-paint, living on the victim's board
export interface PendingStencil {
  shape: string[];
  row: number; // how many rows have been painted so far
  reverse: boolean; // horizontal mirror
  timerMs: number; // countdown to the next row
  blockCell: number; // what '#' lays down (garbage, or the tower's stone)
}

// TheWall: solid rows, each with a single random gap - a ragged chimney
export function makeWallShape(rand: () => number): string[] {
  const rows: string[] = [];
  for (let i = 0; i < WALL_ROWS; i++) {
    const gap = Math.min(BOARD_WIDTH - 1, Math.floor(rand() * BOARD_WIDTH));
    let row = "";
    for (let x = 0; x < BOARD_WIDTH; x++) row += x === gap ? "-" : "#";
    rows.push(row);
  }
  return rows;
}

// Paint one row of a stencil.  rowIndex 0 is the shape's BOTTOM row, which
// lands on the bottom row of the grid.
export function paintStencilRow(
  grid: number[][],
  shape: string[],
  rowIndex: number,
  reverse: boolean,
  blockCell: number = GARBAGE_CELL,
): number[][] {
  const next = grid.map((row) => row.slice());
  const gridY = BOARD_HEIGHT - 1 - rowIndex;
  const line = shape[shape.length - 1 - rowIndex];
  if (gridY < 0 || !line) return next;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    const sourceX = reverse ? line.length - 1 - x : x;
    const ch = line[sourceX];
    if (ch === "#") next[gridY][x] = blockCell;
    else if (ch === "-") next[gridY][x] = EMPTY_CELL;
  }
  return next;
}

// Being buried can leave the falling piece inside solid blocks.  Lift it
// until it is legal again; null means there is nowhere left to go.
export function liftPieceClear(grid: number[][], piece: EittrisPiece): EittrisPiece | null {
  let current = piece;
  for (let i = 0; i <= BOARD_HEIGHT; i++) {
    if (!collides(grid, pieceCells(current))) return current;
    current = { ...current, y: current.y - 1 };
  }
  return null;
}

// ------------------------------------------------------------------------------------------
// Static stencil shapes, verbatim from the original.  Rows are listed
// top-to-bottom; the LAST row lands on the bottom row of the victim's grid.
// (TheWall is generated per-attack instead - see makeWallShape.)
// ------------------------------------------------------------------------------------------
export const ESCALATOR_SHAPE: string[] = [
  ".........#",
  "........#-",
  ".......#-.",
  "......#-..",
  ".....#-...",
  "....#-....",
  "...#-.....",
  "..#-......",
  ".#-.......",
  "#-........",
];

// A hollow ring of garbage - the '-' outline destroys what it passes over
export const SHACKLE_SHAPE: string[] = [
  "..........",
  "..-####-..",
  "..#----#..",
  ".#-....-#.",
  "#-......-#",
  "#-......-#",
  "#-......-#",
  "#-......-#",
  ".#-....-#.",
  "..#----#..",
  "..-####-..",
];

// A squat castle tower, laid in its own darker stone
export const TOWER_SHAPE: string[] = [
  "-#-#--#-#-",
  "-########-",
  "-########-",
  "--##-###--",
  "--##-###--",
  "--####-#--",
  "--####-#--",
  "--#-####--",
  "--#-####--",
  "--###-##--",
  "--###-##--",
  "--######--",
];

// Every special that paints a fixed shape.  Adding one here is all it takes.
export const STENCIL_SHAPES: Partial<Record<SpecialType, string[]>> = {
  [SpecialType.Escalator]: ESCALATOR_SHAPE,
  [SpecialType.Shackle]: SHACKLE_SHAPE,
  [SpecialType.TowerOfEit]: TOWER_SHAPE,
};

// Most attacks lay ordinary garbage; the tower lays its own stone
export function stencilCellFor(type: SpecialType): number {
  return type === SpecialType.TowerOfEit ? TOWER_CELL : GARBAGE_CELL;
}

// The shape an attack should paint (null if this special is not a stencil)
export function stencilShapeFor(type: SpecialType, rand: () => number): string[] | null {
  if (type === SpecialType.TheWall) return makeWallShape(rand);
  return STENCIL_SHAPES[type] ?? null;
}

// ------------------------------------------------------------------------------------------
// Bridge - unlike the other attacks this one lands ON TOP of the victim's
// stack rather than at the floor, and paints column by column instead of row
// by row: two rows, each with one random gap, roofing whatever is there.
// It is also fired automatically at your target whenever you clear 4 rows.
// ------------------------------------------------------------------------------------------
export const BRIDGE_COLUMN_MS = 120;
export const BRIDGE_ROWS = 2;

export interface PendingBridge {
  topY: number; // the row the first bridge row lands on
  skipX: number[]; // one gap column per bridge row
  column: number; // how far across we have painted
  timerMs: number;
  blockCell: number;
}

// The row just above the victim's stack (mirrors the original's scan)
export function bridgeTopRow(grid: number[][]): number {
  let j = 0;
  for (; j < BOARD_HEIGHT - 1; j++) {
    if (grid[j].some((c) => c !== EMPTY_CELL)) break;
  }
  return j - 1;
}

export function makeBridgePlan(grid: number[][], rand: () => number): PendingBridge {
  return {
    topY: bridgeTopRow(grid),
    skipX: [
      Math.min(BOARD_WIDTH - 1, Math.floor(rand() * BOARD_WIDTH)),
      Math.min(BOARD_WIDTH - 1, Math.floor(rand() * BOARD_WIDTH)),
    ],
    column: 0,
    timerMs: 0,
    blockCell: GARBAGE_CELL,
  };
}

// Paint one column of the bridge: a block on each of its rows, except where
// that row's gap falls - there it destroys whatever was underneath.
export function paintBridgeColumn(grid: number[][], plan: PendingBridge): number[][] {
  const next = grid.map((row) => row.slice());
  const x = plan.column;
  if (x < 0 || x >= BOARD_WIDTH) return next;
  for (let j = 0; j < BRIDGE_ROWS; j++) {
    const y = plan.topY - j;
    if (y < 0 || y >= BOARD_HEIGHT) continue;
    if (x === plan.skipX[j]) next[y][x] = EMPTY_CELL;
    else next[y][x] = plan.blockCell;
  }
  return next;
}

// ------------------------------------------------------------------------------------------
// SeeShadows - where the piece would come to rest if it fell from here.
// ------------------------------------------------------------------------------------------
export function landingCells(grid: number[][], piece: EittrisPiece | null): Set<number> {
  const out = new Set<number>();
  if (!piece) return out;
  for (const c of pieceCells(hardDrop(grid, piece).piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      out.add(c.y * BOARD_WIDTH + c.x);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// What a tap means.  Every gesture works anywhere on the grid and always acts
// on the falling piece - you never have to hit the piece itself, which would be
// hopeless on a phone.
//
// A tap rotates, and that is all it does.  Two quick taps used to drop the piece,
// which made every deliberate second rotation a gamble; taps are now simply
// independent of one another.  Dropping is a downward flick.
//
// WHICH WAY it rotates is the side of the piece you tapped: tap to its right and it turns
// to the right, tap to its left and it turns left.  Every tap used to turn the same way, so
// undoing a rotation meant three more of them - three chances for gravity to land the piece
// somewhere you did not want it.  The rule reads off the screen with no explanation.
// ------------------------------------------------------------------------------------------
export type TapAction = "rotateLeft" | "rotateRight" | "none";

/**
 * @param tapX          where the tap landed
 * @param pieceCenterX  the middle of the falling piece, in the same units
 */
export function classifyTap(hasPiece: boolean, tapX: number, pieceCenterX: number): TapAction {
  if (!hasPiece) return "none";
  return tapX < pieceCenterX ? "rotateLeft" : "rotateRight";
}

// ------------------------------------------------------------------------------------------
// Psycho - the board underneath is untouched; only what you SEE lies.  Two
// things happen at once, both straight from the original:
//
//   1. Every cell carries an index into a palette of 32 random colors.  Each
//      time a new piece appears the WHOLE overlay is XOR'd with a fresh random
//      skew, so the background flips to a different scramble of itself.
//   2. The falling piece stamps its own color index into the overlay as it
//      goes, leaving a translucent trail behind it that survives the XOR.
//
// Settled blocks also read their color out of the palette, so nothing on the
// board is the color it should be.
// ------------------------------------------------------------------------------------------
export const PSYCHO_COLOR_COUNT = 32;

// The palette is generated from the seed rather than sent, so the presenter
// minis and the victim's phone agree without a single extra byte on the wire.
export function psychoPalette(seed: number): string[] {
  const colors: string[] = [];
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32 - tiny, deterministic, and good enough for confetti
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < PSYCHO_COLOR_COUNT; i++) {
    const channel = () =>
      Math.floor(next() * 256)
        .toString(16)
        .padStart(2, "0");
    colors.push(`#${channel()}${channel()}${channel()}`);
  }
  return colors;
}

export function emptyPsychoOverlay(): number[][] {
  return Array.from({ length: BOARD_HEIGHT }, () => new Array(BOARD_WIDTH).fill(0));
}

// A new piece arrived: flip the whole overlay to a different scramble
export function xorPsychoOverlay(overlay: number[][], skew: number): number[][] {
  return overlay.map((row) => row.map((v) => (v ^ skew) % PSYCHO_COLOR_COUNT));
}

// The falling piece drags its color along behind it
export function stampPsychoTrail(overlay: number[][], piece: EittrisPiece): number[][] {
  const color = pieceColorIndex(piece) % PSYCHO_COLOR_COUNT;
  const next = overlay.map((row) => row.slice());
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) next[c.y][c.x] = color;
  }
  return next;
}

// 0-31 packs into one character, so the whole overlay is 210 chars - and it
// only rides along at all while somebody is actually afflicted.
export function encodePsychoOverlay(overlay: number[][]): string {
  let out = "";
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      out += String.fromCharCode(48 + (overlay[y][x] % PSYCHO_COLOR_COUNT));
    }
  }
  return out;
}

export function decodePsychoOverlay(encoded: string): number[][] {
  const overlay = emptyPsychoOverlay();
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const code = encoded.charCodeAt(y * BOARD_WIDTH + x) - 48;
      overlay[y][x] = Number.isFinite(code) && code >= 0 ? code % PSYCHO_COLOR_COUNT : 0;
    }
  }
  return overlay;
}

// ------------------------------------------------------------------------------------------
// Jumble - shakes the stack apart: over and over, pick an occupied cell and
// shove it into a random empty neighbour.  Nothing is created or destroyed,
// but a tidy stack turns into swiss cheese.
// ------------------------------------------------------------------------------------------
export const JUMBLE_NUDGES = 200;
export const JUMBLE_NUDGE_MS = 15;
// Tinkle once every this many nudges while the stack is being shaken apart
export const JUMBLE_TINKLE_EVERY = 8;

// One nudge.  Returns the grid unchanged if the pick had nowhere to go.
export function jumbleOnce(grid: number[][], rand: () => number): number[][] {
  const occupied = occupiedCellIndices(grid);
  if (occupied.length === 0) return grid;
  const index = occupied[Math.min(occupied.length - 1, Math.floor(rand() * occupied.length))];
  const y = Math.floor(index / BOARD_WIDTH);
  const x = index % BOARD_WIDTH;

  const empties: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= BOARD_WIDTH || ny < 0 || ny >= BOARD_HEIGHT) continue;
      if (grid[ny][nx] === EMPTY_CELL) empties.push({ x: nx, y: ny });
    }
  }
  if (empties.length === 0) return grid;

  const spot = empties[Math.min(empties.length - 1, Math.floor(rand() * empties.length))];
  const next = grid.map((row) => row.slice());
  next[spot.y][spot.x] = next[y][x];
  next[y][x] = EMPTY_CELL;
  return next;
}

// ------------------------------------------------------------------------------------------
// SwitchScreens - the meanest one: you trade stacks with your target, one
// column at a time, left to right.  Only the attacker carries the plan; each
// step swaps that column between the two grids.
// ------------------------------------------------------------------------------------------
export const SWAP_COLUMN_MS = 100;

export interface PendingSwap {
  otherId: string; // whose board we are trading with
  column: number;
  timerMs: number;
}

// Swap one column between two grids, returning both new grids
export function swapColumn(
  gridA: number[][],
  gridB: number[][],
  column: number,
): { a: number[][]; b: number[][] } {
  const a = gridA.map((row) => row.slice());
  const b = gridB.map((row) => row.slice());
  if (column < 0 || column >= BOARD_WIDTH) return { a, b };
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const keep = a[y][column];
    a[y][column] = b[y][column];
    b[y][column] = keep;
  }
  return { a, b };
}

// ------------------------------------------------------------------------------------------
// Robot players - boards the host simulates so a game works with one or two people.
//
// They are NOT participants: the relay has never heard of them, so they must never appear in
// the presenter's player list, or every broadcast would try to deliver messages to an id that
// does not exist.  Their whole identity is derived from the index, which means the host only
// has to remember HOW MANY there are.
// ------------------------------------------------------------------------------------------
export const MAX_ROBOTS = 4;
// The hard ceiling, above what the host is normally offered.  The dev-only
// stress-test button asks for twenty boards to see what a full host screen
// does; production only ever offers up to MAX_ROBOTS.
export const MAX_ROBOTS_STRESS = 20;

export interface EittrisRobot {
  playerId: string;
  name: string;
  avatarId: number;
  avatarColor: number;
}

// Spread out across the avatar sheet and the palette so robots are easy to tell
// apart from each other at a glance on the host screen.
const ROBOT_AVATARS = [12, 19, 25, 6];
const ROBOT_COLORS = [1, 5, 9, 3];

export function robotRoster(count: number): EittrisRobot[] {
  const wanted = Math.max(0, Math.min(MAX_ROBOTS_STRESS, Math.floor(count || 0)));
  return Array.from({ length: wanted }, (_, i) => ({
    playerId: `robot-${i + 1}`,
    name: `Robot ${i + 1}`,
    avatarId: ROBOT_AVATARS[i % ROBOT_AVATARS.length],
    avatarColor: ROBOT_COLORS[i % ROBOT_COLORS.length],
  }));
}

export function isRobotId(playerId: string): boolean {
  return /^robot-\d+$/.test(playerId);
}

// ------------------------------------------------------------------------------------------
// Clearing rows, as an animation.
//
// A cleared row is eaten away over CLEAR_EAT_MS, and only then does the stack above drop into
// the gap - falling the way a dropped thing actually falls, accelerating rather than sliding
// at a constant rate.  The timings are anchored on a four-row drop taking CLEAR_FALL_MS: from
// d = at^2/2, a shorter fall takes proportionally less time, which is why a single row lands
// in half the time of four rather than a quarter of it.
//
// The presenter owns the clock (it owns everything), and sends the durations once rather than
// streaming a frame at a time - each screen then animates locally off its own clock.
// ------------------------------------------------------------------------------------------
export const CLEAR_EAT_MS = 300;
export const CLEAR_FALL_MS = 300; // for a four-row drop
export const CLEAR_FALL_REFERENCE_ROWS = 4;

// How long a drop of `rows` takes, under the same acceleration that puts four rows at
// CLEAR_FALL_MS.  d = at^2/2  =>  t = sqrt(2d/a)  =>  t scales with sqrt(d).
export function clearFallMs(rows: number): number {
  if (rows <= 0) return 0;
  return CLEAR_FALL_MS * Math.sqrt(rows / CLEAR_FALL_REFERENCE_ROWS);
}

// Where a falling block is at time t, as a fraction of its total drop.  Accelerating from a
// standstill, so the fraction is t^2 - slow to start, quickest as it lands.
export function fallProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1;
  const t = Math.max(0, Math.min(1, elapsedMs / durationMs));
  return t * t;
}

// How far each row of the grid falls once `clearedRows` are taken out: one row for every
// cleared row below it.  Indexed by the row's ORIGINAL position.
export function rowDropAmounts(clearedRows: number[]): number[] {
  const cleared = new Set(clearedRows);
  const drops: number[] = new Array(BOARD_HEIGHT).fill(0);
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    if (cleared.has(y)) continue;
    let below = 0;
    for (const row of clearedRows) if (row > y) below++;
    drops[y] = below;
  }
  return drops;
}

// How far the block now sitting at each FINAL row had to fall.  Indexed by the
// row's position AFTER the collapse, which is what a renderer actually has -
// it is drawing the collapsed grid and needs to know how far to lift each row
// back up.  Rows that came from above the clear, and rows that never moved,
// are 0.
export function finalRowDrops(clearedRows: number[]): number[] {
  const cleared = new Set(clearedRows);
  const kept: number[] = [];
  for (let y = 0; y < BOARD_HEIGHT; y++) if (!cleared.has(y)) kept.push(y);
  const drops: number[] = new Array(BOARD_HEIGHT).fill(0);
  // The kept rows land at the bottom, in order; the gap is refilled on top
  const firstFinal = BOARD_HEIGHT - kept.length;
  kept.forEach((originalRow, i) => {
    drops[firstFinal + i] = firstFinal + i - originalRow;
  });
  return drops;
}

// The furthest any row has to fall - what sets the length of the animation
export function maxRowDrop(clearedRows: number[]): number {
  const drops = rowDropAmounts(clearedRows);
  return drops.reduce((most, drop) => Math.max(most, drop), 0);
}

// Take the named rows out and drop everything above them down.  Deliberately removes the
// rows we PROMISED to remove rather than re-testing for full rows: an attack landing during
// the animation may well have filled one in, and the player was already told it was going.
export function collapseRows(grid: number[][], clearedRows: number[]): number[][] {
  const cleared = new Set(clearedRows);
  const kept = grid.filter((_, y) => !cleared.has(y));
  const added = Array.from({ length: BOARD_HEIGHT - kept.length }, () =>
    Array(BOARD_WIDTH).fill(EMPTY_CELL),
  );
  return [...added, ...kept];
}

// A row being eaten away, left to right.  Returns how many cells are still there.
export function cellsLeftInEatenRow(elapsedMs: number, eatMs: number): number {
  if (eatMs <= 0) return 0;
  const gone = Math.floor((Math.max(0, elapsedMs) / eatMs) * BOARD_WIDTH);
  return Math.max(0, BOARD_WIDTH - gone);
}

// Stamp a piece into the grid without clearing anything.  Used when a clear is
// about to be animated: the rows have to stay put while they are eaten.
export function lockOnly(grid: number[][], piece: EittrisPiece): number[][] {
  const locked = grid.map((row) => row.slice());
  const color = pieceColorIndex(piece);
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      locked[c.y][c.x] = color;
    }
  }
  return locked;
}

// ------------------------------------------------------------------------------------------
// Host settings - what the host picks on the gathering screen before starting.
//
// Kept as plain data so the whole lot serializes with the presenter and survives a refresh
// mid-setup, and so the rules can be unit-tested without a presenter at all.
// ------------------------------------------------------------------------------------------
export const MAX_STARTING_ANTIDOTES = ANTIDOTE_MAX;

/** How brisk the game is.  Slow is the tuned default; the others scale gravity up. */
export type EittrisSpeed = "slow" | "medium" | "fast";

// Speed is a multiplier on how fast pieces fall AND on how quickly that builds.  Interval
// is the reciprocal of speed, so double speed is half the interval.
export const SPEED_MULTIPLIERS: Record<EittrisSpeed, number> = {
  slow: 1,
  medium: 2,
  fast: 3,
};

export const SPEED_CHOICES: EittrisSpeed[] = ["slow", "medium", "fast"];

/** The gravity interval a board starts at, for a given speed. */
export function startIntervalFor(speed: EittrisSpeed): number {
  return Math.max(MIN_INTERVAL_MS, START_INTERVAL_MS / (SPEED_MULTIPLIERS[speed] ?? 1));
}

export interface EittrisSettings {
  startingAntidotes: number;
  // How fast the game plays.  Slow is the default because pieces used to land faster
  // than people could think about them; medium and fast are for rooms that want it.
  speed: EittrisSpeed;
  // What clearing four rows at once wins you.  The original always fired a
  // Bridge; the host can now pick anything that is switched on.
  fourRowAward: SpecialType;
  // Which specials may appear at all.  Anything left out never rolls.
  allowedSpecials: SpecialType[];
}

// The pool a host gets before touching anything.  Everything EXCEPT the antidote: it is the
// one powerup that does nothing to anybody else, so a random one is a turn where nothing
// happens, and now that every powerup is equally likely those turns are no longer rare.
// Players still start with an antidote in hand, and it is still the four-row award and one
// tick box away - it just does not litter the board unasked.
export const DEFAULT_ALLOWED_SPECIALS: SpecialType[] = IMPLEMENTED_SPECIALS.filter(
  (type) => type !== SpecialType.Antidote,
);

export function defaultSettings(): EittrisSettings {
  return {
    startingAntidotes: ANTIDOTES_AT_START,
    speed: "slow",
    fourRowAward: SpecialType.Antidote,
    allowedSpecials: DEFAULT_ALLOWED_SPECIALS.slice(),
  };
}

// Fold whatever the host chose into something the game can actually run.  A
// host who unticks everything gets antidotes rather than a game where clearing
// rows does nothing at all - an empty pool would otherwise deadlock every roll.
export function sanitizeSettings(settings: Partial<EittrisSettings> | null): EittrisSettings {
  const base = defaultSettings();
  if (!settings) return base;
  const allowed = (settings.allowedSpecials ?? base.allowedSpecials).filter((type) =>
    IMPLEMENTED_SPECIALS.includes(type),
  );
  const startingAntidotes = Math.max(
    0,
    Math.min(
      MAX_STARTING_ANTIDOTES,
      Math.floor(settings.startingAntidotes ?? base.startingAntidotes),
    ),
  );
  const award = settings.fourRowAward ?? base.fourRowAward;
  const speed = settings.speed ?? base.speed;
  return {
    startingAntidotes: Number.isFinite(startingAntidotes)
      ? startingAntidotes
      : base.startingAntidotes,
    speed: SPEED_CHOICES.includes(speed) ? speed : base.speed,
    // The award has to be something that can actually appear
    fourRowAward: IMPLEMENTED_SPECIALS.includes(award) ? award : base.fourRowAward,
    allowedSpecials: allowed.length > 0 ? allowed : [SpecialType.Antidote],
  };
}

// Roll a special from the allowed pool - every one that is switched on, equally likely.
//
// The antidote used to take half of all rolls before the others drew for the rest, which is
// where the original got its feel.  It also made the host's tick boxes misleading: switching
// something on bought it a share of the leftovers, so the same box was worth a lot or a
// little depending on how many others were ticked.  A flat pool is what the checklist looks
// like it means.
export function rollAllowedSpecial(rand: () => number, allowed: SpecialType[]): SpecialType {
  const pool = allowed.length > 0 ? allowed : [SpecialType.Antidote];
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

// ------------------------------------------------------------------------------------------
// Laying the host's boards out.
//
// One row across the screen only works up to a handful of players - past that the boards run
// off the edge, which is exactly what the 20-robot stress test turns up.  So instead of
// assuming a row, try every column count and keep whichever gives the BIGGEST cells: with a
// few players that is still one wide row, and with twenty it is a grid.
//
// Pure arithmetic, so the choice can be checked without a browser.
// ------------------------------------------------------------------------------------------

// What a panel costs on top of its grid.  Measured from the real thing rather
// than guessed: the horizontal cost is fixed (padding + border), but the
// VERTICAL cost is not - the player's avatar in the label scales with the cell
// size, so a bigger board also carries a taller header.
export const PANEL_H_CHROME = 34;
export const PANEL_V_BASE = 57; // padding, border, name line, rows line
export const PANEL_AVATAR_MIN = 18; // the avatar never shrinks below this
export const BOARD_MIN_CELL_PX = 3;
export const BOARD_MAX_CELL_PX = 24;

// Total height of a panel drawn at this cell size
export function panelHeightFor(cellPx: number): number {
  return cellPx * BOARD_HEIGHT + PANEL_V_BASE + Math.max(PANEL_AVATAR_MIN, cellPx * 2);
}

export function panelWidthFor(cellPx: number): number {
  return cellPx * BOARD_WIDTH + PANEL_H_CHROME;
}

export interface BoardLayout {
  columns: number;
  rows: number;
  cellPx: number;
}

export function planBoardLayout(
  count: number,
  availableWidth: number,
  availableHeight: number,
  gap = 10,
): BoardLayout {
  if (count <= 0) return { columns: 1, rows: 1, cellPx: BOARD_MAX_CELL_PX };

  let best: BoardLayout = { columns: count, rows: 1, cellPx: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    // Space one panel may occupy, once the gaps between them are taken out
    const panelWidth = (availableWidth - gap * (columns - 1)) / columns;
    const panelHeight = (availableHeight - gap * (rows - 1)) / rows;
    // Scan down for the biggest cell that genuinely fits.  Solving for it
    // directly is awkward because the header's height depends on the cell
    // size, and the range is 22 integers - so just try them.
    for (let cellPx = BOARD_MAX_CELL_PX; cellPx >= BOARD_MIN_CELL_PX; cellPx--) {
      if (panelWidthFor(cellPx) > panelWidth) continue;
      if (panelHeightFor(cellPx) > panelHeight) continue;
      if (cellPx > best.cellPx) best = { columns, rows, cellPx };
      break;
    }
  }

  // Nothing fit at any column count - draw them as small as allowed rather
  // than not at all, in as square an arrangement as we can manage.
  if (best.cellPx === 0) {
    const columns = Math.ceil(Math.sqrt(count));
    return { columns, rows: Math.ceil(count / columns), cellPx: BOARD_MIN_CELL_PX };
  }
  return best;
}
