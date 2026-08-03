import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EittrisPiece,
  PIECE_COUNT,
  collides,
  dropDestination,
  emptyGrid,
  fullRows,
  collapseRows,
  planPlacement,
  pieceCells,
  shuffledBag,
  stackHeight,
  withPieceSettled,
} from "./eittrisLogic";

// ------------------------------------------------------------------------------------------
// How good IS the bot?  Not a unit test - a measurement.  It plays whole games against the
// seven-bag with nothing but the planner, and reports how long it survives.
// ------------------------------------------------------------------------------------------

function playOneGame(seed: number, lookahead: boolean): { pieces: number; rows: number } {
  let state = seed;
  const rand = () => {
    // A tiny deterministic generator, so a run can be repeated exactly
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  let grid = emptyGrid();
  let queue: number[] = [];
  const nextType = () => {
    if (queue.length === 0) queue = shuffledBag(rand);
    return queue.shift()!;
  };

  let rows = 0;
  let type = nextType();
  for (let placed = 0; placed < 600; placed++) {
    const upcoming = queue.length > 0 ? queue[0] : -1;
    const spawn: EittrisPiece = { type, rot: 0, x: 3, y: 0 };
    if (collides(grid, pieceCells(spawn))) return { pieces: placed, rows };

    const plan = planPlacement(
      grid,
      spawn,
      lookahead && upcoming >= 0 && upcoming < PIECE_COUNT ? upcoming : undefined,
    );
    if (!plan) return { pieces: placed, rows };

    const landed = dropDestination(grid, { ...spawn, rot: plan.rot, x: plan.x });
    const settled = withPieceSettled(grid, landed);
    const full = fullRows(settled);
    rows += full.length;
    grid = full.length > 0 ? collapseRows(settled, full) : settled;
    if (stackHeight(grid) >= BOARD_HEIGHT) return { pieces: placed, rows };
    type = nextType();
  }
  return { pieces: 600, rows };
}

describe("the computer player, measured over whole games", () => {
  it("survives longer with a move of lookahead than without", () => {
    const seeds = [1, 7, 19, 23, 42, 77, 101, 404];
    const blind = seeds.map((s) => playOneGame(s, false));
    const seeing = seeds.map((s) => playOneGame(s, true));
    const total = (games: { pieces: number }[]) => games.reduce((a, g) => a + g.pieces, 0);
    const rowsOf = (games: { rows: number }[]) => games.reduce((a, g) => a + g.rows, 0);

    // eslint-disable-next-line no-console
    console.log(
      `bot: blind ${total(blind)} pieces / ${rowsOf(blind)} rows,` +
        ` lookahead ${total(seeing)} pieces / ${rowsOf(seeing)} rows`,
    );
    expect(total(seeing)).toBeGreaterThan(total(blind));
  });

  it("does not simply die in the first few pieces", () => {
    const games = [1, 7, 19, 23].map((s) => playOneGame(s, true));
    for (const g of games) expect(g.pieces).toBeGreaterThan(20);
  });
});

describe("the computer player's cost", () => {
  it("plans fast enough for twenty robots", () => {
    // A messy half-full board, which is the expensive case
    const grid = emptyGrid();
    let seed = 5;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let y = BOARD_HEIGHT - 10; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) if (rand() > 0.35) grid[y][x] = 1;
    }
    const piece = { type: 0, rot: 0, x: 3, y: 0 };

    const runs = 200;
    const started = Date.now();
    for (let i = 0; i < runs; i++) planPlacement(grid, piece, (i % 7) as number);
    const perPlan = (Date.now() - started) / runs;
    // eslint-disable-next-line no-console
    console.log(`plan with lookahead: ${perPlan.toFixed(2)}ms`);
    // Twenty robots thinking ten times a second is 200 plans a second
    expect(perPlan).toBeLessThan(5);
  });
});
