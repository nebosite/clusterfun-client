import {
  animationPathForMove,
  BotAttitude,
  botPickGuess,
  BUST_LIMIT,
  computeRevealDurationMs,
  maxPiecesPerHuman,
  MAX_GUESS,
  MIN_GUESS,
  randomGuess,
  resolveRound,
  totalPieceCount,
  WIN_POSITION,
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
    expect(move(moves, "a")).toMatchObject({ newPosition: WIN_POSITION, won: true });
  });

  it("does NOT win on passing 101 (overshoot into the danger zone)", () => {
    const moves = resolveRound([{ pieceId: "a", position: 99, guess: 8 }]);
    expect(move(moves, "a")).toMatchObject({ newPosition: 107, won: false, busted: false });
  });

  it("wins when a collision knocks a piece back onto exactly 101", () => {
    const moves = resolveRound([
      { pieceId: "a", position: 103, guess: 4 },
      { pieceId: "b", position: 50, guess: 4 },
    ]);
    expect(move(moves, "a")).toMatchObject({ newPosition: WIN_POSITION, won: true });
  });

  it("busts to 0 when moving past 111", () => {
    const moves = resolveRound([{ pieceId: "a", position: BUST_LIMIT - 3, guess: 4 }]);
    expect(move(moves, "a")).toMatchObject({ newPosition: 0, busted: true, won: false });
  });

  it("allows landing exactly on 111 without busting", () => {
    const moves = resolveRound([{ pieceId: "a", position: BUST_LIMIT - 4, guess: 4 }]);
    expect(move(moves, "a")).toMatchObject({ newPosition: BUST_LIMIT, busted: false });
  });

  it("supports simultaneous winners", () => {
    const moves = resolveRound([
      { pieceId: "a", position: 95, guess: 6 },
      { pieceId: "b", position: 94, guess: 7 },
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
  const baseMove = { pieceId: "a", collidedCount: 0, busted: false, won: false };

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
    // old position 109, guess 6 -> bust (109+6 = 115 > 111)
    const path = animationPathForMove({
      ...baseMove,
      guess: 6,
      delta: -109,
      newPosition: 0,
      busted: true,
    });
    expect(path).toEqual([110, 111, 0]);
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
      },
      {
        pieceId: "b",
        guess: 5,
        delta: 0,
        newPosition: 0,
        collidedCount: 2,
        busted: false,
        won: false,
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
      },
      {
        pieceId: "b",
        guess: 4,
        delta: -2,
        newPosition: 18,
        collidedCount: 2,
        busted: false,
        won: false,
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
