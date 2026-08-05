import {
  BotAttitude,
  DEFAULT_RULES,
  LAST_PLACE_BONUS_SPACES,
  MIN_GUESS,
  PieceMove,
  attitudeWeights,
  botPickGuess,
  endZoneStart,
  isInEndZone,
  maxGuessFor,
  piecesInLastPlace,
  randomGuess,
  resolveRoundWithRules,
} from "./oneOhOneLogic";

// ==========================================================================================
// The rules added on top of the original 101: a guess range that grows with the field, a
// shaded end zone, and two optional catch-up mechanics.
//
// 101 is a race in which a piece that falls behind has no way to gain on the field faster
// than anybody else, so a bad early round used to decide the game before it got interesting.
// Both catch-up rules exist to fix that, and both are the host's choice.
// ==========================================================================================

const at = (moves: PieceMove[], pieceId: string) => moves.find((m) => m.pieceId === pieceId)!;
const RULES = { ...DEFAULT_RULES, winPosition: 41, maxGuess: 10 };

describe("the guess range grows with the field", () => {
  it("is five wider than the number of pieces racing", () => {
    expect(maxGuessFor(1)).toBe(6);
    expect(maxGuessFor(4)).toBe(9);
    expect(maxGuessFor(16)).toBe(21);
  });

  it("never collapses to nothing on a silly field size", () => {
    expect(maxGuessFor(0)).toBe(6);
    expect(maxGuessFor(-3)).toBe(6);
  });

  it("keeps a collision from becoming unavoidable as the field grows", () => {
    // Two pieces picking uniformly from 1..N collide with probability 1/N. A fixed range of
    // ten made a sixteen-piece game one long pile-up; the point of scaling is that this
    // number does not run away.
    expect(1 / maxGuessFor(16)).toBeLessThan(1 / maxGuessFor(3));
  });
});

describe("bots across a range that is not ten wide", () => {
  const ATTITUDES = [BotAttitude.Aggressive, BotAttitude.Moderate, BotAttitude.Cautious];

  for (const attitude of ATTITUDES) {
    it(`${attitude} only ever picks a legal number`, () => {
      for (const maxGuess of [6, 10, 21]) {
        for (let i = 0; i < 200; i++) {
          const guess = botPickGuess(attitude, Math.random, maxGuess);
          expect(guess).toBeGreaterThanOrEqual(MIN_GUESS);
          expect(guess).toBeLessThanOrEqual(maxGuess);
        }
      }
    });

    it(`${attitude} has a positive weight for every number in the range`, () => {
      expect(attitudeWeights(attitude, 21).length).toBe(21);
      expect(attitudeWeights(attitude, 6).length).toBe(6);
      expect(attitudeWeights(attitude, 21).every((w) => w > 0)).toBe(true);
    });
  }

  it("keeps each attitude leaning the way its name says, at any width", () => {
    // The tables became curves so they could stretch. This is what must survive that.
    for (const maxGuess of [6, 10, 21]) {
      const half = Math.floor(maxGuess / 2);
      const low = (w: number[]) => w.slice(0, half).reduce((a, b) => a + b, 0);
      const high = (w: number[]) => w.slice(-half).reduce((a, b) => a + b, 0);

      const aggressive = attitudeWeights(BotAttitude.Aggressive, maxGuess);
      expect(high(aggressive)).toBeGreaterThan(low(aggressive));

      const cautious = attitudeWeights(BotAttitude.Cautious, maxGuess);
      expect(low(cautious)).toBeGreaterThan(high(cautious));

      const moderate = attitudeWeights(BotAttitude.Moderate, maxGuess);
      const middle = moderate[Math.floor(moderate.length / 2)];
      expect(middle).toBeGreaterThan(moderate[0]);
      expect(middle).toBeGreaterThan(moderate[moderate.length - 1]);
    }
  });

  it("gives a stranded human a legal random pick at any width", () => {
    expect(randomGuess(() => 0, 21)).toBe(MIN_GUESS);
    expect(randomGuess(() => 0.999, 21)).toBe(21);
    expect(randomGuess(() => 0.999, 6)).toBe(6);
  });
});

describe("the end zone", () => {
  it("is exactly one maximum move deep", () => {
    expect(endZoneStart(41, 10)).toBe(31);
    expect(endZoneStart(41, 21)).toBe(20);
  });

  it("never runs off the start of the track", () => {
    expect(endZoneStart(21, 30)).toBe(1);
  });

  it("holds every position that can reach the target and none that cannot", () => {
    for (let p = 0; p <= 41; p++) {
      expect(isInEndZone(p, 41, 10)).toBe(p + 10 >= 41 && p < 41);
    }
  });

  it("does not include the target itself - you are not approaching, you have arrived", () => {
    expect(isInEndZone(41, 41, 10)).toBe(false);
  });
});

