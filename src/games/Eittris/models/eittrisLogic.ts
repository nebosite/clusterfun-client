// ==========================================================================================
// PURE game rules for EITtris.  No MobX, no session, no DOM - data in, data out.
// Shapes, rotation, collision, and the gravity curve are verbatim ports from the
// original C# eitrix (see DESIGN.md).  All rule changes happen here, with
// coverage in eittrisLogic.spec.ts; the models only orchestrate.
// ==========================================================================================

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 21; // row 0 at top; gravity is y++
export const SPAWN_X = 5;
export const SPAWN_Y = 0;
export const NEXT_PREVIEW_COUNT = 2; // phones show the next 2 pieces

export const START_INTERVAL_MS = 1000; // gravity starts at 1 row per second
export const MIN_INTERVAL_MS = 80; // sane floor for the gravity interval
export const EXP_DECAY_PER_SEC = 0.006; // interval *= exp(-0.006 * dt) above the knee
export const LINEAR_KNEE_MS = 500; // below this the decay goes linear
export const LINEAR_DECAY_MS_PER_SEC = 3; // interval -= 3ms per elapsed second

export const DROP_POINTS_PER_ROW = 10; // hard/soft dropped rows: +10 points per row

// Specials: a settled block gets tagged every 8s, but only ever ONE at a
// time - it stays put until the player clears its row, and nothing new
// appears until then.  Half of all rolls are antidotes, you may bank 4, and
// a fired antidote shields/cures for 10s.  Players start with one.
export const SPECIAL_INTERVAL_MS = 8000;
export const ANTIDOTE_CHANCE = 0.5;
export const ANTIDOTE_MAX = 4;
export const ANTIDOTE_DURATION_MS = 10000;
export const ANTIDOTES_AT_START = 1;
export const EMPTY_CELL = -1;

// ------------------------------------------------------------------------------------------
// Piece definitions - verbatim from the original C#.  Format "centerType|dx,dy|..."
// where R rotates about the origin (x,y)->(-y,x) clockwise and C rotates about a
// corner (x,y)->(-y+1,x) clockwise.  Type index doubles as the grid cell value.
// ------------------------------------------------------------------------------------------
const PIECE_DEFS = [
  "R|-1,0|0,0|1,0|0,-1", // 0: T
  "R|0,-1|0,0|0,1|0,2", // 1: I
  "R|0,-1|0,0|0,1|1,1", // 2: L
  "R|0,-1|0,0|0,1|-1,1", // 3: reverse L
  "R|0,-1|0,0|-1,-1|1,0", // 4: Z
  "R|0,-1|0,0|1,-1|-1,0", // 5: reverse Z
  "C|0,0|1,0|0,1|1,1", // 6: O
];

export const PIECE_COUNT = PIECE_DEFS.length;

// eitrix's own (deliberately non-standard) piece colors, indexed by type
export const PIECE_COLORS = [
  "#00FFFF", // T cyan
  "#FF0000", // I red
  "#00FF00", // L green
  "#FF00FF", // reverse L magenta
  "#FF8E00", // Z orange
  "#FFFF00", // reverse Z yellow
  "#0000FF", // O blue
];

export interface Cell {
  x: number;
  y: number;
}

interface PieceDef {
  centerType: "R" | "C";
  offsets: Cell[];
}

const parsedDefs: PieceDef[] = PIECE_DEFS.map((def) => {
  const parts = def.split("|");
  return {
    centerType: parts[0] as "R" | "C",
    offsets: parts.slice(1).map((p) => {
      const [x, y] = p.split(",").map(Number);
      return { x, y };
    }),
  };
});

// The falling piece: type index, clockwise rotation count 0-3, and board position
export interface EittrisPiece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

// One clockwise rotation of a single offset
function rotateOffsetCW(centerType: "R" | "C", cell: Cell): Cell {
  return centerType === "R" ? { x: -cell.y, y: cell.x } : { x: -cell.y + 1, y: cell.x };
}

