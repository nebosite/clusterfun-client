// ==========================================================================================
// PURE game rules for 101.  No MobX, no session, no DOM - data in, data out.
// This is the file to edit when tuning game mechanics; see DESIGN.md for the
// reasoning behind each rule and oneOhOneLogic.spec.ts for the rule coverage.
// ==========================================================================================

export const MIN_GUESS = 1;

// ------------------------------------------------------------------------------------------
// How many numbers there are to hide among.
//
// The range used to be a fixed 1-10 whatever the field size, which made the game two
// different games: with three pieces a collision was bad luck, and with sixteen it was
// almost unavoidable and nobody could move forward at all.  Scaling the range with the field
// keeps the chance of an accidental collision roughly constant.
//
// N = 5 + however many pieces are racing.  Pieces, not people: a player with four pieces is
// four things picking numbers, and it is the pickers that collide.
// ------------------------------------------------------------------------------------------
export const GUESS_RANGE_BASE = 5;

export function maxGuessFor(pieceCount: number): number {
  return GUESS_RANGE_BASE + Math.max(1, Math.floor(pieceCount || 0));
}

/** The old fixed ceiling. Kept as the value a caller gets with no field size to hand. */
export const MAX_GUESS = 10;

/** The default track's edge. Real games derive theirs with `bustLimitFor`. */
export const BUST_LIMIT_DEFAULT = 41 + MAX_GUESS;

/** The targets a host may pick, and the one they get by default. */
export const TARGET_OPTIONS = [21, 31, 41, 51];
export const WIN_POSITION = 41;
export const MIN_WIN_POSITION = TARGET_OPTIONS[0];

// The track always runs one maximum guess past the target, so overshooting is a real
// risk right up to the finish however long the host makes the game.
export function bustLimitFor(winPosition: number, maxGuess: number = MAX_GUESS): number {
  return winPosition + maxGuess;
}

/**
 * The stretch of track from which the target can be reached in a single move.  Shaded on the
 * course, because "am I close enough to win this round" is the only question that matters
 * once the race is on, and counting squares from across a room is not a game mechanic.
 */
export function endZoneStart(winPosition: number, maxGuess: number = MAX_GUESS): number {
  return Math.max(1, winPosition - maxGuess);
}

export function isInEndZone(
  position: number,
  winPosition: number,
  maxGuess: number = MAX_GUESS,
): boolean {
  return position >= endZoneStart(winPosition, maxGuess) && position < winPosition;
}

/** Snap a host-chosen target to one of the offered options. */
export function sanitizeWinPosition(value: number | undefined | null): number {
  const n = Math.round(Number(value));
  if (!isFinite(n)) return WIN_POSITION;
  let best = TARGET_OPTIONS[0];
  for (const option of TARGET_OPTIONS) {
    if (Math.abs(option - n) < Math.abs(best - n)) best = option;
  }
  return best;
}
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
  busted: boolean; // went past the bust limit and reset to 0
  won: boolean; // landed exactly on the target
  /** Free spaces for being alone in last place. Already included in `delta`. */
  bonus: number;
  /** Share of the pot paid out this round. Already included in `delta`. */
  potShare: number;
}

// ------------------------------------------------------------------------------------------
// Everything a round needs beyond the picks themselves.
//
// The two optional mechanics are both CATCH-UP rules: 101 is a race where a piece that falls
// behind has no way to gain on the field faster than anybody else, so a bad early round used
// to decide the game before it was interesting.
// ------------------------------------------------------------------------------------------
export interface RoundRules {
  winPosition: number;
  maxGuess: number;
  /** A piece alone in last place gets a free move. */
  lastPlaceBonus: boolean;
  /** Collisions feed a pot, paid to the stragglers when the leader closes in. */
  potEnabled: boolean;
}

export const LAST_PLACE_BONUS_SPACES = 5;

export const DEFAULT_RULES: RoundRules = {
  winPosition: WIN_POSITION,
  maxGuess: MAX_GUESS,
  lastPlaceBonus: true,
  potEnabled: false,
};

export interface RoundOutcome {
  moves: PieceMove[];
  /** The pot after this round. Zero once it has been paid out. */
  pot: number;
  /** True once the pot has been paid; it never accumulates again. */
  potSpent: boolean;
  /** Pieces that split the pot this round, and what each of them got. */
  potPaidTo: string[];
  potShare: number;
}

