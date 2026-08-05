import {
  animationPathForMove,
  BotAttitude,
  botPickGuess,
  BUST_LIMIT_DEFAULT,
  computeRevealDurationMs,
  maxPiecesPerHuman,
  MAX_GUESS,
  MIN_GUESS,
  randomGuess,
  resolveRound,
  totalPieceCount,
  WIN_POSITION,
  bustLimitFor,
  MIN_WIN_POSITION,
  TARGET_OPTIONS,
  sanitizeWinPosition,
} from "./oneOhOneLogic";

const move = (moves: ReturnType<typeof resolveRound>, id: string) => {
  const found = moves.find((m) => m.pieceId === id);
  if (!found) throw new Error(`no move for ${id}`);
  return found;
};

describe("resolveRound", () => {
  it("moves a unique guesser forward by the guess", () => {
    const moves = resolveRound([
      { pieceId: "a", position: 10, guess: 7 },
      { pieceId: "b", position: 20, guess: 3 },
    ]);
    expect(move(moves, "a")).toMatchObject({ delta: 7, newPosition: 17, collidedCount: 0 });
    expect(move(moves, "b")).toMatchObject({ delta: 3, newPosition: 23, collidedCount: 0 });
  });

  it("moves all colliding pieces backward by the collision count", () => {
    const moves = resolveRound([
      { pieceId: "a", position: 10, guess: 5 },
      { pieceId: "b", position: 20, guess: 5 },
      { pieceId: "c", position: 30, guess: 5 },
      { pieceId: "d", position: 40, guess: 9 },
    ]);
    expect(move(moves, "a")).toMatchObject({ delta: -3, newPosition: 7, collidedCount: 3 });
    expect(move(moves, "b")).toMatchObject({ delta: -3, newPosition: 17, collidedCount: 3 });
    expect(move(moves, "c")).toMatchObject({ delta: -3, newPosition: 27, collidedCount: 3 });
    expect(move(moves, "d")).toMatchObject({ delta: 9, newPosition: 49, collidedCount: 0 });
  });

  it("floors backward moves at position 0", () => {
    const moves = resolveRound([
      { pieceId: "a", position: 1, guess: 4 },
      { pieceId: "b", position: 50, guess: 4 },
    ]);
    expect(move(moves, "a")).toMatchObject({ newPosition: 0, delta: -1 });
  });

  it("declares a win on landing exactly on 101", () => {
    const moves = resolveRound([{ pieceId: "a", position: WIN_POSITION - 6, guess: 6 }]);
    expect(move(moves, "a")).toMatchObject({
      newPosition: WIN_POSITION,
      won: true,
      bonus: 0,
      potShare: 0,
    });
  });

  it("does NOT win on passing the target (overshoot into the danger zone)", () => {
    const moves = resolveRound([{ pieceId: "a", position: WIN_POSITION - 2, guess: 8 }]);
    expect(move(moves, "a")).toMatchObject({
      newPosition: WIN_POSITION + 6,
      won: false,
      busted: false,
    });
  });

  it("wins when a collision knocks a piece back onto exactly 101", () => {
    const moves = resolveRound([
      { pieceId: "a", position: WIN_POSITION + 2, guess: 4 },
      { pieceId: "b", position: 10, guess: 4 },
    ]);
    expect(move(moves, "a")).toMatchObject({
      newPosition: WIN_POSITION,
      won: true,
      bonus: 0,
      potShare: 0,
    });
  });

  it("busts to 0 when moving past 111", () => {
    const moves = resolveRound([{ pieceId: "a", position: BUST_LIMIT_DEFAULT - 3, guess: 4 }]);
    expect(move(moves, "a")).toMatchObject({
      newPosition: 0,
      busted: true,
      won: false,
      bonus: 0,
      potShare: 0,
    });
  });

  it("allows landing exactly on 111 without busting", () => {
    const moves = resolveRound([{ pieceId: "a", position: BUST_LIMIT_DEFAULT - 4, guess: 4 }]);
    expect(move(moves, "a")).toMatchObject({ newPosition: BUST_LIMIT_DEFAULT, busted: false });
  });

  it("supports simultaneous winners", () => {
    const moves = resolveRound([
      { pieceId: "a", position: WIN_POSITION - 6, guess: 6 },
      { pieceId: "b", position: WIN_POSITION - 7, guess: 7 },
    ]);
    expect(moves.filter((m) => m.won).length).toBe(2);
  });
});

