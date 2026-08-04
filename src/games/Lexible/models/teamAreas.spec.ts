import { Vector2 } from "libs";
import { LetterGridModel } from "./LetterGridModel";
import {
  applyHomeConnections,
  connectedToLeftEdge,
  goalX,
  hasCrossedBoard,
  homeCells,
  isHomeCell,
} from "./teamAreas";

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

describe("connectedToLeftEdge", () => {
  it("finds nothing when the team owns nothing", () => {
    expect(keys(connectedToLeftEdge(grid(5, 4), "A"))).toEqual([]);
  });

  it("includes a home square the team still holds", () => {
    const g = grid(5, 4);
    own(g, "A", [[0, 1]]); // A's home: column 0, odd rows
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1"]);
  });

  it("walks outwards through the team's own tiles", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1", "1,1", "2,1"]);
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
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1", "1,1"]);
  });

  it("does not connect through a diagonal", () => {
    // Words may be spelled diagonally, but the board is only crossed four-way -
    // so a diagonal touch is still a gap.
    const g = grid(5, 5);
    own(g, "A", [
      [0, 1],
      [1, 2],
    ]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1"]);
  });

  it("does not connect through an enemy tile", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [2, 1],
    ]);
    own(g, "B", [[1, 1]]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1"]);
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
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual([]);
  });

  it("keeps the two teams' regions separate", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [0, 1],
      [1, 1],
    ]);
    own(g, "B", [
      [0, 0],
      [1, 0],
    ]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,1", "1,1"]);
    expect(keys(connectedToLeftEdge(g, "B"))).toEqual(["0,0", "1,0"]);
  });

  it("anchors on ANY owned square on the left edge, not just the seeded ones", () => {
    // A's starting squares are odd rows, but if A captures an even row on the
    // left edge it has genuinely reached the edge and the outline must say so.
    const g = grid(5, 4);
    own(g, "A", [
      [0, 0], // an even row - not one of A's starting squares
      [1, 0],
    ]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual(["0,0", "1,0"]);
  });

  it("counts nothing when the team owns tiles but none touch the left edge", () => {
    const g = grid(5, 4);
    own(g, "A", [
      [2, 1],
      [3, 1],
    ]);
    expect(keys(connectedToLeftEdge(g, "A"))).toEqual([]);
  });

  it("can reach the goal column, which is what winning looks like", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const reached = connectedToLeftEdge(g, "A");
    expect(reached.has(`${goalX(g)},1`)).toBe(true);
  });
});

describe("home cell geometry", () => {
  it("puts both teams in column 0, on opposite row parities", () => {
    const g = grid(6, 6);
    for (const cell of homeCells(g, "A")) {
      expect(cell.x).toBe(0);
      expect(cell.y % 2).toBe(1);
    }
    for (const cell of homeCells(g, "B")) {
      expect(cell.x).toBe(0);
      expect(cell.y % 2).toBe(0);
    }
  });

  it("interleaves them so every start has a neutral square to its right", () => {
    const g = grid(6, 6);
    for (const team of ["A", "B"]) {
      for (const cell of homeCells(g, team)) {
        expect(isHomeCell("A", cell.x + 1, cell.y)).toBe(false);
        expect(isHomeCell("B", cell.x + 1, cell.y)).toBe(false);
      }
    }
  });

  it("claims nothing for a team that is not A or B", () => {
    expect(isHomeCell("_", 0, 1)).toBe(false);
    expect(homeCells(grid(5, 5), "_")).toEqual([]);
  });
});

