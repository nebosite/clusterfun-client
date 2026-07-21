import {
  shuffle,
  pairContestants,
  selectPrompts,
  matchupWinners,
  scoreForEntry,
  findWinners,
} from "./faceOffLogic";

// Unit tests for the pure game rules. These run in the deploy pipeline, so a broken rule
// blocks a bad deploy instead of surfacing as a broken game mid-party.

describe("shuffle", () => {
  it("does not mutate the input", () => {
    const input = [1, 2, 3, 4];
    shuffle(input, () => 0.5);
    expect(input).toEqual([1, 2, 3, 4]);
  });

  it("is a permutation of the input (no loss, no dupes)", () => {
    const input = ["a", "b", "c", "d", "e"];
    const out = shuffle(input, mulberry32(42));
    expect(out.slice().sort()).toEqual(input.slice().sort());
  });

  it("is deterministic for a fixed random source", () => {
    const input = [1, 2, 3, 4, 5];
    expect(shuffle(input, mulberry32(7))).toEqual(shuffle(input, mulberry32(7)));
  });

  it("tolerates a random source that returns exactly 1", () => {
    const input = [1, 2, 3];
    const out = shuffle(input, () => 1);
    expect(out.slice().sort()).toEqual([1, 2, 3]);
  });
});

describe("pairContestants", () => {
  it("returns no matchups for fewer than 2 contestants", () => {
    expect(pairContestants([])).toEqual([]);
    expect(pairContestants(["a"])).toEqual([]);
  });

  it("pairs an even count into groups of 2", () => {
    expect(pairContestants(["a", "b", "c", "d"])).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("makes the final group a 3-way when the count is odd", () => {
    expect(pairContestants(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    expect(pairContestants(["a", "b", "c", "d", "e"])).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
  });

  it("covers every contestant exactly once", () => {
    for (let n = 2; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const flat = pairContestants(ids).flat();
      expect(flat.slice().sort()).toEqual(ids.slice().sort());
    }
  });

  it("yields at least 2 matchups once there are 4+ contestants", () => {
    for (let n = 4; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      expect(pairContestants(ids).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("selectPrompts", () => {
  const pool = ["p1", "p2", "p3", "p4", "p5"];

  it("prefers unused prompts and records them as used", () => {
    const { chosen, nextUsed } = selectPrompts(pool, ["p1"], 2);
    expect(chosen).toEqual(["p2", "p3"]);
    expect(nextUsed).toEqual(["p1", "p2", "p3"]);
  });

  it("returns distinct prompts within a single selection", () => {
    const { chosen } = selectPrompts(pool, [], 3);
    expect(new Set(chosen).size).toBe(3);
  });

  it("resets history and cycles when unused prompts run out", () => {
    // 4 of 5 used, ask for 3 -> only p5 is unused, so history resets and it refills.
    const used = ["p1", "p2", "p3", "p4"];
    const { chosen, nextUsed } = selectPrompts(pool, used, 3);
    expect(chosen.length).toBe(3);
    expect(new Set(chosen).size).toBe(3);
    expect(chosen[0]).toBe("p5"); // the one unused prompt is picked first
    expect(nextUsed).toEqual(chosen); // history restarts from this selection
  });
});

describe("matchupWinners", () => {
  it("returns the single highest-voted entry", () => {
    expect(
      matchupWinners([
        { entryId: "a", votes: 3 },
        { entryId: "b", votes: 1 },
      ]),
    ).toEqual(["a"]);
  });

  it("returns all tied entries", () => {
    expect(
      matchupWinners([
        { entryId: "a", votes: 2 },
        { entryId: "b", votes: 2 },
        { entryId: "c", votes: 0 },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("has no winner when nobody voted", () => {
    expect(
      matchupWinners([
        { entryId: "a", votes: 0 },
        { entryId: "b", votes: 0 },
      ]),
    ).toEqual([]);
  });
});

describe("scoreForEntry", () => {
  it("scores votes plus a win bonus for the winner", () => {
    expect(scoreForEntry(3, true, 100, 200)).toBe(500);
  });

  it("scores votes only for a non-winner", () => {
    expect(scoreForEntry(3, false, 100, 200)).toBe(300);
  });

  it("is zero for a no-show with no votes and no win", () => {
    expect(scoreForEntry(0, false, 100, 200)).toBe(0);
  });
});

describe("findWinners", () => {
  it("returns an empty list for no players", () => {
    expect(findWinners([])).toEqual([]);
  });

  it("finds the single highest scorer", () => {
    const players = [
      { name: "a", score: 100 },
      { name: "b", score: 500 },
      { name: "c", score: 300 },
    ];
    expect(findWinners(players).map((p) => p.name)).toEqual(["b"]);
  });

  it("returns all tied winners", () => {
    const players = [
      { name: "a", score: 500 },
      { name: "b", score: 500 },
      { name: "c", score: 300 },
    ];
    expect(findWinners(players).map((p) => p.name)).toEqual(["a", "b"]);
  });
});

// A tiny seeded PRNG so shuffle tests are deterministic without depending on Math.random.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
