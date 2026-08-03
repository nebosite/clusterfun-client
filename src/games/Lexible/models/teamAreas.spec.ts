import { LetterGridModel } from "./LetterGridModel";
import { connectedToHome, goalX, homeCells, isHomeCell } from "./teamAreas";

// The connected-region calculation is what the board's outline is drawn from, and the whole
// point of that outline is to show a team where its chain is BROKEN.  A region that reports
// itself joined when it is not would be worse than drawing nothing.

function grid(width: number, height: number): LetterGridModel {
  const g = new LetterGridModel(width, height);
  // Every tile neutral, score 0.
  g.populate("A_0".repeat(width * height).replace(/A/g, "Q"));
  return g;
}

function own(g: LetterGridModel, team: string, cells: [number, number][]) {
  for (const [x, y] of cells) g.getBlock({ x, y } as any)!.setScore(4, team);
}

const keys = (set: Set<string>) => Array.from(set).sort();

describe("connectedToHome", () => {
  it("finds nothing when the team owns nothing", () => {
    expect(keys(connectedToHome(grid(5, 4), "A"))).toEqual([]);
  });

  it("includes a home square the team still holds", () => {
    const g = grid(5, 4);
    own(g, "A", [[0, 1]]); // A's home: column 0, odd rows
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1"]);
  });

  it("walks outwards through the team's own tiles", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1", "1,1", "2,1"]);
  });

  it("leaves out an island that does not reach home", () => {
    // This is the case the outline exists for: the team owns a promising run of
    // tiles near the goal, but nothing joins it to the start.
    const g = grid(6, 4);
    own(g, "A", [
      [0, 1], // home
      [1, 1], // joined
      [4, 1], // island - gap at x=2,3
      [5, 1],
    ]);
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1", "1,1"]);
  });

  it("does not connect through a diagonal", () => {
    // Words may be spelled diagonally, but the board is only crossed four-way -
    // so a diagonal touch is still a gap.
    const g = grid(5, 5);
    own(g, "A", [
      [0, 1],
      [1, 2],
    ]);
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1"]);
  });

  it("does not connect through an enemy tile", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [2, 1],
    ]);
    own(g, "B", [[1, 1]]);
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1"]);
  });

  it("drops the whole branch when the home square itself is captured", () => {
    // Losing the way in cuts everything behind it loose, which is exactly what
    // the outline should show.
    const g = grid(5, 4);
    own(g, "A", [
      [1, 1],
      [2, 1],
    ]);
    own(g, "B", [[0, 1]]); // A's home square, taken
    expect(keys(connectedToHome(g, "A"))).toEqual([]);
  });

  it("keeps the two teams' regions separate", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [1, 1],
    ]);
    own(g, "B", [
      [1, 0],
      [2, 0],
    ]);
    expect(keys(connectedToHome(g, "A"))).toEqual(["0,1", "1,1"]);
    expect(keys(connectedToHome(g, "B"))).toEqual(["1,0", "2,0"]);
  });

  it("can reach the goal column, which is what winning looks like", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const reached = connectedToHome(g, "A");
    expect(reached.has(`${goalX(g)},1`)).toBe(true);
  });
});

describe("home cell geometry", () => {
  it("gives both teams cells, on opposite row parities", () => {
    const g = grid(6, 6);
    for (const cell of homeCells(g, "A")) {
      expect(cell.x).toBe(0);
      expect(cell.y % 2).toBe(1);
    }
    for (const cell of homeCells(g, "B")) {
      expect(cell.x).toBe(1);
      expect(cell.y % 2).toBe(0);
    }
  });

  it("claims nothing for a team that is not A or B", () => {
    expect(isHomeCell("_", 0, 1)).toBe(false);
    expect(homeCells(grid(5, 5), "_")).toEqual([]);
  });
});