// hasCrossedBoard IS the win condition now.  It used to be an A* search for the cheapest
// crossing (fewest enemy squares, then fewest neutral ones) which answered a different
// question and only coincided with "has this team actually built a chain" at zero cost.
describe("hasCrossedBoard", () => {
  it("is false on an untouched board", () => {
    expect(hasCrossedBoard(grid(6, 4), "A")).toBe(false);
    expect(hasCrossedBoard(grid(6, 4), "B")).toBe(false);
  });

  it("is true for an unbroken row of the team's own tiles", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(hasCrossedBoard(g, "A")).toBe(true);
    expect(hasCrossedBoard(g, "B")).toBe(false);
  });

  it("is false when one tile in the middle is missing", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [3, 1],
    ]);
    expect(hasCrossedBoard(g, "A")).toBe(false);
  });

  it("is false for a chain that reaches the goal but never touched the left edge", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(hasCrossedBoard(g, "A")).toBe(false);
  });

  it("is false when the chain is only joined diagonally", () => {
    const g = grid(3, 3);
    own(g, "A", [
      [0, 1],
      [1, 0],
      [2, 1],
    ]);
    expect(hasCrossedBoard(g, "A")).toBe(false);
  });

  it("accepts a crossing anchored on a captured left-edge square", () => {
    // Row 0 is not one of A's starting squares.  Taking it still puts A on the
    // left edge, and the old home-cell-seeded search would have missed this.
    const g = grid(4, 3);
    own(g, "A", [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(hasCrossedBoard(g, "A")).toBe(true);
  });

  it("does not count enemy or neutral tiles as part of a crossing", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [3, 1],
    ]);
    own(g, "B", [[2, 1]]); // B plugs the gap - that is a block, not a bridge
    expect(hasCrossedBoard(g, "A")).toBe(false);
  });

  it("reuses a region that was handed in rather than recomputing it", () => {
    const g = grid(4, 3);
    const fake = new Set([`${goalX(g)},0`]);
    expect(hasCrossedBoard(g, "A", fake)).toBe(true);
  });

  it("survives a one-column board", () => {
    const g = grid(1, 3);
    expect(hasCrossedBoard(g, "A")).toBe(false);
    own(g, "A", [[0, 1]]);
    expect(hasCrossedBoard(g, "A")).toBe(true);
  });

  // Ported from the retired LetterGridPath spec: build a random winding chain from a home
  // square to the far side and require it to be recognised.
  for (let i = 0; i < 10; i++) {
    it(`finds a randomly walked crossing (iteration ${i + 1})`, () => {
      const width = 5 + Math.floor(Math.random() * 20);
      const height = 5 + Math.floor(Math.random() * 20);
      const g = grid(width, height);
      const team = i % 2 === 0 ? "A" : "B";
      const start = homeCells(g, team)[0];
      let x = start.x;
      let y = start.y;
      while (x < width) {
        g.getBlock(new Vector2(x, y))!.setScore(4, team);
        const roll = Math.random();
        if (roll < 0.1) x = Math.max(start.x, x - 1);
        else if (roll < 0.3) y = Math.max(0, y - 1);
        else if (roll < 0.5) y = Math.min(height - 1, y + 1);
        else x++;
      }
      expect(hasCrossedBoard(g, team)).toBe(true);
    });
  }

  it("never crashes on a random board of any shape", () => {
    for (let i = 0; i < 10; i++) {
      const width = 1 + Math.floor(Math.random() * 100);
      const height = 1 + Math.floor(Math.random() * 100);
      const g = grid(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const team = "_AB".charAt(Math.floor(Math.random() * 3));
          if (team !== "_") g.getBlock(new Vector2(x, y))!.setScore(4, team);
        }
      }
      expect(typeof hasCrossedBoard(g, Math.random() < 0.5 ? "A" : "B")).toBe("boolean");
    }
  });
});

// The outline the presenter draws and the outline a phone draws come from this one function,
// so they cannot disagree about where a team's chain is broken.
describe("applyHomeConnections", () => {
  const maskAt = (g: LetterGridModel, x: number, y: number) => {
    const b = g.getBlock(new Vector2(x, y))!;
    return { connected: b.connectedToLeftEdge, mask: b.homeEdgeMask };
  };

  it("marks a joined tile and leaves an island out", () => {
    const g = grid(6, 4);
    own(g, "A", [
      [0, 1],
      [1, 1],
      [4, 1],
    ]);
    applyHomeConnections(g);
    expect(maskAt(g, 0, 1).connected).toBe(true);
    expect(maskAt(g, 1, 1).connected).toBe(true);
    expect(maskAt(g, 4, 1).connected).toBe(false);
  });

  it("leaves unclaimed tiles out of every region", () => {
    const g = grid(4, 3);
    own(g, "A", [[0, 1]]);
    applyHomeConnections(g);
    expect(maskAt(g, 2, 2).connected).toBe(false);
    expect(maskAt(g, 2, 2).mask).toBe(0);
  });

  it("draws an edge only where the region stops", () => {
    // A horizontal pair: the shared side between them carries no border, so the
    // two tiles read as one shape.
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
    ]);
    applyHomeConnections(g);
    const left = maskAt(g, 0, 1);
    const right = maskAt(g, 1, 1);
    expect(left.mask & 2).toBe(0); // left tile: no border on its right
    expect(right.mask & 8).toBe(0); // right tile: no border on its left
    expect(left.mask & 8).not.toBe(0); // outer sides are drawn
    expect(right.mask & 2).not.toBe(0);
    expect(left.mask & 1).not.toBe(0);
    expect(left.mask & 4).not.toBe(0);
  });

  it("clears a border when the tile changes hands", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
    ]);
    applyHomeConnections(g);
    expect(maskAt(g, 1, 1).connected).toBe(true);
    own(g, "B", [[0, 1]]); // A loses the way in
    applyHomeConnections(g);
    expect(maskAt(g, 1, 1).connected).toBe(false);
    expect(maskAt(g, 1, 1).mask).toBe(0);
  });

  it("returns the regions it computed, so the win check need not re-walk the board", () => {
    const g = grid(4, 3);
    own(g, "A", [
      [0, 1],
      [1, 1],
    ]);
    const regions = applyHomeConnections(g);
    expect(keys(regions.A)).toEqual(["0,1", "1,1"]);
    expect(keys(regions.B)).toEqual([]);
  });
});