/** The pieces sharing the lowest position. One name for a rule used three times. */
export function piecesInLastPlace(entries: { pieceId: string; position: number }[]): string[] {
  if (!entries.length) return [];
  const lowest = Math.min(...entries.map((e) => e.position));
  return entries.filter((e) => e.position === lowest).map((e) => e.pieceId);
}

// ------------------------------------------------------------------------------------------
// resolveRound - apply the core rules to every piece's pick:
//   unique guess          -> forward by the guess
//   k>=2 pieces same guess -> each moves back by k (floored at 0)
//   land exactly on 101   -> win (from either direction)
//   move past 111         -> bust: reset to 0
// ------------------------------------------------------------------------------------------
export function resolveRound(
  entries: RoundEntry[],
  winPosition: number = WIN_POSITION,
): PieceMove[] {
  return resolveRoundWithRules(entries, { ...DEFAULT_RULES, winPosition, lastPlaceBonus: false })
    .moves;
}

// ------------------------------------------------------------------------------------------
// resolveRoundWithRules - the whole round, including the optional catch-up mechanics.
//
// The order is fixed, and it is also the order the reveal animates in:
//
//   1. COLLISIONS - everyone who picked a number somebody else picked slides back k. Judged
//      against the standings the players were looking at when they picked.
//   2. FORWARD - every unique pick advances.
//   3. LAST PLACE - a piece alone at the back gets its free spaces. Decided on the positions
//      at the START of the round, because a bonus you could not have predicted is a surprise
//      rather than a mechanic.
//   4. THE POT, last of all.
//
// Bust is checked ONCE, against the total move: a bonus that carries you past the edge busts
// you exactly like a guess that does.
// ------------------------------------------------------------------------------------------
export function resolveRoundWithRules(
  entries: RoundEntry[],
  rules: RoundRules,
  potBefore: number = 0,
  potAlreadySpent: boolean = false,
): RoundOutcome {
  const bustLimit = bustLimitFor(rules.winPosition, rules.maxGuess);
  const pickCounts = new Map<number, number>();
  for (const e of entries) {
    pickCounts.set(e.guess, (pickCounts.get(e.guess) ?? 0) + 1);
  }

  // A LONE straggler, decided before anybody moves. Two pieces tied at the back get nothing:
  // the rule is there to rescue somebody who is out of it on their own.
  const lastPlace = piecesInLastPlace(entries);
  const bonusPiece =
    rules.lastPlaceBonus && lastPlace.length === 1 && entries.length > 1 ? lastPlace[0] : null;

  // Every number somebody collided on feeds the pot ONCE, whatever the size of the pile-up.
  let pot = potBefore;
  if (rules.potEnabled && !potAlreadySpent) {
    pickCounts.forEach((count, guess) => {
      if (count > 1) pot += guess;
    });
  }

  const moves: PieceMove[] = entries.map((e) => {
    const count = pickCounts.get(e.guess)!;
    const bonus = e.pieceId === bonusPiece ? LAST_PLACE_BONUS_SPACES : 0;
    let newPosition: number;
    let busted = false;

    if (count === 1) {
      newPosition = e.position + e.guess + bonus;
      if (newPosition > bustLimit) {
        newPosition = 0;
        busted = true;
      }
    } else {
      // A collision still costs you, and it is still SHOWN even at zero, where there is
      // nowhere left to slide back to - see the reveal.
      newPosition = Math.max(0, e.position - count + bonus);
    }

    return {
      pieceId: e.pieceId,
      guess: e.guess,
      delta: newPosition - e.position,
      newPosition,
      collidedCount: count === 1 ? 0 : count,
      busted,
      won: newPosition === rules.winPosition,
      bonus,
      potShare: 0,
    };
  });

  // ----------------------------------------------------------------------------------------
  // The pot pays out the moment somebody first reaches striking distance of the target, split
  // evenly between everyone at the back - one last shove before the race is decided. Paid
  // ONCE per game; after that, collisions stop feeding it.
  // ----------------------------------------------------------------------------------------
  let potPaidTo: string[] = [];
  let potShare = 0;
  let potSpent = potAlreadySpent;

  const someoneArrived = moves.some(
    (m) =>
      !m.busted &&
      isInEndZone(m.newPosition, rules.winPosition, rules.maxGuess) &&
      !isInEndZone(m.newPosition - m.delta, rules.winPosition, rules.maxGuess),
  );

  if (rules.potEnabled && !potSpent && pot > 0 && someoneArrived) {
    potPaidTo = piecesInLastPlace(
      moves.map((m) => ({ pieceId: m.pieceId, position: m.newPosition })),
    );
    potShare = Math.floor(pot / Math.max(1, potPaidTo.length));
    if (potShare > 0) {
      for (const m of moves) {
        if (!potPaidTo.includes(m.pieceId)) continue;
        const startedAt = m.newPosition - m.delta;
        m.potShare = potShare;
        const moved = m.newPosition + potShare;
        if (moved > bustLimit) {
          m.newPosition = 0;
          m.busted = true;
        } else {
          m.newPosition = moved;
        }
        m.delta = m.newPosition - startedAt;
        m.won = m.newPosition === rules.winPosition;
      }
    }
    pot = 0;
    potSpent = true;
  }

  return { moves, pot, potSpent, potPaidTo, potShare };
}