describe("botPickGuess", () => {
  const attitudes = [BotAttitude.Aggressive, BotAttitude.Moderate, BotAttitude.Cautious];

  it("always returns a legal guess for every attitude across the rand range", () => {
    for (const attitude of attitudes) {
      for (let r = 0; r < 1; r += 0.01) {
        const guess = botPickGuess(attitude, () => r);
        expect(guess).toBeGreaterThanOrEqual(MIN_GUESS);
        expect(guess).toBeLessThanOrEqual(MAX_GUESS);
      }
    }
  });

  it("skews aggressive bots high and cautious bots low", () => {
    const average = (attitude: BotAttitude) => {
      let total = 0;
      const samples = 1000;
      for (let i = 0; i < samples; i++) {
        total += botPickGuess(attitude, () => (i + 0.5) / samples);
      }
      return total / samples;
    };
    const aggressive = average(BotAttitude.Aggressive);
    const moderate = average(BotAttitude.Moderate);
    const cautious = average(BotAttitude.Cautious);
    expect(aggressive).toBeGreaterThan(moderate);
    expect(moderate).toBeGreaterThan(cautious);
    expect(aggressive).toBeGreaterThan(7);
    expect(cautious).toBeLessThan(4);
  });
});

describe("randomGuess", () => {
  it("covers the full 1..10 range", () => {
    expect(randomGuess(() => 0)).toBe(MIN_GUESS);
    expect(randomGuess(() => 0.999)).toBe(MAX_GUESS);
  });
});

describe("animationPathForMove", () => {
  const baseMove = {
    pieceId: "a",
    collidedCount: 0,
    busted: false,
    won: false,
    bonus: 0,
    potShare: 0,
  };

  it("steps forward one position at a time", () => {
    const path = animationPathForMove({ ...baseMove, guess: 4, delta: 4, newPosition: 14 });
    expect(path).toEqual([11, 12, 13, 14]);
  });

  it("steps backward for collisions", () => {
    const path = animationPathForMove({
      ...baseMove,
      guess: 5,
      delta: -3,
      newPosition: 7,
      collidedCount: 3,
    });
    expect(path).toEqual([9, 8, 7]);
  });

  it("runs to the track edge then snaps to 0 on a bust", () => {
    // Two short of the edge, guessing 6: it runs to the edge and drops off.
    const edge = BUST_LIMIT_DEFAULT;
    const path = animationPathForMove({
      ...baseMove,
      guess: 6,
      delta: -(edge - 2),
      newPosition: 0,
      busted: true,
    });
    expect(path).toEqual([edge - 1, edge, 0]);
  });

  it("stops at THIS game's edge, not a hardcoded one", () => {
    // The bug: the edge was fixed at 111 whatever the target, so on a short track the
    // animation walked a piece off the end of the board before snapping it back.
    const path = animationPathForMove(
      { ...baseMove, guess: 6, delta: -19, newPosition: 0, busted: true },
      21,
    );
    expect(path).toEqual([20, 21, 0]);
  });

  it("is empty for a zero-delta move (collision at position 0)", () => {
    const path = animationPathForMove({
      ...baseMove,
      guess: 5,
      delta: 0,
      newPosition: 0,
      collidedCount: 2,
    });
    expect(path).toEqual([]);
  });
});