describe("the last-place bonus", () => {
  it("adds its spaces to a lone straggler's forward move", () => {
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "back", position: 2, guess: 3 },
        { pieceId: "front", position: 20, guess: 4 },
      ],
      RULES,
    );
    expect(at(moves, "back")).toMatchObject({
      bonus: LAST_PLACE_BONUS_SPACES,
      newPosition: 2 + 3 + LAST_PLACE_BONUS_SPACES,
    });
    expect(at(moves, "front")).toMatchObject({ bonus: 0, newPosition: 24 });
  });

  it("still applies when the straggler collided", () => {
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "back", position: 10, guess: 4 },
        { pieceId: "front", position: 20, guess: 4 },
      ],
      RULES,
    );
    // Back two for the collision, forward five for being alone at the back.
    expect(at(moves, "back")).toMatchObject({ newPosition: 13, bonus: LAST_PLACE_BONUS_SPACES });
  });

  it("gives nothing when two pieces are tied at the back", () => {
    // The rule rescues somebody who is out of it on their own, not a whole back half.
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 3 },
        { pieceId: "b", position: 5, guess: 4 },
        { pieceId: "c", position: 20, guess: 6 },
      ],
      RULES,
    );
    expect(moves.every((m) => m.bonus === 0)).toBe(true);
  });

  it("gives nothing to a piece racing alone", () => {
    const { moves } = resolveRoundWithRules([{ pieceId: "a", position: 0, guess: 3 }], RULES);
    expect(at(moves, "a").bonus).toBe(0);
  });

  it("is off when the host turns it off", () => {
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "back", position: 2, guess: 3 },
        { pieceId: "front", position: 20, guess: 4 },
      ],
      { ...RULES, lastPlaceBonus: false },
    );
    expect(at(moves, "back").bonus).toBe(0);
  });

  it("can bust you, like any other way of moving too far", () => {
    // The edge is 51 here. 48 + 2 + 5 overshoots it.
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "back", position: 48, guess: 2 },
        { pieceId: "front", position: 50, guess: 3 },
      ],
      RULES,
    );
    expect(at(moves, "back")).toMatchObject({ busted: true, newPosition: 0 });
  });
});

describe("the collision pot", () => {
  const POT_RULES = { ...RULES, lastPlaceBonus: false, potEnabled: true };

  it("takes the collided NUMBER, once, however big the pile-up", () => {
    const { pot } = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 7 },
        { pieceId: "b", position: 6, guess: 7 },
        { pieceId: "c", position: 7, guess: 7 },
      ],
      POT_RULES,
    );
    expect(pot).toBe(7);
  });

  it("adds up across rounds", () => {
    const first = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 3 },
        { pieceId: "b", position: 6, guess: 3 },
      ],
      POT_RULES,
    );
    const second = resolveRoundWithRules(
      [
        { pieceId: "a", position: 2, guess: 4 },
        { pieceId: "b", position: 3, guess: 4 },
      ],
      POT_RULES,
      first.pot,
      first.potSpent,
    );
    expect(second.pot).toBe(7);
  });

  it("collects nothing when nobody collides", () => {
    const { pot } = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 3 },
        { pieceId: "b", position: 6, guess: 4 },
      ],
      POT_RULES,
    );
    expect(pot).toBe(0);
  });

  it("pays out when somebody first reaches the end zone, split between the stragglers", () => {
    const { moves, pot, potSpent, potPaidTo, potShare } = resolveRoundWithRules(
      [
        { pieceId: "leader", position: 28, guess: 6 }, // lands on 34, inside the zone (31+)
        { pieceId: "backA", position: 4, guess: 2 },
        { pieceId: "backB", position: 4, guess: 2 },
      ],
      POT_RULES,
      8,
    );
    // The two at the back collided on 2, which adds 2 to the carried-in 8.
    expect(potPaidTo.slice().sort()).toEqual(["backA", "backB"]);
    expect(potShare).toBe(5);
    expect(at(moves, "backA").potShare).toBe(5);
    expect(at(moves, "leader").potShare).toBe(0);
    expect(pot).toBe(0);
    expect(potSpent).toBe(true);
  });

  it("pays only once - after that, collisions stop feeding it", () => {
    const after = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 3 },
        { pieceId: "b", position: 6, guess: 3 },
      ],
      POT_RULES,
      0,
      true,
    );
    expect(after.pot).toBe(0);
    expect(after.potPaidTo).toEqual([]);
  });

  it("does not pay for somebody who was ALREADY in the end zone", () => {
    // "when someone ENTERS the end zone" - a leader camping there must not trigger it again
    // every round for the rest of the game.
    const { potPaidTo, pot } = resolveRoundWithRules(
      [
        { pieceId: "leader", position: 33, guess: 2 }, // 33 and 35 are both inside
        { pieceId: "back", position: 4, guess: 3 },
      ],
      POT_RULES,
      8,
    );
    expect(potPaidTo).toEqual([]);
    expect(pot).toBe(8);
  });

  it("does nothing at all when the host leaves it off", () => {
    const { pot, potPaidTo } = resolveRoundWithRules(
      [
        { pieceId: "a", position: 5, guess: 3 },
        { pieceId: "b", position: 6, guess: 3 },
      ],
      { ...POT_RULES, potEnabled: false },
    );
    expect(pot).toBe(0);
    expect(potPaidTo).toEqual([]);
  });

  it("reports a delta that accounts for every source of movement", () => {
    // delta has to stay "where it ended minus where it started", or the reveal animates the
    // wrong distance - and now there are three ways to move in one round.
    const started: Record<string, number> = { leader: 28, back: 4 };
    const { moves } = resolveRoundWithRules(
      [
        { pieceId: "leader", position: started.leader, guess: 6 },
        { pieceId: "back", position: started.back, guess: 2 },
      ],
      { ...POT_RULES, lastPlaceBonus: true },
      8,
    );
    for (const m of moves) {
      expect(m.newPosition - started[m.pieceId]).toBe(m.delta);
    }
  });
});

describe("piecesInLastPlace", () => {
  it("finds the single lowest", () => {
    expect(
      piecesInLastPlace([
        { pieceId: "a", position: 5 },
        { pieceId: "b", position: 2 },
      ]),
    ).toEqual(["b"]);
  });

  it("finds all of a tie", () => {
    expect(
      piecesInLastPlace([
        { pieceId: "a", position: 2 },
        { pieceId: "b", position: 2 },
        { pieceId: "c", position: 9 },
      ]).sort(),
    ).toEqual(["a", "b"]);
  });

  it("copes with nobody at all", () => {
    expect(piecesInLastPlace([])).toEqual([]);
  });
});
