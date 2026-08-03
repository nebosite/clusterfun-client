import { Vector2 } from "libs";
import { LetterGridModel } from "./LetterGridModel";

// ==========================================================================================
// Where each team starts, and where both teams are going.
//
// Both teams used to own a whole edge column and race towards each other - A left-to-right,
// B right-to-left.  That is not a fair board: the two directions are not equivalent to look
// at on a shared screen, the grids are not symmetric once letters are dealt, and whichever
// side happened to get the friendlier letters won the orientation lottery.
//
// Now both teams start on the LEFT, interleaved, and both race to the RIGHT edge:
//
//     col 0   col 1
//   y=0  .      B          A owns column 0 on ODD rows
//   y=1  A      .          B owns column 1 on EVEN rows
//   y=2  .      B
//   y=3  A      .
//
// They interleave rather than collide: A's cells are odd-row, B's are even-row, so A can
// always step right out of (0, odd) into a neutral (1, odd), and B out of (1, even) into a
// neutral (2, even).  Neither team is walled in by the other at the start, and both face the
// identical journey to the same goal - which is the whole point.
//
// One definition, used by three things that must agree: the seeding in prepareFreshRound, the
// win search in findHotPathInGrid, and the connected-region border on the presenter.  When
// they disagreed in the past it showed up as a team that could not win a board it had already
// crossed.
// ==========================================================================================

/** The score a home cell is seeded with - low enough that a decent word can take it. */
export const TEAM_HOME_SCORE = 4;

/** Is this square part of the given team's starting area? */
export function isHomeCell(team: string, x: number, y: number): boolean {
  if (team === "A") return x === 0 && y % 2 === 1;
  if (team === "B") return x === 1 && y % 2 === 0;
  return false;
}

/** Every starting square for a team, top to bottom. */
export function homeCells(grid: LetterGridModel, team: string): Vector2[] {
  const cells: Vector2[] = [];
  for (let y = 0; y < grid.height; y++) {
    if (isHomeCell(team, 0, y)) cells.push(new Vector2(0, y));
    if (isHomeCell(team, 1, y)) cells.push(new Vector2(1, y));
  }
  return cells;
}

/** The column both teams are trying to reach. */
export function goalX(grid: LetterGridModel): number {
  return grid.width - 1;
}

/**
 * The squares a team owns that are actually JOINED to its starting area, walking only through
 * its own squares, four-way.  Everything else the team owns is a detached island: it counts
 * for nothing towards winning, and the point of drawing it differently is that a gap in the
 * chain is otherwise very hard to spot on a big board from across the room.
 *
 * Returned as a set of "x,y" keys - cheap to test per block while rendering.
 */
export function connectedToHome(grid: LetterGridModel, team: string): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const reached = new Set<string>();
  const queue: Vector2[] = [];

  for (const cell of homeCells(grid, team)) {
    const block = grid.getBlock(cell);
    // A home square that has been captured is no longer a way in.
    if (!block || block.team !== team) continue;
    if (reached.has(key(cell.x, cell.y))) continue;
    reached.add(key(cell.x, cell.y));
    queue.push(cell);
  }

  while (queue.length) {
    const at = queue.pop()!;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (reached.has(key(x, y))) continue;
      const block = grid.getBlock(new Vector2(x, y));
      if (!block || block.team !== team) continue;
      reached.add(key(x, y));
      queue.push(new Vector2(x, y));
    }
  }

  return reached;
}