describe("computeRevealDurationMs", () => {
  it("charges per step and per active piece plus a buffer", () => {
    const moves = [
      {
        pieceId: "a",
        guess: 3,
        delta: 3,
        newPosition: 3,
        collidedCount: 0,
        busted: false,
        won: false,
        bonus: 0,
        potShare: 0,
      },
      {
        pieceId: "b",
        guess: 5,
        delta: 0,
        newPosition: 0,
        collidedCount: 2,
        busted: false,
        won: false,
        bonus: 0,
        potShare: 0,
      },
    ];
    // piece a: 3 steps; piece b: inactive
    expect(computeRevealDurationMs(moves, 100, 400, 1500)).toBe(3 * 100 + 1 * 400 + 1500);
  });

  it("adds a crash-pause per animated collision", () => {
    const moves = [
      {
        pieceId: "a",
        guess: 4,
        delta: -2,
        newPosition: 8,
        collidedCount: 2,
        busted: false,
        won: false,
        bonus: 0,
        potShare: 0,
      },
      {
        pieceId: "b",
        guess: 4,
        delta: -2,
        newPosition: 18,
        collidedCount: 2,
        busted: false,
        won: false,
        bonus: 0,
        potShare: 0,
      },
    ];
    // 2 pieces x 2 steps + 2 gaps + 2 collision pauses + buffer
    expect(computeRevealDurationMs(moves, 100, 400, 1500, 300)).toBe(
      4 * 100 + 2 * 400 + 2 * 300 + 1500,
    );
  });
});

describe("piece allotment", () => {
  it("limits pieces per human by the 16-piece board", () => {
    expect(maxPiecesPerHuman(4, 0)).toBe(4);
    expect(maxPiecesPerHuman(4, 4)).toBe(3);
    expect(maxPiecesPerHuman(16, 0)).toBe(1);
    expect(maxPiecesPerHuman(1, 15)).toBe(1);
    expect(maxPiecesPerHuman(1, 16)).toBe(0);
  });

  it("computes total board occupancy", () => {
    expect(totalPieceCount(3, 2, 4)).toBe(10);
  });
});

describe("oneOhOneLogic - a host-chosen target", () => {
  it("defaults to the game's namesake", () => {
    expect(sanitizeWinPosition(undefined)).toBe(WIN_POSITION);
    expect(WIN_POSITION).toBe(41);
  });

  it("snaps whatever it is given to one of the offered targets", () => {
    // The slider is gone: the host picks from a short list, so anything else - a stale
    // checkpoint, a hand-edited setting - has to land on a real option rather than between
    // two of them.
    for (const option of TARGET_OPTIONS) expect(sanitizeWinPosition(option)).toBe(option);
    expect(sanitizeWinPosition(5)).toBe(MIN_WIN_POSITION);
    expect(sanitizeWinPosition(500)).toBe(TARGET_OPTIONS[TARGET_OPTIONS.length - 1]);
    expect(sanitizeWinPosition(NaN)).toBe(WIN_POSITION);
    expect(sanitizeWinPosition(101)).toBe(51); // the old namesake target, snapped
    expect(sanitizeWinPosition(36)).toBe(31); // exactly between two options: takes the first
  });

  it("keeps the overshoot risk one full guess past the target, whatever it is", () => {
    expect(bustLimitFor(41)).toBe(BUST_LIMIT_DEFAULT);
    expect(bustLimitFor(11)).toBe(21);
    expect(bustLimitFor(21, 13)).toBe(34); // and it follows the field-sized range
  });

  it("wins on the chosen target, not on 101", () => {
    const moves = resolveRound([{ pieceId: "a", position: 25, guess: 5 }], 30);
    expect(move(moves, "a")).toMatchObject({ newPosition: 30, won: true, bonus: 0, potShare: 0 });
  });

  it("does not win by reaching 101 when the target is shorter", () => {
    const moves = resolveRound([{ pieceId: "a", position: 96, guess: 5 }], 30);
    expect(move(moves, "a")!.won).toBe(false);
  });

  it("busts one guess past the chosen target", () => {
    // Target 30 means the track runs to 40; 41 is over the edge
    const safe = resolveRound([{ pieceId: "a", position: 35, guess: 5 }], 30);
    expect(move(safe, "a")).toMatchObject({ newPosition: 40, busted: false });
    const bust = resolveRound([{ pieceId: "a", position: 36, guess: 5 }], 30);
    expect(move(bust, "a")).toMatchObject({ newPosition: 0, busted: true });
  });
});