// ------------------------------------------------------------------------------------------
// Bot guessing.  Each attitude is a weight table over guesses 1..10; bots pick
// randomly from it with no strategy (see DESIGN.md).  `rand` is a 0..1 source
// (inject Math.random or a fixed value in tests).
// ------------------------------------------------------------------------------------------
// The curves are functions of how far up the range a guess sits, not fixed tables, because
// the range is no longer fixed: it grows with the field (see maxGuessFor). A table of ten
// numbers cannot describe a bot's taste across a range of six or of twenty-one.
const ATTITUDE_SHAPE: Record<BotAttitude, (t: number) => number> = {
  // t is 0 at the smallest guess and 1 at the largest.
  [BotAttitude.Aggressive]: (t) => 1 + 7 * t * t, // piles onto the big numbers
  [BotAttitude.Moderate]: (t) => 1 + 7 * (1 - Math.abs(2 * t - 1)), // a hump in the middle
  [BotAttitude.Cautious]: (t) => 1 + 7 * (1 - t) * (1 - t), // hugs the small, safe numbers
};

/** The weight this attitude puts on each guess from 1 to maxGuess. */
export function attitudeWeights(attitude: BotAttitude, maxGuess: number = MAX_GUESS): number[] {
  const span = Math.max(1, maxGuess - MIN_GUESS);
  const shape = ATTITUDE_SHAPE[attitude];
  const weights: number[] = [];
  for (let g = MIN_GUESS; g <= maxGuess; g++) weights.push(shape((g - MIN_GUESS) / span));
  return weights;
}

export function botPickGuess(
  attitude: BotAttitude,
  rand: () => number,
  maxGuess: number = MAX_GUESS,
): number {
  const weights = attitudeWeights(attitude, maxGuess);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + MIN_GUESS;
  }
  return maxGuess;
}

// A random legal guess - used for humans who missed the round timer
export function randomGuess(rand: () => number, maxGuess: number = MAX_GUESS): number {
  return MIN_GUESS + Math.floor(rand() * (maxGuess - MIN_GUESS + 1));
}

// ------------------------------------------------------------------------------------------
// Reveal animation support.  The presenter animates one piece at a time, one
// step per position, so both the step path and the total reveal duration are
// derived from the round's moves here (pure and testable).
// ------------------------------------------------------------------------------------------

// The sequence of positions to display while animating a move, in order.
// Forward moves count up; collisions count down; busts run forward to the
// track edge and then snap to 0.
export function animationPathForMove(
  move: PieceMove,
  bustLimit: number = BUST_LIMIT_DEFAULT,
): number[] {
  const path: number[] = [];
  if (move.busted) {
    // delta for a bust is (0 - oldPosition)
    const oldPosition = -move.delta;
    // Clamped to the REAL edge of this game's track, which is the target plus one maximum
    // guess - not a hardcoded 111. With a short target the animation used to run off the
    // end of the board.
    const edge = Math.min(oldPosition + move.guess + move.bonus + move.potShare, bustLimit);
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
