import { PieceMove, computePhasedRevealMs } from "./oneOhOneLogic";

// ==========================================================================================
// The reveal happens in three beats - picks held, everyone back together, everyone forward
// together - rather than one piece at a time.
//
// The timing matters for more than pacing: the presenter sets `timeOfStageEnd` from this
// number, so if it under-counts, the next round starts on top of the animation and pieces
// jump mid-slide.
// ==========================================================================================

const STEP = 100;
const HOLD = 1000;
const GAP = 400;
const BUFFER = 500;
const time = (moves: PieceMove[], bustLimit = 51) =>
  computePhasedRevealMs(moves, STEP, HOLD, GAP, BUFFER, bustLimit);

function move(over: Partial<PieceMove>): PieceMove {
  return {
    pieceId: "p",
    guess: 3,
    delta: 3,
    newPosition: 10,
    collidedCount: 0,
    busted: false,
    won: false,
    bonus: 0,
    potShare: 0,
    ...over,
  };
}

describe("the phased reveal's duration", () => {
  it("is just the hold and the buffer when nobody actually moves", () => {
    // Everyone collided at zero: real collisions, but nowhere to slide back to.
    const moves = [
      move({ pieceId: "a", delta: 0, newPosition: 0, collidedCount: 2 }),
      move({ pieceId: "b", delta: 0, newPosition: 0, collidedCount: 2 }),
    ];
    expect(time(moves)).toBe(HOLD + BUFFER);
  });

  it("charges for the LONGEST move in a phase, not the sum of them", () => {
    // This is the whole point of animating the field at once. Sequentially these three would
    // cost 2 + 5 + 3 = 10 steps; together they cost 5.
    const moves = [
      move({ pieceId: "a", guess: 2, delta: 2, newPosition: 12 }),
      move({ pieceId: "b", guess: 5, delta: 5, newPosition: 15 }),
      move({ pieceId: "c", guess: 3, delta: 3, newPosition: 13 }),
    ];
    expect(time(moves)).toBe(HOLD + 5 * STEP + BUFFER);
  });

  it("adds a beat between the backward phase and the forward one", () => {
    const moves = [
      move({ pieceId: "a", guess: 4, delta: -2, newPosition: 8, collidedCount: 2 }),
      move({ pieceId: "b", guess: 4, delta: -2, newPosition: 6, collidedCount: 2 }),
      move({ pieceId: "c", guess: 3, delta: 3, newPosition: 13 }),
    ];
    // back: 2 steps + gap. forward: 3 steps.
    expect(time(moves)).toBe(HOLD + 2 * STEP + GAP + 3 * STEP + BUFFER);
  });

  it("gives the pot's recipients their own beat, after everybody else", () => {
    const moves = [
      move({ pieceId: "leader", guess: 3, delta: 3, newPosition: 34 }),
      move({ pieceId: "back", guess: 2, delta: 7, newPosition: 11, potShare: 5 }),
    ];
    // ordinary 3 steps, then a gap, then the pot winner's 7.
    expect(time(moves)).toBe(HOLD + 3 * STEP + GAP + 7 * STEP + BUFFER);
  });

  it("counts a bust by the distance it actually travels before snapping back", () => {
    // 48 runs to the edge at 51 and then drops to 0: four displayed positions.
    const moves = [move({ pieceId: "a", guess: 6, delta: -48, newPosition: 0, busted: true })];
    expect(time(moves)).toBe(HOLD + 4 * STEP + BUFFER);
  });

  it("uses THIS game's edge, so a short track does not over-count", () => {
    const busting = move({ pieceId: "a", guess: 9, delta: -19, newPosition: 0, busted: true });
    // On a 21-edge track it runs 20, 21, 0 - three positions, not nine.
    expect(time([busting], 21)).toBe(HOLD + 3 * STEP + BUFFER);
  });

  it("never returns less than the hold, whatever it is handed", () => {
    expect(time([])).toBe(HOLD + BUFFER);
  });

  it("beats the old sequential cost on a full board", () => {
    // Sixteen pieces each moving five: sequentially that was 80 steps, phased it is 5.
    const moves = Array.from({ length: 16 }, (_, i) =>
      move({ pieceId: `p${i}`, guess: 5, delta: 5, newPosition: 5 + i }),
    );
    expect(time(moves)).toBe(HOLD + 5 * STEP + BUFFER);
  });
});

// ==========================================================================================
// Which BEAT a move belongs to is decided by its direction, not by whether it collided.
//
// The bug: grouping on `collidedCount` put a piece that collided AND collected the lone-last
// bonus into the backwards beat - and since its net delta was positive, it slid FORWARDS
// while everybody around it slid back. Seen live: a piece went 5 to 8 during the back phase.
// ==========================================================================================
describe("phase grouping follows the direction of the move", () => {
  it("puts a collision that nets POSITIVE in the forward beat", () => {
    // Collided (-2) but alone at the back (+5): a net +3, so it moves with the forward group.
    const netGain = move({
      pieceId: "straggler",
      guess: 4,
      delta: 3,
      newPosition: 8,
      collidedCount: 2,
      bonus: 5,
    });
    const slidingBack = move({
      pieceId: "other",
      guess: 4,
      delta: -2,
      newPosition: 18,
      collidedCount: 2,
    });
    // If both counted as "back", the phase would cost the longer of 3 and 2 and the forward
    // phase would cost nothing. Split correctly it is back 2, a gap, then forward 3.
    expect(time([netGain, slidingBack])).toBe(HOLD + 2 * STEP + GAP + 3 * STEP + BUFFER);
  });

  it("puts a bust in the forward beat, because it runs to the edge first", () => {
    // A bust's delta is hugely negative, but it animates forwards before snapping to zero.
    const busting = move({ pieceId: "a", guess: 6, delta: -48, newPosition: 0, busted: true });
    const backwards = move({
      pieceId: "b",
      guess: 4,
      delta: -2,
      newPosition: 10,
      collidedCount: 2,
    });
    expect(time([busting, backwards])).toBe(HOLD + 2 * STEP + GAP + 4 * STEP + BUFFER);
  });

  it("leaves a zero-delta collision out of both beats", () => {
    // Collided at the floor: nothing to animate either way, and no beat to pay for.
    const stuck = move({ pieceId: "a", delta: 0, newPosition: 0, collidedCount: 2 });
    const forward = move({ pieceId: "b", guess: 3, delta: 3, newPosition: 13 });
    expect(time([stuck, forward])).toBe(HOLD + 3 * STEP + BUFFER);
  });
});
