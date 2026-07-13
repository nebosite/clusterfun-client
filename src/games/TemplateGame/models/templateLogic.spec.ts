import { BallState, findWinners, stepBall } from "./templateLogic";

// Unit tests for the pure game rules.  Every rule in templateLogic.ts should have
// coverage here - this suite runs in the deploy pipeline, so a broken rule blocks
// a bad deploy instead of surfacing as a broken game mid-party.

describe("stepBall", () => {
  const makeBall = (overrides: Partial<BallState> = {}): BallState => ({
    x: 0.5,
    y: 0.5,
    xm: 0.01,
    ym: 0.01,
    color: "#ffffff",
    ...overrides,
  });

  it("advances position by velocity", () => {
    const next = stepBall(makeBall());
    expect(next.x).toBeCloseTo(0.51);
    expect(next.y).toBeCloseTo(0.51);
  });

  it("does not mutate the input state", () => {
    const ball = makeBall();
    stepBall(ball);
    expect(ball.x).toBe(0.5);
    expect(ball.y).toBe(0.5);
  });

  it("bounces off the right wall", () => {
    const next = stepBall(makeBall({ x: 0.995, xm: 0.01 }));
    expect(next.x).toBe(1.0);
    expect(next.xm).toBe(-0.01);
  });

  it("bounces off the left wall", () => {
    const next = stepBall(makeBall({ x: 0.005, xm: -0.01 }));
    expect(next.x).toBe(0.0);
    expect(next.xm).toBe(0.01);
  });

  it("bounces off the bottom wall", () => {
    const next = stepBall(makeBall({ y: 0.995, ym: 0.01 }));
    expect(next.y).toBe(1.0);
    expect(next.ym).toBe(-0.01);
  });

  it("bounces off the top wall", () => {
    const next = stepBall(makeBall({ y: 0.005, ym: -0.01 }));
    expect(next.y).toBe(0.0);
    expect(next.ym).toBe(0.01);
  });

  it("preserves the color", () => {
    expect(stepBall(makeBall({ color: "red" })).color).toBe("red");
  });
});

describe("findWinners", () => {
  it("returns an empty list for no players", () => {
    expect(findWinners([])).toEqual([]);
  });

  it("finds the single highest scorer", () => {
    const players = [
      { name: "a", totalScore: 1 },
      { name: "b", totalScore: 5 },
      { name: "c", totalScore: 3 },
    ];
    expect(findWinners(players).map((p) => p.name)).toEqual(["b"]);
  });

  it("returns all tied winners", () => {
    const players = [
      { name: "a", totalScore: 5 },
      { name: "b", totalScore: 5 },
      { name: "c", totalScore: 3 },
    ];
    expect(findWinners(players).map((p) => p.name)).toEqual(["a", "b"]);
  });
});
