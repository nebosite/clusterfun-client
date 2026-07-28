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
// Garbage painted into a board by an attack.  Not a playable piece type -
// it just occupies cells and renders in its own color.
export const GARBAGE_CELL = 7;
// TowerOfEit lays its own darker stone (the original forces DarkGray)
export const TOWER_CELL = 8;

// Specials: a settled block gets tagged every 8s, but only ever ONE at a
// time - it stays put until the player clears its row, and nothing new
// appears until then.  Half of all rolls are antidotes, you may bank 4, and
// a fired antidote shields/cures for 10s.  Players start with one.
export const SPECIAL_INTERVAL_MS = 8000;
export const ANTIDOTE_CHANCE = 0.5;
export const ANTIDOTE_MAX = 4;
export const ANTIDOTE_DURATION_MS = 10000;
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

// The EvilPieces table - verbatim from the original.  Z-heavy, and the last
// three are five-cell pentominoes that no normal Tetris throws at you.
const EVIL_PIECE_DEFS = [
  "R|0,-1|0,0|-1,-1|1,0", // Z
  "R|0,-1|0,0|1,-1|-1,0", // reverse Z
  "C|0,0|1,0|0,1|1,1", // O
  "C|1,-1|1,0|0,1|0,2", // hyper Z
  "C|0,-1|0,0|1,1|1,2", // reverse hyper Z
  "R|-1,-1|-1,0|-1,1|0,1|1,1", // big L (5 cells)
  "R|1,-1|1,0|1,1|0,1|-1,1", // reverse big L (5 cells)
  "R|0,-1|0,0|-1,1|0,1|1,1", // big T (5 cells)
];

export const EVIL_PIECE_COUNT = EVIL_PIECE_DEFS.length;

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

export interface Cell {
  x: number;
  y: number;
}

interface PieceDef {
  centerType: "R" | "C";
  offsets: Cell[];
}

function parseDefs(defs: string[]): PieceDef[] {
  return defs.map((def) => {
    const parts = def.split("|");
    return {
      centerType: parts[0] as "R" | "C",
      offsets: parts.slice(1).map((p) => {
        const [x, y] = p.split(",").map(Number);
        return { x, y };
      }),
    };
  });
}

const evilParsedDefs: PieceDef[] = parseDefs(EVIL_PIECE_DEFS);

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

// The falling piece: type index, clockwise rotation count 0-3, and board
// position.  `evil` selects the EvilPieces table instead of the normal one.
export interface EittrisPiece {
  type: number;
  rot: number;
  x: number;
  y: number;
  evil?: boolean;
}

// Evil pieces borrow the normal colors, so a settled cell is always a
// single digit and the grid encoding stays 210 characters
export function pieceColorIndex(piece: EittrisPiece): number {
  return piece.evil ? piece.type % PIECE_COUNT : piece.type;
}

// One clockwise rotation of a single offset
function rotateOffsetCW(centerType: "R" | "C", cell: Cell): Cell {
  return centerType === "R" ? { x: -cell.y, y: cell.x } : { x: -cell.y + 1, y: cell.x };
}

