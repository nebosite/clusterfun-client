// ==========================================================================================
// PURE, framework-free game rules.  No MobX, no session, no DOM - just data in, data out.
//
// Put as much of your game's decision-making here as possible (scoring rules, board math,
// win conditions, turn ordering).  Pure functions are trivially unit-testable (see
// templateLogic.spec.ts) and keep the presenter/client models thin: the models hold
// observable state and delegate every rule decision to functions in this file.
// This mirrors PartyPix's partyPixLogic.ts and RetroSpectro's groupNaming.ts.
// ==========================================================================================

// The bouncing ball shown on each client screen while a round plays.
// Coordinates and velocity are in unit space (0..1) so they are resolution-independent.
export interface BallState {
  x: number;
  y: number;
  xm: number;
  ym: number;
  color: string;
}

// ------------------------------------------------------------------------------------------
// Advance the ball one frame, bouncing off the walls of the unit square.
// Returns a new state; does not mutate the input.
// ------------------------------------------------------------------------------------------
export function stepBall(ball: BallState): BallState {
  let { x, y, xm, ym } = ball;
  x += xm;
  if (x > 1.0) {
    x = 1.0;
    xm *= -1;
  }
  if (x < 0.0) {
    x = 0.0;
    xm *= -1;
  }
  y += ym;
  if (y > 1.0) {
    y = 1.0;
    ym *= -1;
  }
  if (y < 0.0) {
    y = 0.0;
    ym *= -1;
  }
  return { ...ball, x, y, xm, ym };
}

// ------------------------------------------------------------------------------------------
// Pick the winning player(s) - the highest total score, with ties allowed.
// Works on a minimal shape so it needs no knowledge of the player class.
// ------------------------------------------------------------------------------------------
export function findWinners<T extends { totalScore: number }>(players: T[]): T[] {
  if (players.length === 0) return [];
  const best = Math.max(...players.map((p) => p.totalScore));
  return players.filter((p) => p.totalScore === best);
}
