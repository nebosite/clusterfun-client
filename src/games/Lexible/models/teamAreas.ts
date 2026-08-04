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
// Now both teams start in the LEFT-HAND COLUMN, interleaved by row, and both race to the
// RIGHT edge:
//
//     col 0
//   y=0   B          A owns column 0 on ODD rows
//   y=1   A          B owns column 0 on EVEN rows
//   y=2   B
//   y=3   A
//
// They interleave rather than collide: every starting square has a neutral square to its
// right, so neither team is walled in, and both face the identical journey to the same goal -
// which is the whole point.
//
// One definition, used by three things that must agree: the seeding in prepareFreshRound, the
// win check, and the region outline on the presenter.  They now share the SAME flood fill
// rather than each deciding for itself - the outline a team can see is, exactly, the thing
// that wins them the round when it touches the far side.
// ==========================================================================================

/** The score a home cell is seeded with - low enough that a decent word can take it. */
export const TEAM_HOME_SCORE = 4;

/** Is this square part of the given team's starting area? */
export function isHomeCell(team: string, x: number, y: number): boolean {
  if (x !== 0) return false;
  if (team === "A") return y % 2 === 1;
  if (team === "B") return y % 2 === 0;
  return false;
}

/** Every starting square for a team, top to bottom. */
export function homeCells(grid: LetterGridModel, team: string): Vector2[] {
  const cells: Vector2[] = [];
  for (let y = 0; y < grid.height; y++) {
    if (isHomeCell(team, 0, y)) cells.push(new Vector2(0, y));
  }
  return cells;
}

/** The column both teams are trying to reach. */
export function goalX(grid: LetterGridModel): number {
  return grid.width - 1;
}

/**
 * Mark every block with whether it is joined to the left edge, and which of its sides face
 * out of that region.  Only outward-facing edges get drawn, which is what makes the whole
 * blob read as one outline instead of a box around each tile.
 *
 * Lives here, and is called by BOTH models, because the presenter and the phones drawing
 * different borders from the same board would be a lie about who is about to win.
 *
 * Returns the regions so a caller that also wants the win answer does not walk the board
 * twice.
 */
export function applyHomeConnections(grid: LetterGridModel): Record<string, Set<string>> {
  const connected: Record<string, Set<string>> = {
    A: connectedToLeftEdge(grid, "A"),
    B: connectedToLeftEdge(grid, "B"),
  };
  // Unclaimed tiles have team "_", which is not a key here, so they never join a region.
  const isIn = (team: string, x: number, y: number) =>
    !!connected[team] && connected[team].has(`${x},${y}`);

  grid.processBlocks((block) => {
    const { x, y } = block.coordinates;
    const team = block.team;
    if (!isIn(team, x, y)) {
      block.setHomeConnection(false, 0);
      return;
    }
    let mask = 0;
    if (!isIn(team, x, y - 1)) mask |= 1; // top
    if (!isIn(team, x + 1, y)) mask |= 2; // right
    if (!isIn(team, x, y + 1)) mask |= 4; // bottom
    if (!isIn(team, x - 1, y)) mask |= 8; // left
    block.setHomeConnection(true, mask);
  });

  return connected;
}

/**
 * Has this team crossed the board?  Yes exactly when the region joined to the left edge
 * reaches the goal column - the flood fill below IS the win condition, not an approximation
 * of it.
 *
 * Pass `reached` if you already have the fill, which the presenter does: it recomputes the
 * regions on every board change to draw the outline, and the win is then a set lookup.
 */
export function hasCrossedBoard(
  grid: LetterGridModel,
  team: string,
  reached: Set<string> = connectedToLeftEdge(grid, team),
): boolean {
  const x = goalX(grid);
  for (let y = 0; y < grid.height; y++) {
    if (reached.has(`${x},${y}`)) return true;
  }
  return false;
}

/**
 * The squares a team owns that are actually JOINED to the LEFT EDGE, walking only through its
 * own squares, four-way.  Everything else the team owns is a detached island: it counts for
 * nothing towards crossing the board, and the point of drawing it differently is that a gap
 * in the chain is otherwise very hard to spot on a big board from across the room.
 *
 * The anchor is any owned square in column 0 - not just the seeded starting squares.  A team
 * that captures a fresh square on the left edge has genuinely reached the edge, and the
 * outline should say so.
 *
 * Returned as a set of "x,y" keys - cheap to test per block while rendering.
 */
export function connectedToLeftEdge(grid: LetterGridModel, team: string): Set<string> {
  const key = (x: number, y: number) => `${x},${y}`;
  const reached = new Set<string>();
  const queue: Vector2[] = [];

  for (let y = 0; y < grid.height; y++) {
    const cell = new Vector2(0, y);
    const block = grid.getBlock(cell);
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
