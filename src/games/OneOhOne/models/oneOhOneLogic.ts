// ==========================================================================================
// PURE game rules for 101.  No MobX, no session, no DOM - data in, data out.
// This is the file to edit when tuning game mechanics; see DESIGN.md for the
// reasoning behind each rule and oneOhOneLogic.spec.ts for the rule coverage.
// ==========================================================================================

export const MIN_GUESS = 1;
export const MAX_GUESS = 10;
export const WIN_POSITION = 101;
export const BUST_LIMIT = 111; // moving past this resets the piece to 0
export const MAX_PIECES = 16;

export enum BotAttitude {
  Aggressive = "Aggressive",
  Moderate = "Moderate",
  Cautious = "Cautious",
}

// One piece on the track.  ownerId is the controlling player's id, or null for
// a bot (in which case attitude is set).  Kept as a plain object so the
// checkpoint serializer needs no special type registration.
export interface GamePiece {
  pieceId: string;
  name: string;
  avatarId: number;
  avatarColor: number;
  ownerId: string | null;
  attitude: BotAttitude | null;
  position: number;
  guess: number | null;
  confirmed: boolean; // this round's pick is locked in
  lastMove: PieceMove | null;
}

// One piece's submitted pick for a round
export interface RoundEntry {
  pieceId: string;
  position: number;
  guess: number;
}

// What happened to one piece when the round resolved
export interface PieceMove {
  pieceId: string;
  guess: number;
  delta: number; // + forward, - backward (post-clamp actual movement)
  newPosition: number;
  collidedCount: number; // 0 = unique guess; k>=2 = k pieces picked this number
  busted: boolean; // went past BUST_LIMIT and reset to 0
  won: boolean; // landed exactly on WIN_POSITION
}

// ------------------------------------------------------------------------------------------
// resolveRound - apply the core rules to every piece's pick:
//   unique guess          -> forward by the guess
//   k>=2 pieces same guess -> each moves back by k (floored at 0)
//   land exactly on 101   -> win (from either direction)
//   move past 111         -> bust: reset to 0
// ------------------------------------------------------------------------------------------
export function resolveRound(entries: RoundEntry[]): PieceMove[] {
  const pickCounts = new Map<number, number>();
  for (const e of entries) {
    pickCounts.set(e.guess, (pickCounts.get(e.guess) ?? 0) + 1);
  }

  return entries.map((e) => {
    const count = pickCounts.get(e.guess)!;
    let newPosition: number;
    let busted = false;

    if (count === 1) {
      newPosition = e.position + e.guess;
      if (newPosition > BUST_LIMIT) {
        newPosition = 0;
        busted = true;
      }
    } else {
      newPosition = Math.max(0, e.position - count);
    }

    return {
      pieceId: e.pieceId,
      guess: e.guess,
      delta: newPosition - e.position,
      newPosition,
      collidedCount: count === 1 ? 0 : count,
      busted,
      won: newPosition === WIN_POSITION,
    };
  });
}

// ------------------------------------------------------------------------------------------
// Bot guessing.  Each attitude is a weight table over guesses 1..10; bots pick
// randomly from it with no strategy (see DESIGN.md).  `rand` is a 0..1 source
// (inject Math.random or a fixed value in tests).
// ------------------------------------------------------------------------------------------
const ATTITUDE_WEIGHTS: Record<BotAttitude, number[]> = {
  //                      guess:  1   2   3   4   5   6   7   8   9  10
  [BotAttitude.Aggressive]: /**/ [1, 1, 1, 2, 2, 3, 6, 8, 8, 8],
  [BotAttitude.Moderate]: /*  */ [1, 2, 4, 6, 6, 6, 6, 4, 2, 1],
  [BotAttitude.Cautious]: /*  */ [8, 8, 8, 6, 3, 2, 2, 1, 1, 1],
};

export function botPickGuess(attitude: BotAttitude, rand: () => number): number {
  const weights = ATTITUDE_WEIGHTS[attitude];
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + MIN_GUESS;
  }
  return MAX_GUESS;
}

// A random legal guess - used for humans who missed the round timer
export function randomGuess(rand: () => number): number {
  return MIN_GUESS + Math.floor(rand() * (MAX_GUESS - MIN_GUESS + 1));
}

// ------------------------------------------------------------------------------------------
// Reveal animation support.  The presenter animates one piece at a time, one
// step per position, so both the step path and the total reveal duration are
// derived from the round's moves here (pure and testable).
// ------------------------------------------------------------------------------------------

// The sequence of positions to display while animating a move, in order.
// Forward moves count up; collisions count down; busts run forward to the
// track edge and then snap to 0.
export function animationPathForMove(move: PieceMove): number[] {
  const path: number[] = [];
  if (move.busted) {
    // delta for a bust is (0 - oldPosition)
    const oldPosition = -move.delta;
    const edge = Math.min(oldPosition + move.guess, BUST_LIMIT);
    for (let p = oldPosition + 1; p <= edge; p++) path.push(p);
    path.push(0);
    return path;
  }
  const oldPosition = move.newPosition - move.delta;
  if (move.delta > 0) {
    for (let p = oldPosition + 1; p <= move.newPosition; p++) path.push(p);
  } else if (move.delta < 0) {
    for (let p = oldPosition - 1; p >= move.newPosition; p--) path.push(p);
  }
  return path;
}

// Total reveal time needed to animate all moves sequentially.
// collisionPauseMs covers the crash-sound beat played before each
// backward slide.
export function computeRevealDurationMs(
  moves: PieceMove[],
  stepMs: number,
  pieceGapMs: number,
  bufferMs: number,
  collisionPauseMs: number = 0,
): number {
  let steps = 0;
  let activePieces = 0;
  let collisions = 0;
  for (const move of moves) {
    const length = animationPathForMove(move).length;
    if (length > 0) {
      steps += length;
      activePieces++;
      if (move.collidedCount > 0) collisions++;
    }
  }
  return steps * stepMs + activePieces * pieceGapMs + collisions * collisionPauseMs + bufferMs;
}

// ------------------------------------------------------------------------------------------
// Piece allotment - every human controls the same number of pieces, and the
// board holds at most MAX_PIECES including bots.
// ------------------------------------------------------------------------------------------
export function maxPiecesPerHuman(humanCount: number, botCount: number): number {
  if (humanCount === 0) return 0;
  return Math.max(0, Math.floor((MAX_PIECES - botCount) / humanCount));
}

export function totalPieceCount(
  humanCount: number,
  piecesPerHuman: number,
  botCount: number,
): number {
  return humanCount * piecesPerHuman + botCount;
}
