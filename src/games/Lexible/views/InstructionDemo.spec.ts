import { DEMO_HOME, DEMO_SCRIPTS, DEMO_SIZE, applyFrame, buildDemoGrid } from "./InstructionDemo";
import { connectedToLeftEdge, hasCrossedBoard, isHomeCell } from "../models/teamAreas";
import { isAdjacent } from "../models/dragSelection";
import { Vector2 } from "libs";

// ==========================================================================================
// The instructions animate the rules, which means they can now be WRONG - a still picture at
// least stayed whatever it was drawn as.  These check the demo against the same functions the
// real board uses, so a rule change that makes the tutorial a lie fails here.
//
// The three steps tell one story on one board: A spells TRIP, B takes it back with STRIP, B
// stretches it to TRIPLED and wins.  Most of what is checked below is that the story is legal
// - that every word is a walkable path, that the capture obeys the score rule, and that the
// winning board really does cross.
// ==========================================================================================

const at = (grid: ReturnType<typeof buildDemoGrid>, key: string) => {
  const [x, y] = key.split(",").map(Number);
  return grid.getBlock(new Vector2(x, y))!;
};

const asVector = (key: string) => {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
};

/** Play a script through to a given frame and hand back the board. */
function playTo(step: 1 | 2 | 3, frameIndex: number) {
  const grid = buildDemoGrid();
  const script = DEMO_SCRIPTS[step];
  for (let i = 0; i <= frameIndex; i++) applyFrame(grid, script[i]);
  return { grid, script };
}

/** The word a script's longest selection spells, read off the real board. */
function longestSelection(step: 1 | 2 | 3): string[] {
  return DEMO_SCRIPTS[step]
    .map((f) => f.selected ?? [])
    .reduce((best, next) => (next.length > best.length ? next : best), [] as string[]);
}

function wordAt(grid: ReturnType<typeof buildDemoGrid>, cells: string[]) {
  return cells.map((c) => at(grid, c).letter).join("");
}

describe("the demo board matches the real one", () => {
  it("is 6x6", () => {
    expect(DEMO_SIZE).toBe(6);
    const grid = buildDemoGrid();
    expect(grid.width).toBe(6);
    expect(grid.height).toBe(6);
  });

  it("seeds the home column exactly where the game does", () => {
    // If the real starting geometry moves, a tutorial showing the old one is worse than none.
    for (const [key, spec] of Object.entries(DEMO_HOME)) {
      const [x, y] = key.split(",").map(Number);
      expect(isHomeCell(spec.team, x, y)).toBe(true);
    }
    for (let y = 0; y < DEMO_SIZE; y++) {
      const team = isHomeCell("A", 0, y) ? "A" : "B";
      expect(DEMO_HOME[`0,${y}`]?.team).toBe(team);
    }
  });
});

describe("every word in the story is one a player could really spell", () => {
  for (const step of [1, 2, 3] as const) {
    it(`step ${step}'s word is an unbroken chain of neighbouring letters`, () => {
      // Spelling walks all eight neighbours, so this uses the game's own isAdjacent rather
      // than a rule written for the test.
      const cells = longestSelection(step);
      expect(cells.length).toBeGreaterThan(2);
      for (let i = 1; i < cells.length; i++) {
        expect(isAdjacent(asVector(cells[i - 1]), asVector(cells[i]))).toBe(true);
      }
    });

    it(`step ${step}'s word never uses the same tile twice`, () => {
      const cells = longestSelection(step);
      expect(new Set(cells).size).toBe(cells.length);
    });

    it(`step ${step} grows its word one letter at a time`, () => {
      const chains = DEMO_SCRIPTS[step]
        .map((f) => f.selected)
        .filter((c): c is string[] => !!c && c.length > 0);
      for (let i = 1; i < chains.length; i++) {
        expect(chains[i].length).toBe(chains[i - 1].length + 1);
        expect(chains[i].slice(0, chains[i - 1].length)).toEqual(chains[i - 1]);
      }
    });
  }

  it("spells TRIP, then STRIP, then TRIPLED", () => {
    const grid = buildDemoGrid();
    expect(wordAt(grid, longestSelection(1))).toBe("TRIP");
    expect(wordAt(grid, longestSelection(2))).toBe("STRIP");
    expect(wordAt(grid, longestSelection(3))).toBe("TRIPLED");
  });
});

describe("every step loops cleanly", () => {
  for (const step of [1, 2, 3] as const) {
    it(`step ${step} returns to its opening board when it wraps`, () => {
      // Each frame states the whole board, so the loop cannot leave residue behind. Without
      // that, step 2's stolen tiles would still be B's the second time round and the
      // firework would never fire again.
      const script = DEMO_SCRIPTS[step];
      const first = buildDemoGrid();
      applyFrame(first, script[0]);
      const snapshot = first.serialize();

      const looped = buildDemoGrid();
      for (const frame of script) applyFrame(looped, frame);
      applyFrame(looped, script[0]);

      expect(looped.serialize()).toEqual(snapshot);
    });

    it(`step ${step} holds every frame long enough to be seen`, () => {
      for (const frame of DEMO_SCRIPTS[step]) {
        expect(frame.holdMs).toBeGreaterThanOrEqual(300);
      }
    });
  }
});