// The four absolute board cells a piece occupies
export function pieceCells(piece: EittrisPiece): Cell[] {
  const def = parsedDefs[piece.type];
  return def.offsets.map((offset) => {
    let c = offset;
    for (let i = 0; i < ((piece.rot % 4) + 4) % 4; i++) {
      c = rotateOffsetCW(def.centerType, c);
    }
    return { x: piece.x + c.x, y: piece.y + c.y };
  });
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

export function tryRotateCW(grid: number[][], piece: EittrisPiece): EittrisPiece | null {
  const rotated = { ...piece, rot: (piece.rot + 1) % 4 };
  return collides(grid, pieceCells(rotated)) ? null : rotated;
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

// Drop to the floor; the caller locks it and awards DROP_POINTS_PER_ROW per row
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
// Score: n cleared rows -> n * n * 1000.
// ------------------------------------------------------------------------------------------
export function scoreForClear(clearedRows: number): number {
  return clearedRows * clearedRows * 1000;
}

export interface LockResult {
  grid: number[][];
  cleared: number;
  scoreGained: number;
  clearedRows: number[]; // row indices in the PRE-clear grid (specials need these)
}

export function lockAndClear(grid: number[][], piece: EittrisPiece): LockResult {
  const locked = grid.map((row) => row.slice());
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      locked[c.y][c.x] = piece.type;
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
    scoreGained: scoreForClear(clearedRows.length),
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
}

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
];

// Specials that actually DO something today.  Random rolls and the dev
// selector only ever produce these; the rest land in later increments.
export const IMPLEMENTED_SPECIALS: SpecialType[] = [SpecialType.Antidote];

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

// Pick a settled block to tag (never one that already carries a marker)
export function pickSpecialCell(
  grid: number[][],
  markers: SpecialMarker[],
  rand: () => number,
): number | null {
  const taken = new Set(markers.map((m) => m.index));
  const free = occupiedCellIndices(grid).filter((i) => !taken.has(i));
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

// eitrix rolls an Antidote half the time, otherwise any special
export function rollSpecialType(rand: () => number, antidoteChance: number): SpecialType {
  if (rand() < antidoteChance) return SpecialType.Antidote;
  const pool = IMPLEMENTED_SPECIALS;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
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
export function gravityStep(intervalMs: number, dtSeconds: number): number {
  let next: number;
  if (intervalMs < LINEAR_KNEE_MS) {
    next = intervalMs - LINEAR_DECAY_MS_PER_SEC * dtSeconds;
  } else {
    next = intervalMs * Math.exp(-EXP_DECAY_PER_SEC * dtSeconds);
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

export function spawnPiece(type: number, rotations: number): EittrisPiece {
  return { type, rot: ((rotations % 4) + 4) % 4, x: SPAWN_X, y: SPAWN_Y };
}

// Pull the next piece off the queue (refilling it) and spawn it with a random rotation
export function spawnNextFromQueue(
  nextQueue: number[],
  rand: () => number,
): { piece: EittrisPiece; queue: number[] } {
  const queue = nextQueue.slice();
  while (queue.length < NEXT_PREVIEW_COUNT) queue.push(randomPieceType(rand));
  const type = queue.shift()!;
  queue.push(randomPieceType(rand));
  return { piece: spawnPiece(type, Math.floor(rand() * 4)), queue };
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
  score: number;
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
  // Milliseconds left in the post-lock gap before the next piece appears
  // (0 = not waiting).  While piece is null and this is counting down, the
  // board accepts no input at all.
  spawnDelayMs: number;
  // Specials sitting on settled blocks, waiting to be cleared for
  specials: SpecialMarker[];
  specialTimerMs: number; // countdown to tagging the next block
  antidotes: number; // stored antidote charges (max ANTIDOTE_MAX)
  shieldMs: number; // remaining antidote shield/cure time (0 = inactive)
  forcedSpecial: SpecialType | null; // dev selector: only ever spawn this
}

export function makeBoard(playerId: string, rand: () => number): EittrisBoard {
  const spawned = spawnNextFromQueue([], rand);
  return {
    playerId,
    grid: emptyGrid(),
    piece: spawned.piece,
    nextQueue: spawned.queue,
    score: 0,
    rows: 0,
    alive: true,
    intervalMs: START_INTERVAL_MS,
    dropTimerMs: 0,
    deathOrder: 0,
    backgroundIndex: Math.min(BACKGROUND_COUNT - 1, Math.floor(rand() * BACKGROUND_COUNT)),
    targetId: null,
    pieceSeq: 1,
    spawnDelayMs: 0,
    specials: [],
    specialTimerMs: SPECIAL_INTERVAL_MS,
    antidotes: ANTIDOTES_AT_START,
    shieldMs: 0,
    forcedSpecial: null,
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
// 1-bit board thumbnails - one bit per cell (settled OR current-piece cell),
// 210 bits packed MSB-first into 27 bytes, base64'd to a 36-char string.
// Broadcast to every phone for the target list.
// ------------------------------------------------------------------------------------------
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeThumbnail(grid: number[][], piece: EittrisPiece | null): string {
  const bytes = new Uint8Array(27); // 216 bits; the last 6 stay zero
  const setBit = (index: number) => {
    bytes[index >> 3] |= 0x80 >> (index & 7);
  };
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    for (let x = 0; x < BOARD_WIDTH; x++) {
      if (grid[y][x] !== EMPTY_CELL) setBit(y * BOARD_WIDTH + x);
    }
  }
  if (piece) {
    for (const c of pieceCells(piece)) {
      if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
        setBit(c.y * BOARD_WIDTH + c.x);
      }
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

// Rank for game end: survivors first (by score), then the dead - died later is
// better, score breaks ties (see DESIGN.md "Game over").
export function rankBoards(boards: EittrisBoard[]): EittrisBoard[] {
  return boards.slice().sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.score - a.score;
    if (a.deathOrder !== b.deathOrder) return b.deathOrder - a.deathOrder;
    return b.score - a.score;
  });
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
