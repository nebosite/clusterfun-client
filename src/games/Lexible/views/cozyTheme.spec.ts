import {
  FULL_STRENGTH_SCORE,
  MIN_STRENGTH_SCORE,
  MIN_TEAM_MIX,
  hexToRgb,
  mixWithWhite,
  teamColorForScore,
  teamMixForScore,
} from "./cozyTheme";

// A tile's score is how hard it is to take, and the colour is how that gets communicated
// across a room.  The first attempt scaled HSL saturation, which keeps the original
// lightness - a weak tile came out a muddy mid-grey that was hard to tell from a strong one
// at a distance.  Mixing towards WHITE makes "weak" read as "pale", which is obvious.

describe("teamMixForScore", () => {
  it("gives the minimum score the minimum share of team colour", () => {
    expect(teamMixForScore(MIN_STRENGTH_SCORE)).toBeCloseTo(MIN_TEAM_MIX, 6);
  });

  it("gives a strong tile the full team colour", () => {
    expect(teamMixForScore(FULL_STRENGTH_SCORE)).toBeCloseTo(1, 6);
  });

  it("does not go past full for an unusually long word", () => {
    expect(teamMixForScore(20)).toBeCloseTo(1, 6);
  });

  it("does not go below the minimum for a score under the floor", () => {
    expect(teamMixForScore(1)).toBeCloseTo(MIN_TEAM_MIX, 6);
    expect(teamMixForScore(0)).toBeCloseTo(MIN_TEAM_MIX, 6);
  });

  it("rises with every point in between", () => {
    for (let score = MIN_STRENGTH_SCORE; score < FULL_STRENGTH_SCORE; score++) {
      expect(teamMixForScore(score + 1)).toBeGreaterThan(teamMixForScore(score));
    }
  });
});

describe("mixWithWhite", () => {
  it("returns the colour itself at full strength", () => {
    expect(mixWithWhite("#E56B45", 1)).toBe("rgb(229, 107, 69)");
  });

  it("returns white at zero", () => {
    expect(mixWithWhite("#E56B45", 0)).toBe("rgb(255, 255, 255)");
  });

  it("lands between the two in the middle", () => {
    // Halfway from white to the colour on every channel.
    expect(mixWithWhite("#000000", 0.5)).toBe("rgb(128, 128, 128)");
  });

  it("clamps rather than overshooting", () => {
    expect(mixWithWhite("#E56B45", 5)).toBe(mixWithWhite("#E56B45", 1));
    expect(mixWithWhite("#E56B45", -5)).toBe(mixWithWhite("#E56B45", 0));
  });
});

describe("teamColorForScore", () => {
  it("is visibly paler for a weak tile than a strong one", () => {
    const weak = hexToRgb("#E56B45");
    const weakColor = teamColorForScore("A", MIN_STRENGTH_SCORE);
    const strongColor = teamColorForScore("A", FULL_STRENGTH_SCORE);
    expect(weakColor).not.toBe(strongColor);
    // A weak tile is much closer to white than the team colour is.
    const channels = weakColor.match(/\d+/g)!.map(Number);
    expect(channels[1]).toBeGreaterThan(weak.g + 80); // green channel washed out
  });

  it("leaves a neutral tile alone", () => {
    expect(teamColorForScore("_", 5)).toBe(teamColorForScore("_", 9));
  });
});