describe("step 1 - words start from your own territory", () => {
  it("starts the chain on one of team A's home tiles", () => {
    const { script } = playTo(1, 1);
    const selected = script[1].selected!;
    expect(selected.length).toBe(1);
    const [x, y] = selected[0].split(",").map(Number);
    expect(isHomeCell("A", x, y)).toBe(true);
  });

  it("ends with the word's tiles claimed for team A", () => {
    const script = DEMO_SCRIPTS[1];
    const { grid } = playTo(1, script.length - 1);
    for (const key of longestSelection(1)) {
      expect(at(grid, key).team).toBe("A");
      expect(at(grid, key).score).toBeGreaterThan(0);
    }
  });
});

describe("step 2 - a longer word takes it straight back", () => {
  it("opens exactly where step 1 finished", () => {
    // The continuity is the teaching: this is not an abstract capture, it is the word you
    // just watched being taken away.
    const step1 = DEMO_SCRIPTS[1];
    const endOfOne = playTo(1, step1.length - 1).grid;
    const startOfTwo = playTo(2, 0).grid;
    expect(startOfTwo.serialize()).toEqual(endOfOne.serialize());
  });

  it("prepends one letter, from B's own home tile, directly below the T", () => {
    const first = longestSelection(1);
    const second = longestSelection(2);
    expect(second.length).toBe(first.length + 1);
    expect(second.slice(1)).toEqual(first);

    const [sx, sy] = second[0].split(",").map(Number);
    const [tx, ty] = first[0].split(",").map(Number);
    expect(isHomeCell("B", sx, sy)).toBe(true);
    expect(sx).toBe(tx); // same column
    expect(sy).toBe(ty + 1); // one row below
  });

  it("obeys the score rule it is illustrating: the word must be LONGER", () => {
    const { grid } = playTo(2, 0);
    const target = at(grid, longestSelection(1)[0]);
    expect(target.team).toBe("A");
    expect(longestSelection(2).length).toBeGreaterThan(target.score);
  });

  it("fires a firework on every tile that came off team A, and none that did not", () => {
    const script = DEMO_SCRIPTS[2];
    const { grid } = playTo(2, script.length - 1);
    const stolen = script[script.length - 1].stolen!;
    expect(stolen.sort()).toEqual([...longestSelection(1)].sort());
    for (const key of stolen) expect(at(grid, key).captureSeq).toBeGreaterThan(0);
    // B's own home square changed score but not hands - no firework.
    expect(at(grid, longestSelection(2)[0]).captureSeq).toBe(0);
  });

  it("never claims to steal a tile that was not the other team's", () => {
    for (const step of [1, 2, 3] as const) {
      const grid = buildDemoGrid();
      for (const frame of DEMO_SCRIPTS[step]) {
        for (const key of frame.stolen ?? []) {
          const before = at(grid, key);
          expect(before.team).not.toBe("_");
          expect(before.team).not.toBe(frame.cells![key].team);
        }
        applyFrame(grid, frame);
      }
    }
  });
});

describe("step 3 - the bridge, and the win", () => {
  it("opens exactly where step 2 finished", () => {
    const step2 = DEMO_SCRIPTS[2];
    const endOfTwo = playTo(2, step2.length - 1).grid;
    const startOfThree = playTo(3, 0).grid;
    expect(startOfThree.serialize()).toEqual(endOfTwo.serialize());
  });

  it("really does cross the board, by the game's own win check", () => {
    // The whole claim of step 3.  If teamAreas ever changes what counts as a crossing, this
    // fails rather than the tutorial quietly showing a win that is not one.
    const script = DEMO_SCRIPTS[3];
    const { grid } = playTo(3, script.length - 1);
    expect(hasCrossedBoard(grid, "B")).toBe(true);
    expect(hasCrossedBoard(grid, "A")).toBe(false);
  });

  it("connects four-way from the left edge to the far column", () => {
    const script = DEMO_SCRIPTS[3];
    const { grid } = playTo(3, script.length - 1);
    const reached = connectedToLeftEdge(grid, "B");
    expect(reached.has(`${DEMO_SIZE - 1},3`)).toBe(true);
    expect(reached.has("0,3")).toBe(true);
  });

  it("has not won yet before the last word lands", () => {
    const { grid } = playTo(3, 0);
    expect(hasCrossedBoard(grid, "B")).toBe(false);
  });

  it("stamps WIN! only after the board has actually been crossed", () => {
    const script = DEMO_SCRIPTS[3];
    const winFrames = script.map((f, i) => ({ f, i })).filter((x) => x.f.win);
    expect(winFrames.length).toBe(1);
    const { grid } = playTo(3, winFrames[0].i);
    expect(hasCrossedBoard(grid, "B")).toBe(true);
  });

  it("holds the WIN! stamp for about two seconds", () => {
    const win = DEMO_SCRIPTS[3].find((f) => f.win)!;
    expect(win.holdMs).toBeGreaterThanOrEqual(1800);
  });

  it("shows no stamp on the other two steps", () => {
    for (const step of [1, 2] as const) {
      expect(DEMO_SCRIPTS[step].some((f) => f.win)).toBe(false);
    }
  });
});
