import {
  clampStartSec,
  sanitizeRanking,
  runInstantRunoff,
  findWinnersByScore,
  hasReachedTarget,
  shuffled,
  Ballot,
} from "./mixtapeLogic";

// Unit tests for the pure game rules.  Every rule in mixtapeLogic.ts has coverage here -
// this suite runs in the deploy pipeline, so a broken rule blocks a bad deploy instead of
// surfacing as a broken game mid-party.  The IRV tally is the highest-value target.

describe("clampStartSec", () => {
  it("keeps a valid offset unchanged", () => {
    expect(clampStartSec(40, 180)).toBe(40);
  });
  it("floors negatives to 0", () => {
    expect(clampStartSec(-5, 180)).toBe(0);
  });
  it("keeps the 30s window inside a known duration", () => {
    expect(clampStartSec(200, 180)).toBe(150); // 180 - 30
  });
  it("only guards negatives when duration is unknown (0)", () => {
    expect(clampStartSec(9999, 0)).toBe(9999);
    expect(clampStartSec(-1, 0)).toBe(0);
  });
  it("clamps to 0 for very short tracks", () => {
    expect(clampStartSec(10, 20)).toBe(0);
  });
});

describe("sanitizeRanking", () => {
  const valid = ["a", "b", "c", "d"];
  it("keeps order and drops unknown ids", () => {
    expect(sanitizeRanking(["b", "z", "a"], valid)).toEqual(["b", "a"]);
  });
  it("drops the voter's own song", () => {
    expect(sanitizeRanking(["a", "b", "c"], valid, "b")).toEqual(["a", "c"]);
  });
  it("dedupes while preserving first position", () => {
    expect(sanitizeRanking(["a", "a", "b"], valid)).toEqual(["a", "b"]);
  });
  it("caps at the max ballot length", () => {
    expect(sanitizeRanking(["a", "b", "c", "d"], valid, null, 3)).toEqual(["a", "b", "c"]);
  });
  it("returns empty for an all-invalid ballot", () => {
    expect(sanitizeRanking(["z", "y"], valid)).toEqual([]);
    expect(sanitizeRanking(undefined as any, valid)).toEqual([]);
  });
});

describe("runInstantRunoff", () => {
  const order = ["a", "b", "c", "d"];
  const b = (voterId: string, ...ranking: string[]): Ballot => ({ voterId, ranking });

  it("returns no winner when there are no ballots", () => {
    const out = runInstantRunoff(["a", "b"], [], order);
    expect(out.winners).toEqual([]);
  });

  it("wins in round one on a first-choice majority", () => {
    const out = runInstantRunoff(["a", "b", "c"], [b("1", "a"), b("2", "a"), b("3", "b")], order);
    expect(out.winners).toEqual(["a"]); // 2 of 3 first-choices
    expect(out.steps[out.steps.length - 1].eliminated).toEqual([]);
  });

  it("eliminates the lowest and transfers ballots to the next choice", () => {
    // First choices: a=2, b=2, c=1 -> eliminate c; c's ballot transfers to a -> a=3 wins.
    const ballots = [b("1", "a"), b("2", "a"), b("3", "b"), b("4", "b"), b("5", "c", "a")];
    const out = runInstantRunoff(["a", "b", "c"], ballots, order);
    expect(out.winners).toEqual(["a"]);
    // c was eliminated in the first step
    expect(out.steps[0].eliminated).toEqual(["c"]);
    expect(out.steps[0].counts).toEqual({ a: 2, b: 2, c: 1 });
  });

  it("counts a ballot as exhausted when all its choices are eliminated", () => {
    // a=2, b=2, c=1 with c's only choice being c -> eliminate c, its ballot exhausts,
    // then a vs b tie 2-2, tie-break keeps earlier-submitted 'a'.
    const ballots = [b("1", "a"), b("2", "a"), b("3", "b"), b("4", "b"), b("5", "c")];
    const out = runInstantRunoff(["a", "b", "c"], ballots, order);
    expect(out.winners).toEqual(["a"]);
    // After c is eliminated, its lone ballot exhausts: 4 active, 1 exhausted.
    const afterC = out.steps[1];
    expect(afterC.exhausted).toBe(1);
    expect(afterC.activeBallots).toBe(4);
  });

  it("breaks a final tie deterministically by submission order", () => {
    const ballots = [b("1", "a"), b("2", "b")]; // 1-1 forever
    const out = runInstantRunoff(["a", "b"], ballots, ["a", "b"]);
    expect(out.winners).toEqual(["a"]); // a submitted earlier
    const flipped = runInstantRunoff(["a", "b"], ballots, ["b", "a"]);
    expect(flipped.winners).toEqual(["b"]);
  });

  it("records which voters back each song and transfers them on elimination", () => {
    // a=2 (1,2), b=2 (3,4), c=1 (5 -> a).  c is eliminated, voter 5 transfers to a -> a wins.
    const ballots = [b("1", "a"), b("2", "a"), b("3", "b"), b("4", "b"), b("5", "c", "a")];
    const out = runInstantRunoff(["a", "b", "c"], ballots, order);
    expect(out.steps[0].support).toEqual({ a: ["1", "2"], b: ["3", "4"], c: ["5"] });
    const last = out.steps[out.steps.length - 1];
    expect(last.support.a).toEqual(["1", "2", "5"]); // voter 5 moved from c to a
    expect(last.support.c).toBeUndefined(); // c no longer standing
    // support tracks counts exactly at every step
    for (const step of out.steps) {
      for (const id of Object.keys(step.counts)) {
        expect(step.support[id].length).toBe(step.counts[id]);
      }
    }
  });

  it("is stable when replayed (deterministic steps)", () => {
    const ballots = [b("1", "a", "c"), b("2", "b", "c"), b("3", "c", "a"), b("4", "d", "b")];
    const first = runInstantRunoff(["a", "b", "c", "d"], ballots, order);
    const second = runInstantRunoff(["a", "b", "c", "d"], ballots, order);
    expect(second).toEqual(first);
    expect(first.winners.length).toBe(1);
  });
});

describe("findWinnersByScore", () => {
  it("returns an empty list for no players", () => {
    expect(findWinnersByScore([])).toEqual([]);
  });
  it("finds the single highest scorer", () => {
    const players = [
      { name: "a", score: 1 },
      { name: "b", score: 5 },
      { name: "c", score: 3 },
    ];
    expect(findWinnersByScore(players).map((p) => p.name)).toEqual(["b"]);
  });
  it("returns all tied winners", () => {
    const players = [
      { name: "a", score: 5 },
      { name: "b", score: 5 },
      { name: "c", score: 3 },
    ];
    expect(findWinnersByScore(players).map((p) => p.name)).toEqual(["a", "b"]);
  });
});

describe("hasReachedTarget", () => {
  it("is true once any player hits the target", () => {
    expect(hasReachedTarget([{ score: 4 }, { score: 5 }], 5)).toBe(true);
  });
  it("is false while everyone is short", () => {
    expect(hasReachedTarget([{ score: 4 }, { score: 3 }], 5)).toBe(false);
  });
});

describe("shuffled", () => {
  it("returns a permutation without mutating the input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input, () => 0.5);
    expect(out).not.toBe(input);
    expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
  it("is deterministic given a fixed random source", () => {
    const seq = [0.1, 0.9, 0.3, 0.7];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    i = 0;
    const a = shuffled([1, 2, 3, 4, 5], rand);
    i = 0;
    const b = shuffled([1, 2, 3, 4, 5], rand);
    expect(a).toEqual(b);
  });
});
