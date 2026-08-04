import { expect } from "chai";
import { Vector2 } from "libs";
import { LetterGridModel } from "./LetterGridModel";
import { findHotPathInGrid } from "./LetterGridPath";
import { goalX, homeCells, isHomeCell } from "./teamAreas";

// The board changed shape: both teams now start on the LEFT, interleaved, and both run for
// the right-hand edge.  Before, A owned the whole left column and B the whole right one and
// they ran at each other, which meant the two teams were never playing the same board - the
// letters on your half were the letters you got.  See teamAreas.ts.
//
// These tests deliberately restate the geometry (both in column 0; A on odd rows, B on even)
// rather than importing it as gospel, so that quietly changing the rule fails here instead of
// silently changing the game.

function generateUniformlyFilledGrid(
  width: number,
  height: number,
  team: string,
  score: string,
  nextRandom: () => number,
) {
  const LETTERS = "QWERTYUIOPASDFGHJKLZXCVBNM";
  let letterDeck = "";
  for (let i = 0; i < width * height; i++) {
    letterDeck += LETTERS.charAt(Math.floor(LETTERS.length * nextRandom()));
    letterDeck += team;
    letterDeck += score;
  }
  const grid = new LetterGridModel(width, height);
  grid.populate(letterDeck);
  return grid;
}

function generateFullyRandomGrid(width: number, height: number, nextRandom: () => number) {
  const LETTERS = "QWERTYUIOPASDFGHJKLZXCVBNM";
  const TEAMS = "_AB";
  const SCORES = "0123456789";
  let letterDeck = "";
  for (let i = 0; i < width * height; i++) {
    letterDeck += LETTERS.charAt(Math.floor(LETTERS.length * nextRandom()));
    letterDeck += TEAMS.charAt(Math.floor(TEAMS.length * nextRandom()));
    letterDeck += SCORES.charAt(Math.floor(SCORES.length * nextRandom()));
  }
  const grid = new LetterGridModel(width, height);
  grid.populate(letterDeck);
  return grid;
}

/** Both teams start in the left-hand column now; only the row parity differs. */
const START_COLUMN = 0;

describe("Team starting areas", () => {
  it("puts both teams in column 0, A on odd rows and B on even rows", () => {
    expect(isHomeCell("A", 0, 1)).equals(true);
    expect(isHomeCell("A", 0, 0)).equals(false);
    expect(isHomeCell("A", 1, 1)).equals(false);
    expect(isHomeCell("B", 0, 0)).equals(true);
    expect(isHomeCell("B", 0, 1)).equals(false);
    expect(isHomeCell("B", 1, 0)).equals(false);
  });

  it("never gives the same square to both teams", () => {
    const grid = new LetterGridModel(6, 9);
    const a = homeCells(grid, "A").map((c) => `${c.x},${c.y}`);
    const b = homeCells(grid, "B").map((c) => `${c.x},${c.y}`);
    expect(a.some((cell) => b.includes(cell))).equals(false);
    expect(a.length).greaterThan(0);
    expect(b.length).greaterThan(0);
  });

  it("leaves each team a neutral square to step into, so neither is walled in", () => {
    // Both start in column 0, interleaved by row, so the square to the right of
    // every starting square belongs to nobody.
    const grid = new LetterGridModel(6, 9);
    for (const cell of homeCells(grid, "A")) {
      expect(isHomeCell("B", cell.x + 1, cell.y)).equals(false);
    }
    for (const cell of homeCells(grid, "B")) {
      expect(isHomeCell("A", cell.x + 1, cell.y)).equals(false);
    }
  });

  it("sends both teams to the same goal", () => {
    const grid = new LetterGridModel(11, 7);
    expect(goalX(grid)).equals(10);
  });
});