// The four absolute board cells a piece occupies
export function pieceCells(piece: EittrisPiece): Cell[] {
  const table = piece.evil ? evilParsedDefs : parsedDefs;
  const def = table[piece.type % table.length];
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

// Everything an antidote washes off
export function cureAfflictions(board: EittrisBoard): void {
  board.speedupStacks = 0;
  board.evilPieces = false;
  board.crazyIvan = false;
  board.freezeDried = false;
  board.transparency = false;
}

// Does this board have anything an antidote would cure?
export function hasAfflictions(board: EittrisBoard): boolean {
  return (
    board.speedupStacks > 0 ||
    board.evilPieces ||
    board.crazyIvan ||
    board.freezeDried ||
    board.transparency
  );
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

export function spawnPiece(type: number, rotations: number, evil = false): EittrisPiece {
  return { type, rot: ((rotations % 4) + 4) % 4, x: SPAWN_X, y: SPAWN_Y, evil };
}

// Pull the next piece off the queue (refilling it) and spawn it with a random rotation
export function spawnNextFromQueue(
  nextQueue: number[],
  rand: () => number,
  evil = false,
): { piece: EittrisPiece; queue: number[] } {
  const pick = () =>
    evil
      ? Math.min(EVIL_PIECE_COUNT - 1, Math.floor(rand() * EVIL_PIECE_COUNT))
      : randomPieceType(rand);
  const queue = nextQueue.slice();
  while (queue.length < NEXT_PREVIEW_COUNT) queue.push(pick());
  const type = queue.shift()!;
  queue.push(pick());
  return { piece: spawnPiece(type, Math.floor(rand() * 4), evil), queue };
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
  // Afflictions laid on this board by other players' specials.  Kept apart
  // from intervalMs (the natural gravity curve) so an antidote can wipe them.
  speedupStacks: number;
  // SlowDown is a self-buff, so an antidote does NOT wash it off
  slowdownStacks: number;
  // SeeShadows: the landing ghost, on for the rest of the round once earned
  seeShadows: boolean;
  // EvilPieces: this board draws from the nastier table until cured
  evilPieces: boolean;
  // CrazyIvan: left/right and rotation are inverted until cured
  crazyIvan: boolean;
  // FreezeDried: settled blocks shrivel to jittered specks until cured
  freezeDried: boolean;
  // Transparency: the settled stack is invisible until cured
  transparency: boolean;
  shieldMs: number; // remaining antidote shield/cure time (0 = inactive)
  forcedSpecial: SpecialType | null; // dev selector: only ever spawn this
  // DEV: hand this board to the computer player
  aiControlled: boolean;
  aiTimerMs: number; // countdown to the bot's next move
  // A Bridge painting itself across the top of this board
  pendingBridge: PendingBridge | null;
  // An attack stencil currently painting itself into this board
  pendingStencil: PendingStencil | null;
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
    speedupStacks: 0,
    slowdownStacks: 0,
    seeShadows: false,
    evilPieces: false,
    crazyIvan: false,
    freezeDried: false,
    transparency: false,
    shieldMs: 0,
    forcedSpecial: null,
    aiControlled: false,
    aiTimerMs: 0,
    pendingStencil: null,
    pendingBridge: null,
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
function withPieceSettled(grid: number[][], piece: EittrisPiece): number[][] {
  const next = grid.map((row) => row.slice());
  for (const c of pieceCells(piece)) {
    if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
      next[c.y][c.x] = piece.type;
    }
  }
  return next;
}

// Weights for the placement score.  Tuned so "don't make holes" dominates,
// then "sit low", then "hug what's already there".
export const AI_GAP_PENALTY = 40;
export const AI_DEPTH_WEIGHT = 2;
export const AI_CONTACT_WEIGHT = 3;

export function scorePlacement(grid: number[][], landed: EittrisPiece): number {
  const settled = withPieceSettled(grid, landed);
  const newGaps = countCoveredGaps(settled) - countCoveredGaps(grid);
  const lowest = Math.max(...pieceCells(landed).map((c) => c.y));
  return (
    -AI_GAP_PENALTY * newGaps +
    AI_DEPTH_WEIGHT * lowest +
    AI_CONTACT_WEIGHT * contactCount(grid, landed)
  );
}

// Try every rotation at every reachable column and keep the best landing.
// Columns are only considered if the piece can actually slide there from its
// current position, since the AI moves one step at a time.
export function planPlacement(grid: number[][], piece: EittrisPiece): AiPlan | null {
  let best: AiPlan | null = null;
  for (let rot = 0; rot < 4; rot++) {
    const rotated = { ...piece, rot: (piece.rot + rot) % 4 };
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const candidate = { ...rotated, x };
      if (collides(grid, pieceCells(candidate))) continue;
      const landed = dropDestination(grid, candidate);
      const score = scorePlacement(grid, landed);
      if (!best || score > best.score) {
        best = { rot: candidate.rot, x, score };
      }
    }
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
