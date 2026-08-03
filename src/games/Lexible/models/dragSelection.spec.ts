import { chainActionFor, isAdjacent } from "./dragSelection";

// Dragging is now how a word gets spelled on a phone, so these are the rules a finger obeys.
// The retrace case is the one that earns its keep: without it a wrong turn means lifting off
// and starting the whole word again.

const at = (x: number, y: number) => ({ x, y });

describe("isAdjacent", () => {
  it("counts the eight neighbours, matching how words may be spelled", () => {
    const centre = at(3, 3);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        expect(isAdjacent(centre, at(3 + dx, 3 + dy))).toBe(true);
      }
    }
  });

  it("does not count a letter as its own neighbour", () => {
    expect(isAdjacent(at(1, 1), at(1, 1))).toBe(false);
  });

  it("does not count a letter two squares away", () => {
    expect(isAdjacent(at(1, 1), at(3, 1))).toBe(false);
    expect(isAdjacent(at(1, 1), at(1, 3))).toBe(false);
  });
});

describe("chainActionFor", () => {
  describe("starting a word", () => {
    it("starts on a letter this player may begin from", () => {
      expect(chainActionFor([], at(0, 1), true)).toEqual({ kind: "start" });
    });

    it("does nothing on a letter they may not - that drag is a scroll", () => {
      expect(chainActionFor([], at(4, 4), false)).toEqual({ kind: "none" });
    });
  });

  describe("extending", () => {
    it("adds a neighbouring letter", () => {
      expect(chainActionFor([at(1, 1)], at(2, 1), true)).toEqual({ kind: "extend" });
    });

    it("adds a diagonal neighbour", () => {
      expect(chainActionFor([at(1, 1)], at(2, 2), true)).toEqual({ kind: "extend" });
    });

    it("ignores a letter that is not touching the end of the word", () => {
      // A finger that left the board and came back lands somewhere arbitrary.
      expect(chainActionFor([at(1, 1)], at(5, 5), true)).toEqual({ kind: "none" });
    });

    it("keeps extending regardless of the start rule once a word is going", () => {
      // canStart only governs the FIRST letter; after that any reachable letter
      // is fair game, which is what makes crossing enemy territory possible.
      expect(chainActionFor([at(1, 1)], at(2, 1), false)).toEqual({ kind: "extend" });
    });
  });

  describe("retracing", () => {
    it("drops the last letter when the finger goes back one", () => {
      const chain = [at(1, 1), at(2, 1), at(3, 1)];
      expect(chainActionFor(chain, at(2, 1), true)).toEqual({ kind: "retract" });
    });

    it("retraces diagonally too", () => {
      const chain = [at(1, 1), at(2, 2)];
      expect(chainActionFor(chain, at(1, 1), true)).toEqual({ kind: "retract" });
    });

    it("does nothing when the finger is still on the last letter", () => {
      const chain = [at(1, 1), at(2, 1)];
      expect(chainActionFor(chain, at(2, 1), true)).toEqual({ kind: "none" });
    });

    it("does not retrace from a single letter - there is nothing behind it", () => {
      expect(chainActionFor([at(1, 1)], at(1, 1), true)).toEqual({ kind: "none" });
    });
  });

  describe("letters already used", () => {
    it("will not add a letter that is already in the word", () => {
      // Re-using a square would spell a word that cannot be traced on the board.
      const chain = [at(1, 1), at(2, 1), at(3, 1)];
      expect(chainActionFor(chain, at(1, 1), true)).toEqual({ kind: "none" });
    });

    it("still allows the retrace even though that letter is in the word", () => {
      // The one exception, and it has to be checked first.
      const chain = [at(1, 1), at(2, 1), at(3, 1)];
      expect(chainActionFor(chain, at(2, 1), true)).toEqual({ kind: "retract" });
    });
  });

  it("survives a full drag out and back", () => {
    // Spell three letters, then pull all the way back to nothing.
    let chain = [at(0, 1)];
    expect(chainActionFor(chain, at(1, 1), true)).toEqual({ kind: "extend" });
    chain = [at(0, 1), at(1, 1)];
    expect(chainActionFor(chain, at(2, 1), true)).toEqual({ kind: "extend" });
    chain = [at(0, 1), at(1, 1), at(2, 1)];
    expect(chainActionFor(chain, at(1, 1), true)).toEqual({ kind: "retract" });
    chain = [at(0, 1), at(1, 1)];
    expect(chainActionFor(chain, at(0, 1), true)).toEqual({ kind: "retract" });
  });
});