describe("LetterGridPathFinder tests", () => {
  describe("Flooded grids", () => {
    const GRID_WIDTH = 7;
    const GRID_HEIGHT = 8;
    const testCases = [
      ["A", "_", "neutral"],
      ["B", "_", "neutral"],
      ["A", "A", "ally"],
      ["B", "A", "enemy"],
      ["A", "B", "enemy"],
      ["B", "B", "ally"],
    ];
    const gridDescription: Record<string, string> = {
      _: "a fully empty grid",
      A: "a grid conquered by team A",
      B: "a grid conquered by team B",
    };
    for (const testCase of testCases) {
      it(`Identifies ${gridDescription[testCase[1]]} as needing an all ${testCase[2]} path for team ${testCase[0]}`, () => {
        const grid = generateUniformlyFilledGrid(
          GRID_WIDTH,
          GRID_HEIGHT,
          testCase[1],
          "4",
          Math.random,
        );
        const team = testCase[0];
        const path = findHotPathInGrid(grid, team as "A" | "B");

        // Straight across from the left-hand column to the right edge.  Both
        // teams start in the same column, so both face the identical distance.
        const expectedLength = GRID_WIDTH - START_COLUMN;
        expect(path.nodes.length).equals(expectedLength);
        for (const k of ["neutral", "ally", "enemy"]) {
          if (k === testCase[2]) {
            expect(path.cost[k as "neutral" | "ally" | "enemy"]).equals(expectedLength);
          } else {
            expect(path.cost[k as "neutral" | "ally" | "enemy"]).equals(0);
          }
        }
      });
    }

    it("starts each team in its own column and ends both at the right edge", () => {
      for (const team of ["A", "B"] as const) {
        const grid = generateUniformlyFilledGrid(GRID_WIDTH, GRID_HEIGHT, team, "4", Math.random);
        const path = findHotPathInGrid(grid, team);
        expect(path.nodes[0].x).equals(START_COLUMN);
        expect(isHomeCell(team, path.nodes[0].x, path.nodes[0].y)).equals(true);
        expect(path.nodes[path.nodes.length - 1].x).equals(goalX(grid));
      }
    });
  });

  describe("Fuzz tests", () => {
    const MIN_GRID_WIDTH = 1;
    const MIN_GRID_HEIGHT = 1;
    const GRID_WIDTH_VARIANCE = 100;
    const GRID_HEIGHT_VARIANCE = 100;
    for (let i = 0; i < 10; i++) {
      it(`Doesn't crash (iteration ${i + 1})`, () => {
        const width = MIN_GRID_WIDTH + Math.floor(Math.random() * GRID_WIDTH_VARIANCE);
        const height = MIN_GRID_HEIGHT + Math.floor(Math.random() * GRID_HEIGHT_VARIANCE);
        const grid = generateFullyRandomGrid(width, height, Math.random);
        const team = Math.random() < 0.5 ? "A" : "B";
        findHotPathInGrid(grid, team);
      });
    }
  });

  describe("Random walk tests", () => {
    const MIN_GRID_WIDTH = 5;
    const MIN_GRID_HEIGHT = 5;
    const GRID_WIDTH_VARIANCE = 20;
    const GRID_HEIGHT_VARIANCE = 20;
    for (let i = 0; i < 10; i++) {
      it(`Finds winning path if it exists (iteration ${i + 1})`, () => {
        const width = MIN_GRID_WIDTH + Math.floor(Math.random() * GRID_WIDTH_VARIANCE);
        const height = MIN_GRID_HEIGHT + Math.floor(Math.random() * GRID_HEIGHT_VARIANCE);
        const grid = generateUniformlyFilledGrid(width, height, "_", "0", Math.random);
        const team = i % 2 === 0 ? "A" : "B";

        // Start the walk on one of THIS team's home squares - a path that does
        // not touch the starting area is not a winning path, however far it goes.
        const start = homeCells(grid, team)[0];
        let x = start.x;
        let y = start.y;
        while (x < width) {
          const block = grid.getBlock(new Vector2(x, y))!;
          block.setScore(4, team);
          const dirRand = Math.random();
          if (dirRand < 0.1) {
            x--;
            if (x < start.x) x = start.x;
          } else if (dirRand < 0.3) {
            y--;
            if (y < 0) y = 0;
          } else if (dirRand < 0.5) {
            y++;
            if (y > height - 1) y = height - 1;
          } else {
            x++;
          }
        }
        const path = findHotPathInGrid(grid, team);
        expect(path.cost.neutral).equals(0);
        expect(path.cost.enemy).equals(0);
        expect(path.nodes.length).equals(path.cost.ally);
      });
    }
  });
});
