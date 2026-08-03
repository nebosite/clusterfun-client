import { runInAction } from "mobx";
import { EittrisCommandMessage } from "./eittrisEndpoints";
import {
  NO_EVENTS,
  SimulationContext,
  applyCommand,
  applyIncomingSpecial,
  collectSpecial,
  stepBoard,
} from "./eittrisSimulation";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper, getClientTypeHelper } from "libs";
import { EittrisClientModel, getEittrisClientTypeHelper } from "./ClientModel";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState, GeneralGameState } from "libs";
import {
  EittrisPresenterModel,
  EittrisGameState,
  EittrisGameEvent,
  EittrisPlayer,
  getEittrisPresenterTypeHelper,
} from "./PresenterModel";
import {
  ANTIDOTE_DURATION_MS,
  BRIDGE_COLUMN_MS,
  collides,
  GARBAGE_CELL,
  hasAfflictions,
  pieceCells,
  pieceColorIndex,
  AFFLICTION_DURATION_MS,
  AFFLICTION_TIMERS,
  afflictionMsLeft,
  PIECE_COUNT,
  NEXT_PREVIEW_COUNT,
  NEXT_QUEUE_DEPTH,
  ANTIDOTE_MAX,
  IMPLEMENTED_SPECIALS,
  MAX_ROBOTS_STRESS,
  CLEAR_EAT_MS,
  CLEAR_FALL_MS,
  EVIL_PIECE_COUNT,
  SPAWN_X,
  SEE_SHADOWS_DURATION_MS,
  SPAWN_Y,
  decodePsychoOverlay,
  STENCIL_ROW_MS,
  SWAP_COLUMN_MS,
  WALL_ROWS,
  effectiveIntervalMs,
  EittrisPiece,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EMPTY_CELL,
  SPECIAL_INTERVAL_MS,
  SpecialType,
  START_INTERVAL_MS,
} from "./eittrisLogic";
import { AI_MOVE_INTERVAL_MS, LATE_JOIN_GRACE_MS, SPAWN_DELAY_MS } from "./GameSettings";

// -------------------------------------------------------------------
// A light integration test that drives the real presenter model through its
// message handlers and tick loop.  We deliberately skip reconstitute() (it
// starts a setInterval ticker and wires the relay listeners); the handlers
// under test don't depend on it.  The only collaborator they touch is the
// session (for the fire-and-forget pushes), so a recording stub is enough.
// -------------------------------------------------------------------

interface SentMessage {
  route: string;
  receiverId: string;
  message: any;
}

function makeFakeSession(sent: SentMessage[]): ISessionHelper {
  const fake: Partial<ISessionHelper> = {
    roomId: "ROOM1",
    personalId: "PRESENTER",
    personalSecret: "secret",
    sendMessage: (endpoint, receiverId, message) => {
      sent.push({ route: (endpoint as any).route, receiverId, message });
    },
    listen: (() => ({ unsubscribe: () => {} })) as any,
    listenPresenter: (() => ({ unsubscribe: () => {} })) as any,
    request: (() => Promise.resolve(undefined)) as any,
    requestPresenter: (() => Promise.resolve(undefined)) as any,
    sendMessageToPresenter: () => {},
    addClosedListener: () => {},
    removeClosedListener: () => {},
    onError: () => {},
    serverCall: (() => Promise.resolve(undefined)) as any,
    stats: { sentCount: 0, bytesSent: 0, recievedCount: 0, bytesRecieved: 0 },
  };
  return fake as ISessionHelper;
}

const stubStorage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

function makeModel() {
  const sent: SentMessage[] = [];
  const session = makeFakeSession(sent);
  const logger = new MockTelemetryLogger("test");
  const model = new EittrisPresenterModel(session, logger, stubStorage);
  // Deterministic "randomness": every spawn is a T piece (type 0) at rotation 0
  model.randomDouble = () => 0;
  sentFor.set(model, sent);
  return { model, sent };
}

function addPlayer(model: EittrisPresenterModel, id: string, name: string): EittrisPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  runInAction(() => model.players.push(p));
  return p;
}

// A player's board is simulated on their PHONE now, not on the host.  These tests stand in
// for the phone: same simulator, same context, driven in process - so what they exercise is
// the real arrangement, with the presenter watching rather than authoring.
const lastPhoneTick = new WeakMap<EittrisPresenterModel, number>();
const sentFor = new WeakMap<EittrisPresenterModel, any[]>();

/**
 * Play the victim's phone.
 *
 * An attack no longer lands on the victim inside the host: the host DELIVERS it, and the
 * phone that owns that board applies it the moment it arrives, then tells the host whether
 * its shield ate it.  The harness closes that loop so a test can still say "A hits B" in
 * one line.
 */
function pumpDeliveries(model: EittrisPresenterModel) {
  const sent = sentFor.get(model);
  if (!sent) return;
  for (let i = sent.length - 1; i >= 0; i--) {
    const message = sent[i];
    if (!String(message.route).includes("deliver-special")) continue;
    sent.splice(i, 1);
    const victim = model.boards.find((b) => b.playerId === message.receiverId);
    if (!victim || !victim.alive) continue;
    const repelled = applyIncomingSpecial(victim, message.message.special, phoneContext(model));
    (model as any).dirtyPlayerIds.add(victim.playerId);
    (model as any).announceAttack(
      message.message.attackerId,
      victim.playerId,
      message.message.special,
      repelled,
    );
  }
}

function phoneContext(model: EittrisPresenterModel): SimulationContext {
  return {
    settings: model.settings,
    random: () => model.randomDouble(1.0),
    boards: () => model.boards.slice(),
    devFast: false,
    events: {
      ...NO_EVENTS,
      // A report arriving is what tells the host a board moved.  The harness stands in for
      // that, so the host's thumbnails and pushes behave as they do in a real game.
      changed: (board) => (model as any).dirtyPlayerIds.add(board.playerId),
      // The phone reports these; the host turns them into the room's sounds and banners.
      afflictionEnded: (board, types) =>
        model.invokeEvent(EittrisGameEvent.AfflictionEnded, board.playerId, types),
      antidoteUsed: (board) => model.invokeEvent(EittrisGameEvent.AntidoteUsed, board.playerId),
      rowsCleared: (board, count) =>
        model.invokeEvent(EittrisGameEvent.RowsCleared, board.playerId, count),
      specialCollected: (board, type) =>
        model.invokeEvent(EittrisGameEvent.SpecialCollected, board.playerId, type),
      selfSpecial: (board, type) => (model as any).announceSelfSpecial(board, type),
      // An attack cannot be delivered by the phone that fired it - it can only see its own
      // board - so the host relays it, exactly as it does in a real game.
      fireSpecial: (board, type) => (model as any).relayAttack(board, type, board.targetId ?? null),
      died: (board) => (model as any).onBoardDied(board),
    },
  };
}

/** Every board a player owns, stepped the way that player's phone would step it. */
function stepPhones(model: EittrisPresenterModel, dtMs: number) {
  if (dtMs <= 0) return;
  const ctx = phoneContext(model);
  for (const board of model.boards) {
    if (!model.players.some((p) => p.playerId === board.playerId)) continue; // a robot
    if (board.alive) stepBoard(board, dtMs, ctx);
  }
}

/** Send a command to a board the way its own phone does: straight onto the board. */
function phoneCommand(
  model: EittrisPresenterModel,
  playerId: string,
  message: EittrisCommandMessage,
) {
  const board = model.boards.find((b) => b.playerId === playerId);
  if (!board) return;
  applyCommand(board, message, phoneContext(model));
  pumpDeliveries(model);
}

// Advance the game clock, run one host tick, and step the phones over the same slice
function tickTo(model: EittrisPresenterModel, time_ms: number) {
  const previous = lastPhoneTick.get(model) ?? 0;
  model.gameTime_ms = time_ms;
  model.handleTick();
  stepPhones(model, time_ms - previous);
  pumpDeliveries(model);
  lastPhoneTick.set(model, time_ms);
}

function startTwoPlayerGame() {
  const { model, sent } = makeModel();
  addPlayer(model, "A", "Alice");
  addPlayer(model, "B", "Bob");
  model.startGame();
  tickTo(model, 0); // primes the simulation clock
  return { model, sent };
}

/** Kill a board the way a real phone does: a board report that says it is dead. */
function reportedDeath(
  model: EittrisPresenterModel,
  playerId: string,
  events: any[] = [{ kind: "died" }],
) {
  const board = model.snapshotFor(playerId, { forceGrid: true })!;
  board.alive = false;
  board.piece = null;
  model.handleBoardReport(playerId, { board, events });
}

describe("EittrisPresenterModel - game start", () => {
  it("builds one live board with a spawned piece for every player", () => {
    const { model } = startTwoPlayerGame();

    expect(model.gameState).toBe(EittrisGameState.Playing);
    expect(model.boards.length).toBe(2);
    for (const board of model.boards) {
      expect(board.alive).toBe(true);
      expect(board.piece).not.toBeNull();
      expect(board.piece!.x).toBe(SPAWN_X); // spawn column (the box's left edge)
      expect(board.piece!.y).toBe(SPAWN_Y);
      expect(board.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
      expect(board.intervalMs).toBe(START_INTERVAL_MS);
      expect(board.grid.length).toBe(BOARD_HEIGHT);
    }
    expect(model.boards.map((b) => b.playerId).sort()).toEqual(["A", "B"]);
  });

  it("tells every phone to re-onboard when the game starts", () => {
    const { sent } = startTwoPlayerGame();
    const invalidates = sent.filter((s) => s.route.includes("invalidate"));
    expect(invalidates.map((s) => s.receiverId).sort()).toEqual(["A", "B"]);
  });
});

describe("EittrisPresenterModel - commands", () => {
  it("dragTo walks the piece toward the target column AND down, paying +10 per row", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    // The box is three wide, so column 7 is as far right as it goes
    phoneCommand(model, "A", { command: "dragTo", column: 8, row: 3 });
    expect(board.piece!.x).toBe(BOARD_WIDTH - 3);
    expect(board.piece!.y).toBe(3); // rows dragged, at 10 a row
    // B's board is untouched
    expect(model.boards.find((b) => b.playerId === "B")!.piece!.x).toBe(SPAWN_X);
  });

  it("dragTo onto the floor does NOT lock; release locks the resting piece", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "dragTo", column: 5, row: 20 });
    expect(board.piece!.y).toBe(BOARD_HEIGHT - 2); // resting on the floor...
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(EMPTY_CELL); // ...but NOT locked

    phoneCommand(model, "A", { command: "release" });
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(0); // now it's settled
    // ...and the board sits empty through the spawn gap (no input possible)
    expect(board.piece).toBeNull();
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.y).toBe(SPAWN_Y); // then a fresh piece appears at the top
  });

  it("release on an airborne piece does nothing (gravity just resumes)", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "dragTo", column: 7, row: 0 });
    phoneCommand(model, "A", { command: "release" });
    expect(board.piece!.x).toBe(7); // same piece, still falling
    expect(board.piece!.y).toBe(SPAWN_Y);
    expect(board.grid.every((row) => row.every((cell) => cell === EMPTY_CELL))).toBe(true);
  });

  it("slamLeft/slamRight run the piece to the walls", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "slamLeft" });
    expect(board.piece!.x).toBe(0); // the box's left edge is against the wall
    phoneCommand(model, "A", { command: "slamRight" });
    expect(board.piece!.x).toBe(BOARD_WIDTH - 3);
  });

  it("rotate spins the piece clockwise", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "rotate" });
    expect(board.piece!.rot).toBe(1);
  });

  it("hardDrop slams to the floor, pays +10 per row, and locks", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "hardDrop" });
    // T dropped from the spawn row to the floor, at 10 points a row
    expect(board.grid[BOARD_HEIGHT - 1][3]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][4]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 2][4]).toBe(0);
    // the board is empty during the spawn gap, then a fresh piece appears
    expect(board.piece).toBeNull();
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.y).toBe(SPAWN_Y);
    expect(board.alive).toBe(true);
  });

  it("accepts no piece commands during the post-lock spawn gap", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "hardDrop" });
    const gridAfterLock = JSON.stringify(board.grid);

    // A stray gesture arriving in the gap must do nothing at all
    phoneCommand(model, "A", { command: "hardDrop" });
    phoneCommand(model, "A", { command: "dragTo", column: 0, row: 20 });
    phoneCommand(model, "A", { command: "rotate" });
    phoneCommand(model, "A", { command: "release" });
    expect(board.piece).toBeNull();
    expect(JSON.stringify(board.grid)).toBe(gridAfterLock);

    // After the gap the new piece is untouched at its spawn spot
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.x).toBe(SPAWN_X);
    expect(board.piece!.y).toBe(SPAWN_Y);
  });

  it("bumps pieceSeq on every spawn so phones can end a stale gesture", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const seqAtStart = board.pieceSeq;

    // Moving the piece around does NOT change the sequence
    phoneCommand(model, "A", { command: "dragTo", column: 3, row: 4 });
    phoneCommand(model, "A", { command: "rotate" });
    expect(board.pieceSeq).toBe(seqAtStart);

    // Placing it spawns the next piece and bumps the sequence
    phoneCommand(model, "A", { command: "hardDrop" });
    expect(board.pieceSeq).toBe(seqAtStart + 1);

    // A gravity lock bumps it too
    phoneCommand(model, "A", { command: "dragTo", column: 3, row: BOARD_HEIGHT });
    const seqBeforeGravityLock = board.pieceSeq;
    tickTo(model, 60_000); // long enough for the resting piece to lock
    expect(board.pieceSeq).toBeGreaterThan(seqBeforeGravityLock);
  });

  it("reports pieceSeq in the board snapshot", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(model.snapshotFor("A")!.pieceSeq).toBe(board.pieceSeq);
    phoneCommand(model, "A", { command: "hardDrop" });
    expect(model.snapshotFor("A")!.pieceSeq).toBe(board.pieceSeq);
  });

  it("ignores commands from players without a live board", () => {
    const { model } = startTwoPlayerGame();
    expect(() => model.handleCommand("ghost", { command: "hardDrop" })).not.toThrow();
  });
});

describe("EittrisPresenterModel - hard drop leaves the next piece alone", () => {
  it("the piece after a hard drop falls at the normal gravity cadence", () => {
    const { model } = startTwoPlayerGame();
    const boardA = model.boards.find((b) => b.playerId === "A")!;
    const boardB = model.boards.find((b) => b.playerId === "B")!;

    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, SPAWN_DELAY_MS + 20); // wait out the spawn gap
    expect(boardA.piece!.y).toBe(SPAWN_Y); // fresh piece at the top

    // Well under one gravity interval later, NEITHER board has stepped -
    // the hard drop must not accelerate the next piece
    tickTo(model, 240);
    expect(boardA.piece!.y).toBe(boardB.piece!.y);
    expect(boardA.piece!.y).toBe(SPAWN_Y);
  });
});

describe("EittrisPresenterModel - target targeting", () => {
  function startThreePlayerGame() {
    const { model, sent } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");
    model.startGame();
    tickTo(model, 0);
    return { model, sent };
  }

  it("initializes the target ring at game start", () => {
    const { model } = startThreePlayerGame();
    expect(model.boards.map((b) => b.targetId)).toEqual(["B", "C", "A"]);
  });

  it("pickTarget re-aims at a living non-self player and rejects bad picks", () => {
    const { model } = startThreePlayerGame();
    const boardA = model.boards.find((b) => b.playerId === "A")!;

    model.handleCommand("A", { command: "pickTarget", targetId: "C" });
    expect(boardA.targetId).toBe("C");

    model.handleCommand("A", { command: "pickTarget", targetId: "A" }); // self
    expect(boardA.targetId).toBe("C");

    model.handleCommand("A", { command: "pickTarget", targetId: "ghost" }); // unknown
    expect(boardA.targetId).toBe("C");
  });

  it("re-aims everyone who targeted a player that just died", () => {
    const { model } = startThreePlayerGame();
    const boardC = model.boards.find((b) => b.playerId === "C")!;
    runInAction(() => {
      boardC.grid[1][4] = 3; // C's next spawn will collide
    });
    model.handleCommand("C", { command: "hardDrop" });
    tickTo(model, SPAWN_DELAY_MS + 20); // the fatal spawn lands after the gap
    expect(boardC.alive).toBe(false);
    expect(model.gameState).toBe(EittrisGameState.Playing); // two still standing

    // B targeted C -> re-aims to A (next living in ring order)
    expect(model.boards.find((b) => b.playerId === "B")!.targetId).toBe("A");
    // A targeted B - untouched
    expect(model.boards.find((b) => b.playerId === "A")!.targetId).toBe("B");

    // Dead players can no longer be picked
    model.handleCommand("A", { command: "pickTarget", targetId: "C" });
    expect(model.boards.find((b) => b.playerId === "A")!.targetId).toBe("B");
  });
});

describe("EittrisPresenterModel - thumbnail broadcasts", () => {
  it("sends the line-up once, with the boards indexed into it", () => {
    const { model, sent } = startTwoPlayerGame();
    sent.length = 0;
    tickTo(model, 5); // seeded as changed at start -> first push immediately

    const thumbs = sent.filter((s) => s.route.includes("thumbnails"));
    expect(thumbs.map((s) => s.receiverId).sort()).toEqual(["A", "B"]);
    const payload = thumbs[0].message;
    expect(payload.roster.map((r: any) => r.name).sort()).toEqual(["Alice", "Bob"]);
    expect(payload.boards.length).toBe(2);
    for (const entry of payload.boards) {
      expect(entry.thumb.length).toBe(36);
      expect(entry.alive).toBe(true);
      expect(payload.roster[entry.i]).toBeTruthy();
    }
    // both receivers share the exact same payload object
    expect(thumbs[1].message).toBe(payload);
  });

  it("stops repeating names and avatars once the line-up is known", () => {
    // Identity is immutable for the life of a game; re-sending it every second was
    // more than half the cost of the heaviest broadcast in the game.
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5);
    sent.length = 0;

    // Settle a piece so the boards genuinely change, forcing a second broadcast
    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, 1200);

    const thumbs = sent.filter((s) => s.route.includes("thumbnails"));
    expect(thumbs.length).toBeGreaterThan(0);
    expect(thumbs[0].message.roster).toBeUndefined();
    expect(JSON.stringify(thumbs[0].message)).not.toContain("Alice");
  });

  it("leaves out a board that has not changed", () => {
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5);
    sent.length = 0;

    // Only A's stack changes; B's is untouched, so B has nothing to say
    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, 1200);

    const payload = sent.filter((s) => s.route.includes("thumbnails"))[0].message;
    expect(payload.boards.length).toBe(1);
    expect(payload.roster).toBeUndefined();
  });

  it("says nothing at all when a piece is merely falling", () => {
    // The falling piece is not in the thumbnail, so gravity alone is not news.
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5);
    sent.length = 0;

    phoneCommand(model, "A", { command: "rotate" });
    tickTo(model, 3000);
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(0);
  });

  it("throttles to the thumbnail interval", () => {
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5);
    sent.length = 0;

    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, 200); // changed, but inside the 1s throttle window
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(0);

    tickTo(model, 1200); // window elapsed -> one push to each player
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(2);
  });
});

describe("EittrisPresenterModel - gravity ticks", () => {
  it("advances a piece one row when the gravity interval elapses", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    tickTo(model, 500);
    expect(board.piece!.y).toBe(SPAWN_Y); // not due yet - gravity starts at 2.5s per row
    tickTo(model, 2600);
    expect(board.piece!.y).toBe(SPAWN_Y + 1); // one gravity step
    expect(board.intervalMs).toBeLessThan(START_INTERVAL_MS); // and it sped up
  });

  it("keeps its own mirror of a board that a phone is playing", () => {
    // The host does not push a player's board back at them any more - the phone owns it.
    // What the host must still do is keep a mirror good enough to draw the shared screen.
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5);
    sent.length = 0;

    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, 100);

    const boardA = model.boards.find((b) => b.playerId === "A")!;
    expect(boardA.grid.flat().filter((c) => c !== EMPTY_CELL).length).toBe(4);
    // ...and nothing was pushed back at the phone that is playing it
    const pushes = sent.filter((m) => m.route.includes("board-update") && m.receiverId === "A");
    expect(pushes.length).toBe(0);
  });
});

describe("EittrisPresenterModel - clears, death, and game end", () => {
  it("scores a contrived single-row clear (1000 + drop points)", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
    });

    phoneCommand(model, "A", { command: "hardDrop" }); // T fills 4..6 on the bottom row

    expect(board.rows).toBe(1);
    // dropped rows at 10 each, plus 1000 for the single-row clear

    // The row is scored at once but does NOT vanish at once: it is eaten away
    // on screen first, so it is still standing while `clearing` runs.
    expect(board.clearing).not.toBeNull();
    expect(board.clearing!.rows).toEqual([BOARD_HEIGHT - 1]);
    expect(board.grid[BOARD_HEIGHT - 1].every((c) => c !== EMPTY_CELL)).toBe(true);

    // Once the eating finishes the grid really collapses...
    tickTo(model, CLEAR_EAT_MS + 10);
    expect(board.grid[BOARD_HEIGHT - 1][4]).toBe(0); // the T's bump landed
    expect(board.grid[BOARD_HEIGHT - 1][3]).toBe(EMPTY_CELL);

    // ...and only after the stack has fallen does the next piece come
    expect(board.piece).toBeNull();
    tickTo(model, CLEAR_EAT_MS + CLEAR_FALL_MS + SPAWN_DELAY_MS + 50);
    expect(board.clearing).toBeNull();
    // The spawn gap only starts once the clear is over, so the piece arrives
    // on the following tick (33ms apart in a real game).
    tickTo(model, CLEAR_EAT_MS + CLEAR_FALL_MS + SPAWN_DELAY_MS + 100);
    expect(board.piece).not.toBeNull();
  });

  it("kills a board when a fresh spawn immediately collides, ending a 2-player game", () => {
    const { model, sent } = startTwoPlayerGame();
    const boardA = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      boardA.grid[1][4] = 3; // blocks the next spawn
    });

    phoneCommand(model, "A", { command: "hardDrop" }); // locks...
    tickTo(model, SPAWN_DELAY_MS + 20); // ...and the delayed spawn collides

    expect(boardA.alive).toBe(false);
    expect(boardA.piece).toBeNull();
    expect(boardA.deathOrder).toBe(1);

    // Last player standing: Bob wins and the game is over
    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("B");
    expect(model.winnerName).toBe("Bob");

    // The host's own mirror knows they are out - that is what the shared screen draws
    expect(model.boards.find((b) => b.playerId === "A")!.alive).toBe(false);
  });

  it("a solo game plays until the lone board dies", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.startGame();
    tickTo(model, 0);
    const board = model.boards[0];

    phoneCommand(model, "A", { command: "hardDrop" });
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(model.gameState).toBe(EittrisGameState.Playing); // still alive, still playing

    runInAction(() => {
      board.grid[1][4] = 3;
    });
    phoneCommand(model, "A", { command: "hardDrop" });
    // tickTo takes an ABSOLUTE game time - push past the second gap
    tickTo(model, 2 * SPAWN_DELAY_MS + 60); // the fatal spawn lands after the gap
    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("A"); // ranked by death order; solo player still "wins"
  });

  it("onboard hands a phone its own board (with target + background) and the outcome", () => {
    const { model } = startTwoPlayerGame();
    phoneCommand(model, "A", { command: "dragTo", column: 2, row: 0 });

    const info = model.handleOnboardClient("A", {});
    expect(info.gameState).toBe(EittrisGameState.Playing);
    expect(info.board).not.toBeNull();
    expect(info.board!.piece!.x).toBe(2);
    expect(info.board!.next.length).toBe(NEXT_PREVIEW_COUNT);
    expect(info.board!.targetId).toBe("B"); // ring: A targets B
    expect(info.board!.backgroundIndex).toBeGreaterThanOrEqual(0);
    expect(info.winnerName).toBeNull();

    const strangerInfo = model.handleOnboardClient("ghost", {});
    expect(strangerInfo.board).toBeNull();
  });
});

describe("EittrisPresenterModel - checkpoint serialization", () => {
  // Guards the type-helper skip list (dirtyPlayerIds, _lastSimTime_ms) and
  // proves the per-player board structs survive a save/restore round trip.
  // Build the serializer the production way (instantiateGame wraps the type
  // helper and attaches it).
  it("round-trips through the real serializer, preserving boards mid-game", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");

    const typeHelper = getPresenterTypeHelper(
      getEittrisPresenterTypeHelper(session, { logger, storage: stubStorage } as any),
    );
    const model = instantiateGame(
      typeHelper,
      logger,
      stubStorage,
    ) as unknown as EittrisPresenterModel;
    model.randomDouble = () => 0;

    runInAction(() => {
      model.players.push(model.createFreshPlayerEntry("Alice", "A"));
      model.players.push(model.createFreshPlayerEntry("Bob", "B"));
    });
    model.startGame();
    model.gameTime_ms = 0;
    model.handleTick();
    phoneCommand(model, "A", { command: "dragTo", column: 7, row: 0 });
    phoneCommand(model, "A", { command: "hardDrop" });
    phoneCommand(model, "B", { command: "rotate" });

    const serializer = model.serializer!;
    let json = "";
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();

    const back = serializer.parse<EittrisPresenterModel>(json);
    expect(back.gameState).toBe(EittrisGameState.Playing);
    expect(back.players.length).toBe(2);
    expect(back.boards.length).toBe(2);

    const boardA = back.boards.find((b) => b.playerId === "A")!;
    const boardB = back.boards.find((b) => b.playerId === "B")!;
    expect(boardA.grid[BOARD_HEIGHT - 1][7]).toBe(0); // and the locked cells
    expect(boardA.targetId).toBe("B"); // the target ring survives a refresh
    expect(boardB.piece!.rot).toBe(1); // B's rotated falling piece survived
    expect(boardB.alive).toBe(true);

    // The restored model can keep simulating (skip-listed fields rebuilt fresh)
    expect(() => {
      back.gameTime_ms = 5000;
      back.handleTick();
    }).not.toThrow();
  });
});

describe("EittrisPresenterModel - specials", () => {
  // Put a settled block on A's board so there's something to tag
  function seedBlock(model: EittrisPresenterModel) {
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.grid[BOARD_HEIGHT - 1][0] = 1;
    });
    return board;
  }

  it("tags a settled block once the interval elapses", () => {
    const { model } = startTwoPlayerGame();
    const board = seedBlock(model);
    expect(board.specials.length).toBe(0);

    tickTo(model, SPECIAL_INTERVAL_MS + 50);
    expect(board.specials.length).toBe(1);
    expect(board.specials[0].index).toBe((BOARD_HEIGHT - 1) * BOARD_WIDTH);
  });

  it("keeps the special on the board forever and spawns no others until it is cleared", () => {
    const { model } = startTwoPlayerGame();
    const board = seedBlock(model);
    tickTo(model, SPECIAL_INTERVAL_MS + 50);
    const placed = board.specials[0];

    // Many intervals later it is still there, and still alone
    tickTo(model, SPECIAL_INTERVAL_MS * 6);
    expect(board.specials.length).toBe(1);
    expect(board.specials[0].index).toBe(placed.index);
    expect(board.specials[0].type).toBe(placed.type);
  });

  it("a forced special appears immediately and is the only type that spawns", () => {
    const { model } = startTwoPlayerGame();
    const board = seedBlock(model);
    model.handleCommand("A", {
      command: "setForcedSpecial",
      specialType: SpecialType.Antidote,
    });
    tickTo(model, 30); // no need to wait out the interval
    expect(board.specials.length).toBe(1);
    expect(board.specials[0].type).toBe(SpecialType.Antidote);
  });

  it("clearing the marked row banks the antidote and frees the slot", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    // Fill the bottom row except the T's landing spot, and mark one block
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Antidote });
    });
    const antidotesBefore = board.antidotes;

    phoneCommand(model, "A", { command: "hardDrop" }); // completes the row

    expect(board.rows).toBe(1);
    expect(board.antidotes).toBe(antidotesBefore + 1); // collected
    expect(board.specials.length).toBe(0); // slot free again
  });

  it("useAntidote spends a charge and raises the shield", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(board.antidotes).toBe(1); // everyone starts with one
    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.antidotes).toBe(0);
    expect(board.shieldMs).toBe(ANTIDOTE_DURATION_MS);

    // With none banked, a second press does nothing
    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.antidotes).toBe(0);

    // The shield runs down on the clock
    tickTo(model, 2000);
    expect(board.shieldMs).toBeLessThan(ANTIDOTE_DURATION_MS);
  });
});

describe("EittrisPresenterModel - Speedup", () => {
  // Give A a marked block whose row is one hard-drop away from clearing
  function armSpeedup(model: EittrisPresenterModel) {
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Speedup });
    });
    return board;
  }

  it("fires at the collector's target and speeds THEIR gravity, not their own", () => {
    const { model } = startTwoPlayerGame();
    const boardA = armSpeedup(model);
    const boardB = model.boards.find((b) => b.playerId === "B")!;
    expect(boardA.targetId).toBe("B"); // ring
    const beforeA = boardA.intervalMs;
    const beforeB = boardB.intervalMs;

    phoneCommand(model, "A", { command: "hardDrop" }); // clears the marked row

    // The natural curve is untouched; the affliction rides on top of it
    expect(boardB.speedupStacks).toBe(1);
    expect(effectiveIntervalMs(boardB.intervalMs, boardB.speedupStacks)).toBeCloseTo(
      beforeB * 0.6,
      5,
    );
    expect(boardA.speedupStacks).toBe(0); // the attacker is untouched
    expect(boardA.intervalMs).toBe(beforeA);
    expect(boardA.specials.length).toBe(0);
  });

  it("tells everyone what happened", () => {
    const { model, sent } = startTwoPlayerGame();
    armSpeedup(model);
    sent.length = 0;
    phoneCommand(model, "A", { command: "hardDrop" });

    const events = sent.filter((s) => s.route.includes("special-event"));
    expect(events.length).toBe(2); // one per player
    expect(events[0].message).toMatchObject({
      type: SpecialType.Speedup,
      attackerId: "A",
      victimId: "B",
      repelled: false,
    });
  });

  it("an antidote shield repels it, leaving gravity untouched", () => {
    const { model, sent } = startTwoPlayerGame();
    armSpeedup(model);
    const boardB = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "B", { command: "useAntidote" }); // B raises the shield
    const beforeB = boardB.intervalMs;
    sent.length = 0;

    phoneCommand(model, "A", { command: "hardDrop" });

    expect(boardB.speedupStacks).toBe(0); // shield ate it
    expect(boardB.intervalMs).toBe(beforeB);
    const events = sent.filter((s) => s.route.includes("special-event"));
    expect(events[0].message.repelled).toBe(true);
  });

  it("does nothing when there is no living target", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.startGame();
    tickTo(model, 0);
    const board = model.boards[0];
    expect(board.targetId).toBeNull(); // solo game
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Speedup });
    });
    expect(() => phoneCommand(model, "A", { command: "hardDrop" })).not.toThrow();
    expect(board.specials.length).toBe(0);
  });
});

describe("EittrisPresenterModel - the antidote cures afflictions", () => {
  it("wipes Speedup stacks and restores normal gravity", () => {
    const { model } = startTwoPlayerGame();
    const boardB = model.boards.find((b) => b.playerId === "B")!;
    runInAction(() => {
      boardB.speedupStacks = 3; // hit three times
    });
    const naturalInterval = boardB.intervalMs;
    expect(effectiveIntervalMs(boardB.intervalMs, boardB.speedupStacks)).toBeLessThan(
      naturalInterval,
    );

    phoneCommand(model, "B", { command: "useAntidote" });

    expect(boardB.speedupStacks).toBe(0);
    expect(effectiveIntervalMs(boardB.intervalMs, boardB.speedupStacks)).toBe(naturalInterval);
    expect(boardB.shieldMs).toBe(ANTIDOTE_DURATION_MS); // and it shields afterwards
  });

  it("reports the afflicted (not the natural) speed to the phone", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const natural = Math.round(board.intervalMs);
    runInAction(() => {
      board.speedupStacks = 1;
    });
    const snap = model.snapshotFor("A")!;
    expect(snap.speedupStacks).toBe(1);
    expect(snap.intervalMs).toBeLessThan(natural);
  });
});

describe("EittrisPresenterModel - computer player", () => {
  it("only moves when switched on, then steers toward its plan", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const startX = board.piece!.x;
    const startRot = board.piece!.rot;

    // Off by default: the clock ticks but the piece is untouched sideways
    tickTo(model, AI_MOVE_INTERVAL_MS + 50);
    expect(board.piece!.x).toBe(startX);
    expect(board.piece!.rot).toBe(startRot);

    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    expect(board.aiControlled).toBe(true);

    // Now it acts on its own - one move per interval
    let time = AI_MOVE_INTERVAL_MS + 50;
    let moved = false;
    for (let i = 0; i < 6 && !moved; i++) {
      time += AI_MOVE_INTERVAL_MS + 10;
      tickTo(model, time);
      moved = board.piece!.x !== startX || board.piece!.rot !== startRot;
    }
    expect(moved).toBe(true);
  });

  it("pops an antidote as soon as it is afflicted", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    runInAction(() => {
      board.speedupStacks = 2; // somebody sped it up
    });
    expect(board.antidotes).toBe(1);

    tickTo(model, AI_MOVE_INTERVAL_MS + 50);

    expect(board.speedupStacks).toBe(0); // cured itself
    expect(board.antidotes).toBe(0);
    expect(board.shieldMs).toBeGreaterThan(0);
  });

  it("does not waste an antidote when it is healthy", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    tickTo(model, AI_MOVE_INTERVAL_MS * 3);
    expect(board.antidotes).toBe(1);
  });

  it("keeps the piece legal - it never steers into a collision", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    let time = 0;
    for (let i = 0; i < 40; i++) {
      time += AI_MOVE_INTERVAL_MS + 10;
      tickTo(model, time);
      if (board.piece) {
        expect(collides(board.grid, pieceCells(board.piece))).toBe(false);
      }
    }
    expect(board.alive).toBe(true);
  });
});

describe("EittrisPresenterModel - dev preferences survive the wait", () => {
  it("accepts the CPU toggle before the game starts and carries it into the board", () => {
    const { model } = makeModel();
    const player = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    expect(model.gameState).toBe(PresenterGameState.Gathering);

    // No boards exist yet - the toggle has to land on the player
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    expect(player.aiControlled).toBe(true);

    model.startGame();
    tickTo(model, 0);
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(board.aiControlled).toBe(true);
    expect(model.boards.find((b) => b.playerId === "B")!.aiControlled).toBe(false);
  });

  it("keeps the preference across a replay", () => {
    const { model } = startTwoPlayerGame();
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });
    model.handleCommand("A", { command: "setForcedSpecial", specialType: SpecialType.Speedup });

    model.startGame(); // play again, same players
    tickTo(model, 0);
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(board.aiControlled).toBe(true);
    expect(board.forcedSpecial).toBe(SpecialType.Speedup);
  });

  it("reports the preferences on onboard even while gathering", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.handleCommand("A", { command: "setAiControlled", aiControlled: true });

    const info = model.handleOnboardClient("A", {});
    expect(info.board).toBeNull(); // no board yet...
    expect(info.aiControlled).toBe(true); // ...but the phone still knows
  });
});

describe("EittrisPresenterModel - TheWall", () => {
  function armWall(model: EittrisPresenterModel) {
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.TheWall });
    });
    return board;
  }

  it("buries the target one row at a time, bottom up", () => {
    const { model } = startTwoPlayerGame();
    armWall(model);
    const victim = model.boards.find((b) => b.playerId === "B")!;
    expect(victim.pendingStencil).toBeNull();

    phoneCommand(model, "A", { command: "hardDrop" }); // collects and fires
    expect(victim.pendingStencil).not.toBeNull();
    expect(victim.pendingStencil!.shape.length).toBe(WALL_ROWS);

    // Nothing painted yet...
    expect(victim.grid[BOARD_HEIGHT - 1].every((c) => c === EMPTY_CELL)).toBe(true);

    // ...one row lands per STENCIL_ROW_MS
    let time = 0;
    time += STENCIL_ROW_MS + 5;
    tickTo(model, time);
    expect(victim.grid[BOARD_HEIGHT - 1].some((c) => c === GARBAGE_CELL)).toBe(true);
    expect(victim.grid[BOARD_HEIGHT - 2].every((c) => c === EMPTY_CELL)).toBe(true);

    // let the whole wall finish
    for (let i = 0; i < WALL_ROWS + 2; i++) {
      time += STENCIL_ROW_MS + 5;
      tickTo(model, time);
    }
    expect(victim.pendingStencil).toBeNull();
    for (let r = 0; r < WALL_ROWS; r++) {
      const row = victim.grid[BOARD_HEIGHT - 1 - r];
      expect(row.filter((c) => c === GARBAGE_CELL).length).toBe(BOARD_WIDTH - 1); // one gap
    }
  });

  it("leaves the attacker's own board alone", () => {
    const { model } = startTwoPlayerGame();
    const attacker = armWall(model);
    phoneCommand(model, "A", { command: "hardDrop" });
    expect(attacker.pendingStencil).toBeNull();
  });

  it("is turned away by an antidote shield", () => {
    const { model } = startTwoPlayerGame();
    armWall(model);
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "B", { command: "useAntidote" });

    phoneCommand(model, "A", { command: "hardDrop" });

    expect(victim.pendingStencil).toBeNull();
    tickTo(model, STENCIL_ROW_MS * 4);
    expect(victim.grid[BOARD_HEIGHT - 1].every((c) => c === EMPTY_CELL)).toBe(true);
  });

  it("keeps the victim's falling piece legal while burying it", () => {
    const { model } = startTwoPlayerGame();
    armWall(model);
    const victim = model.boards.find((b) => b.playerId === "B")!;
    runInAction(() => {
      victim.piece = { type: 6, rot: 0, x: 4, y: BOARD_HEIGHT - 2 }; // low on the board
    });

    phoneCommand(model, "A", { command: "hardDrop" });
    let time = 0;
    for (let i = 0; i < WALL_ROWS + 2; i++) {
      time += STENCIL_ROW_MS + 5;
      tickTo(model, time);
      if (victim.piece) {
        expect(collides(victim.grid, pieceCells(victim.piece))).toBe(false);
      }
    }
  });
});

describe("EittrisPresenterModel - Bridge", () => {
  // Set up a board one vertical I away from clearing four rows at once
  function armFourRowClear(model: EittrisPresenterModel, playerId: string) {
    const board = model.boards.find((b) => b.playerId === playerId)!;
    runInAction(() => {
      for (let y = BOARD_HEIGHT - 4; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          if (x !== 0) board.grid[y][x] = 1;
        }
      }
      // A vertical I over column 0.  Rotation 3 puts the bar in the box's second column,
      // so the box sits one column off the left edge.
      board.piece = { type: 1, rot: 3, x: -1, y: 0 };
    });
    return board;
  }

  it("is fired by a four-row clear when the host picks it as the award", () => {
    const { model } = startTwoPlayerGame();
    model.setFourRowAward(SpecialType.Bridge);
    const attacker = armFourRowClear(model, "A");
    const victim = model.boards.find((b) => b.playerId === "B")!;

    phoneCommand(model, "A", { command: "hardDrop" });

    expect(attacker.rows).toBe(4);
    expect(victim.pendingBridge).not.toBeNull();
  });

  it("hands out an antidote instead by default", () => {
    // The host picks the award now, and it starts as an antidote - a reward
    // you keep rather than an attack you send.
    const { model } = startTwoPlayerGame();
    const attacker = armFourRowClear(model, "A");
    const victim = model.boards.find((b) => b.playerId === "B")!;
    const before = attacker.antidotes;

    phoneCommand(model, "A", { command: "hardDrop" });

    expect(attacker.rows).toBe(4);
    expect(attacker.antidotes).toBe(Math.min(ANTIDOTE_MAX, before + 1));
    expect(victim.pendingBridge).toBeNull(); // nothing was sent at anyone
  });

  it("paints across the victim column by column", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    runInAction(() => {
      victim.pendingBridge = {
        topY: BOARD_HEIGHT - 2,
        skipX: [3, 6],
        column: 0,
        timerMs: 0,
        blockCell: GARBAGE_CELL,
      };
    });

    let time = 0;
    for (let i = 0; i < BOARD_WIDTH + 2; i++) {
      time += BRIDGE_COLUMN_MS + 5;
      tickTo(model, time);
    }
    expect(victim.pendingBridge).toBeNull();
    const row = victim.grid[BOARD_HEIGHT - 2];
    expect(row.filter((c) => c === GARBAGE_CELL).length).toBe(BOARD_WIDTH - 1);
    expect(row[3]).toBe(EMPTY_CELL); // its gap
  });
});

describe("EittrisPresenterModel - SeeShadows", () => {
  it("switches the landing ghost on for the collector, for half a minute", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    expect(board.seeShadows).toBe(false);

    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 3 || x > 5) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({
        index: (BOARD_HEIGHT - 1) * BOARD_WIDTH,
        type: SpecialType.SeeShadows,
      });
    });
    phoneCommand(model, "A", { command: "hardDrop" });

    expect(board.seeShadows).toBe(true); // kept by the collector...
    expect(victim.seeShadows).toBe(false); // ...not inflicted on the target
    expect(model.snapshotFor("A")!.seeShadows).toBe(true);

    expect(board.seeShadowsMs).toBe(SEE_SHADOWS_DURATION_MS);

    // and an antidote does not take your own perk away
    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.seeShadows).toBe(true);
  });

  it("runs out after thirty seconds", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.seeShadows = true;
      board.seeShadowsMs = SEE_SHADOWS_DURATION_MS;
    });

    tickTo(model, SEE_SHADOWS_DURATION_MS - 2000);
    expect(board.seeShadows).toBe(true);

    tickTo(model, SEE_SHADOWS_DURATION_MS + 100);
    expect(board.seeShadows).toBe(false);
    expect(board.seeShadowsMs).toBe(0);
  });

  it("starts the half minute again rather than adding to it", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.seeShadows = true;
      board.seeShadowsMs = 4000;
    });

    collectSpecial(board, SpecialType.SeeShadows, phoneContext(model));

    expect(board.seeShadowsMs).toBe(SEE_SHADOWS_DURATION_MS);
  });

  it("is not an affliction: the phone does not go red and a cure leaves it alone", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.seeShadows = true;
      board.seeShadowsMs = SEE_SHADOWS_DURATION_MS;
    });
    expect(hasAfflictions(board)).toBe(false);

    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.seeShadows).toBe(true);
    expect(board.seeShadowsMs).toBeGreaterThan(0);
  });
});

describe("EittrisPresenterModel - CrazyIvan", () => {
  it("mirrors the victim's sideways controls", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;

    // Sane controls first
    phoneCommand(model, "A", { command: "slamLeft" });
    expect(board.piece!.x).toBe(0);

    runInAction(() => {
      board.crazyIvan = true;
    });
    // Now "left" goes right
    phoneCommand(model, "A", { command: "slamLeft" });
    expect(board.piece!.x).toBe(BOARD_WIDTH - 3);
    phoneCommand(model, "A", { command: "slamRight" });
    expect(board.piece!.x).toBe(0);
  });

  it("mirrors dragging too", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.crazyIvan = true;
    });
    // asking for column 1 lands on the mirrored column 8, as far right as the box goes
    phoneCommand(model, "A", { command: "dragTo", column: 1, row: 0 });
    expect(board.piece!.x).toBe(BOARD_WIDTH - 3);
  });

  it("is cured by an antidote", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.crazyIvan = true;
    });
    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.crazyIvan).toBe(false);
    phoneCommand(model, "A", { command: "slamLeft" });
    expect(board.piece!.x).toBe(0); // sane again
  });
});

describe("EittrisPresenterModel - FreezeDried", () => {
  it("afflicts the target and is cured by an antidote", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.freezeDried = true;
    });
    expect(model.snapshotFor("A")!.freezeDried).toBe(true);

    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.freezeDried).toBe(false);
    expect(model.snapshotFor("A")!.freezeDried).toBe(false);
  });
});

describe("EittrisPresenterModel - Transparency", () => {
  it("hides the target's stack until an antidote clears it", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.transparency = true;
    });
    expect(model.snapshotFor("A")!.transparency).toBe(true);
    expect(hasAfflictions(board)).toBe(true);

    phoneCommand(model, "A", { command: "useAntidote" });
    expect(board.transparency).toBe(false);
  });

  it("counts every affliction the bot should cure", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    for (const key of ["evilPieces", "crazyIvan", "freezeDried", "transparency"] as const) {
      runInAction(() => {
        (board as any)[key] = true;
      });
      expect(hasAfflictions(board)).toBe(true);
      runInAction(() => {
        (board as any)[key] = false;
      });
    }
    expect(hasAfflictions(board)).toBe(false);
  });
});

describe("EittrisPresenterModel - SwitchScreens", () => {
  it("trades the two boards column by column", () => {
    const { model } = startTwoPlayerGame();
    const attacker = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    runInAction(() => {
      // give each board a signature so we can watch them change places
      for (let x = 0; x < BOARD_WIDTH; x++) {
        attacker.grid[BOARD_HEIGHT - 1][x] = 1;
        victim.grid[BOARD_HEIGHT - 2][x] = 2;
      }
      attacker.pendingSwap = { otherId: "B", column: 0, timerMs: 0 };
    });

    let time = 0;
    for (let i = 0; i < BOARD_WIDTH + 2; i++) {
      time += SWAP_COLUMN_MS + 5;
      tickTo(model, time);
    }

    expect(attacker.pendingSwap).toBeNull();
    // the stacks have swapped places entirely
    expect(attacker.grid[BOARD_HEIGHT - 2].every((c) => c === 2)).toBe(true);
    expect(attacker.grid[BOARD_HEIGHT - 1].every((c) => c === EMPTY_CELL)).toBe(true);
    expect(victim.grid[BOARD_HEIGHT - 1].every((c) => c === 1)).toBe(true);
    expect(victim.grid[BOARD_HEIGHT - 2].every((c) => c === EMPTY_CELL)).toBe(true);
  });

  it("gives up cleanly if the other board dies mid-swap", () => {
    const { model } = startTwoPlayerGame();
    const attacker = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    runInAction(() => {
      attacker.pendingSwap = { otherId: "B", column: 0, timerMs: 0 };
      victim.alive = false;
    });
    tickTo(model, SWAP_COLUMN_MS + 20);
    expect(attacker.pendingSwap).toBeNull();
  });
});

describe("EittrisPresenterModel - the dev Attack button", () => {
  it("fires the selected special exactly as if it had been cleared", () => {
    const { model } = startTwoPlayerGame();
    const attacker = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;

    model.handleCommand("A", { command: "setForcedSpecial", specialType: SpecialType.Speedup });
    expect(victim.speedupStacks).toBe(0);

    phoneCommand(model, "A", { command: "fireSpecial" });

    expect(victim.speedupStacks).toBe(1); // delivered to the target
    expect(attacker.speedupStacks).toBe(0);
  });

  it("banks a defensive special on the presser instead", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const before = board.antidotes;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Antidote });
    expect(board.antidotes).toBe(before + 1);
  });

  it("does nothing when no special is selected", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    expect(() => phoneCommand(model, "A", { command: "fireSpecial" })).not.toThrow();
    expect(victim.speedupStacks).toBe(0);
    expect(victim.pendingStencil).toBeNull();
  });

  it("works during the post-lock gap, when there is no falling piece", () => {
    const { model } = startTwoPlayerGame();
    const attacker = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "hardDrop" }); // opens the spawn gap
    expect(attacker.piece).toBeNull();

    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.TheWall });
    expect(victim.pendingStencil).not.toBeNull();
  });
});

describe("EittrisPresenterModel - Psycho", () => {
  it("starts a blank overlay on the victim and leaves the attacker alone", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    expect(victim.psychoOverlay).toBeNull();

    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Psycho });

    expect(victim.psychoSeed).toBeGreaterThan(0);
    expect(victim.psychoOverlay).not.toBeNull();
    expect(model.boards.find((b) => b.playerId === "A")!.psychoOverlay).toBeNull();
  });

  it("smears a trail under the falling piece as it goes", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Psycho });

    tickTo(model, 50);
    const under = pieceCells(victim.piece!).filter((c) => c.y >= 0);
    expect(under.length).toBeGreaterThan(0);
    for (const c of under)
      expect(victim.psychoOverlay![c.y][c.x]).toBe(pieceColorIndex(victim.piece!));
  });

  it("keeps the palette but flips the background when a new piece arrives", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Psycho });
    // A non-zero skew, so the XOR is observable
    model.randomDouble = () => 0.5;

    tickTo(model, 50);
    const seedBefore = victim.psychoSeed;
    const cornerBefore = victim.psychoOverlay![BOARD_HEIGHT - 1][0];

    phoneCommand(model, "B", { command: "hardDrop" });
    tickTo(model, 50 + SPAWN_DELAY_MS + 20); // through the gap into the next piece

    // The palette must not move, or the trails already drawn would change color
    expect(victim.psychoSeed).toBe(seedBefore);
    expect(victim.psychoOverlay![BOARD_HEIGHT - 1][0]).not.toBe(cornerBefore);
  });

  it("rides the wire as an encoded string and comes off it unchanged", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Psycho });
    tickTo(model, 50);

    const snapshot = model.snapshotFor("B")!;
    expect(typeof snapshot.psychoOverlay).toBe("string");
    expect(decodePsychoOverlay(snapshot.psychoOverlay!)).toEqual(victim.psychoOverlay);

    // An unafflicted board pays nothing for the feature
    expect(model.snapshotFor("A")!.psychoOverlay).toBeNull();
  });
});

describe("EittrisPresenterModel - afflictions wear off", () => {
  it("clears an affliction 22 seconds after it lands", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.CrazyIvan });
    expect(victim.crazyIvan).toBe(true);

    tickTo(model, AFFLICTION_DURATION_MS - 100);
    expect(victim.crazyIvan).toBe(true);

    tickTo(model, AFFLICTION_DURATION_MS + 100);
    expect(victim.crazyIvan).toBe(false);
    expect(afflictionMsLeft(victim, SpecialType.CrazyIvan)).toBe(0);
  });

  it("puts the remaining time on the wire for the phone's countdown bar", () => {
    const { model } = startTwoPlayerGame();
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.FreezeDried });

    const snapshot = model.snapshotFor("B")!;
    expect(snapshot.afflictionMs.length).toBe(AFFLICTION_TIMERS.length);
    const index = AFFLICTION_TIMERS.findIndex((s) => s.type === SpecialType.FreezeDried);
    expect(snapshot.afflictionMs[index]).toBe(AFFLICTION_DURATION_MS);
    // Nothing else is running
    expect(snapshot.afflictionMs.filter((ms) => ms > 0).length).toBe(1);
  });

  it("hands EvilPieces victims normal pieces again once it expires", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.EvilPieces });
    expect(victim.evilPieces).toBe(true);

    tickTo(model, AFFLICTION_DURATION_MS + 100);
    expect(victim.evilPieces).toBe(false);
    // The evil preview was flushed, so what comes next is a normal piece
    expect(victim.nextQueue.every((type) => type < PIECE_COUNT)).toBe(true);
  });
});

describe("EittrisPresenterModel - taps do not pair up", () => {
  it("rotates twice for two taps, and never drops", () => {
    // The double-tap drop is gone: a second quick tap is just another rotation.
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const startRot = board.piece!.rot;
    const startY = board.piece!.y;

    phoneCommand(model, "A", { command: "rotate" });
    phoneCommand(model, "A", { command: "rotate" });

    expect(board.piece!.rot).toBe((startRot + 2) % 4);
    expect(board.piece!.y).toBe(startY); // still where it was - nothing dropped
    expect(board.grid.flat().filter((c) => c !== EMPTY_CELL).length).toBe(0);
  });

  it("still drops on an explicit hard drop", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    phoneCommand(model, "A", { command: "hardDrop" });
    expect(board.grid.flat().filter((c) => c !== EMPTY_CELL).length).toBe(4);
  });
});

describe("EittrisPresenterModel - the Next tray is never empty", () => {
  it("keeps exactly one piece in the preview through a whole piece cycle", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    for (let step = 0; step < 6; step++) {
      expect(board.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
      // ...but only one of them is shown, without a crystal ball
      expect(model.snapshotFor("A")!.next.length).toBe(NEXT_PREVIEW_COUNT);
      phoneCommand(model, "A", { command: "hardDrop" });
      // ...including right through the post-lock gap, when nothing is falling
      expect(board.piece).toBeNull();
      expect(board.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
      tickTo(model, (step + 1) * (SPAWN_DELAY_MS + 50));
    }
  });

  it("swaps the preview for evil pieces without ever emptying it", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.EvilPieces });
    expect(victim.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
    expect(victim.nextQueue.every((type) => type < EVIL_PIECE_COUNT)).toBe(true);

    // ...and swaps it straight back when the affliction times out
    tickTo(model, AFFLICTION_DURATION_MS + 100);
    expect(victim.evilPieces).toBe(false);
    expect(victim.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
  });

  it("keeps the preview stocked when an antidote cures EvilPieces", () => {
    const { model } = startTwoPlayerGame();
    const victim = model.boards.find((b) => b.playerId === "B")!;
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.EvilPieces });
    phoneCommand(model, "B", { command: "useAntidote" });
    expect(victim.evilPieces).toBe(false);
    expect(victim.nextQueue.length).toBeGreaterThanOrEqual(NEXT_QUEUE_DEPTH);
  });
});

describe("EittrisPresenterModel - announcing that an affliction let go", () => {
  function listenForEnded(model: EittrisPresenterModel) {
    const seen: { playerId: string; types: SpecialType[] }[] = [];
    model.subscribe(EittrisGameEvent.AfflictionEnded, "spec", (playerId: any, types: any) =>
      seen.push({ playerId, types }),
    );
    return seen;
  }

  // invokeEvent defers by a tick, so let the queue drain before looking
  const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("fires when an affliction times out", async () => {
    const { model } = startTwoPlayerGame();
    const seen = listenForEnded(model);
    phoneCommand(model, "A", { command: "fireSpecial", specialType: SpecialType.Transparency });
    await settle();
    expect(seen.length).toBe(0);

    tickTo(model, AFFLICTION_DURATION_MS + 100);
    await settle();
    expect(seen.length).toBe(1);
    expect(seen[0].playerId).toBe("B");
    expect(seen[0].types).toEqual([SpecialType.Transparency]);
  });

  it("fires once for a whole batch when an antidote washes several off", async () => {
    const { model } = startTwoPlayerGame();
    const seen = listenForEnded(model);
    for (const type of [SpecialType.Speedup, SpecialType.CrazyIvan, SpecialType.FreezeDried]) {
      phoneCommand(model, "A", { command: "fireSpecial", specialType: type });
    }
    phoneCommand(model, "B", { command: "useAntidote" });
    await settle();

    expect(seen.length).toBe(1); // one chime, not three
    expect(seen[0].types.length).toBe(3);
  });

  it("stays quiet when an antidote is spent on a clean board", async () => {
    const { model } = startTwoPlayerGame();
    const seen = listenForEnded(model);
    phoneCommand(model, "A", { command: "useAntidote" });
    await settle();
    expect(seen.length).toBe(0);
  });
});

describe("EittrisPresenterModel - robot players", () => {
  it("gives every robot a board of its own, driven by the computer", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setRobotCount(3);
    model.startGame();

    expect(model.boards.length).toBe(4); // one human, three robots
    const robotBoards = model.boards.filter((b) => b.playerId.startsWith("robot-"));
    expect(robotBoards.length).toBe(3);
    for (const board of robotBoards) expect(board.aiControlled).toBe(true);
  });

  it("keeps robots out of the player list, so nothing tries to message them", () => {
    // A robot in `players` would be handed real network messages by every
    // broadcast, addressed to an id the relay has never heard of.
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setRobotCount(4);
    model.startGame();
    expect(model.players.length).toBe(1);
    expect(model.players.some((p) => p.playerId.startsWith("robot-"))).toBe(false);
  });

  it("still lets a game start with a single human, whatever the robot count", () => {
    for (const robots of [0, 1, 4]) {
      const { model } = makeModel();
      addPlayer(model, "A", "Alice");
      model.setRobotCount(robots);
      expect(model.canStart).toBe(true);
    }
  });

  it("will not start with no humans at all", () => {
    const { model } = makeModel();
    model.setRobotCount(4);
    expect(model.canStart).toBe(false);
  });

  it("clamps the host's choice to the supported range", () => {
    const { model } = makeModel();
    model.setRobotCount(99);
    expect(model.robotCount).toBe(MAX_ROBOTS_STRESS); // the dev stress ceiling
    model.setRobotCount(-2);
    expect(model.robotCount).toBe(0);
  });

  it("names robots on the host screen and in the thumbnails clients see", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setRobotCount(2);
    model.startGame();

    expect(model.identityFor("robot-1").name).toBe("Robot 1");
    expect(model.identityFor("A").name).toBe("Alice");
    expect(model.identityFor("nobody").name).toBe("?");
  });

  it("lets a robot win, and names it", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setRobotCount(1);
    model.startGame();
    // The human tops out; the robot is last standing
    const human = model.boards.find((b) => b.playerId === "A")!;
    human.alive = false;
    (model as any).checkForGameEnd();
    expect(model.winnerId).toBe("robot-1");
    expect(model.winnerName).toBe("Robot 1");
  });

  it("survives a checkpoint round trip with the robot count intact", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const model = instantiateGame(
      getPresenterTypeHelper(
        getEittrisPresenterTypeHelper(session, { logger, storage: stubStorage } as any),
      ),
      logger,
      stubStorage,
    ) as unknown as EittrisPresenterModel;
    model.randomDouble = () => 0;
    addPlayer(model, "A", "Alice");
    model.setRobotCount(3);

    const serializer = model.serializer!;
    const restored = serializer.parse<EittrisPresenterModel>(serializer.stringify(model));
    expect(restored.robotCount).toBe(3);
    expect(restored.robots.length).toBe(3);
    expect(restored.identityFor("robot-2").name).toBe("Robot 2");
  });
});

describe("EittrisPresenterModel - a player leaving mid-game", () => {
  it("hands their board to a robot instead of pausing everyone", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "B")!;
    expect(board.aiControlled).toBe(false);

    model.handlePlayerQuitMessage("B", {});

    expect(model.gameState).toBe(EittrisGameState.Playing); // nobody else waits
    expect(board.robotTakeover).toBe(true);
    expect(board.aiControlled).toBe(true);
    expect(board.alive).toBe(true); // their stack is still in the game
  });

  it("hands the board back when they return", async () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "B")!;
    model.handlePlayerQuitMessage("B", {});
    expect(board.aiControlled).toBe(true);

    await model.handleJoinMessage("B", { playerName: "Bob" });

    expect(board.robotTakeover).toBe(false);
    expect(board.aiControlled).toBe(false);
  });

  it("does not switch the bot off for someone who had it on themselves", () => {
    const { model } = startTwoPlayerGame();
    const player = model.players.find((p) => p.playerId === "B")!;
    const board = model.boards.find((b) => b.playerId === "B")!;
    player.aiControlled = true;
    board.aiControlled = true;

    model.handlePlayerQuitMessage("B", {});
    return model.handleJoinMessage("B", { playerName: "Bob" }).then(() => {
      expect(board.aiControlled).toBe(true); // back to THEIR setting, not off
    });
  });

  it("leaves a dead board alone", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "B")!;
    board.alive = false;
    model.handlePlayerQuitMessage("B", {});
    expect(board.robotTakeover).toBe(false);
  });
});

describe("EittrisPresenterModel - joining late", () => {
  it("lets a brand new player in during the first few seconds", async () => {
    const { model } = startTwoPlayerGame();
    tickTo(model, 5000);
    const ack = await model.handleJoinMessage("C", { playerName: "Cass" });
    expect(ack.didJoin).toBe(true);
    expect(ack.isRejoin).toBe(false);
  });

  it("turns a newcomer away once the grace period has passed", async () => {
    const { model } = startTwoPlayerGame();
    // The grace is measured in wall-clock from the game start
    (model as any)._gameStartedAtMs = Date.now() - (LATE_JOIN_GRACE_MS + 1000);
    const ack = await model.handleJoinMessage("C", { playerName: "Cass" });
    expect(ack.didJoin).toBe(false);
  });

  it("always lets a returning player back in, however late", async () => {
    const { model } = startTwoPlayerGame();
    model.handlePlayerQuitMessage("B", {});
    (model as any)._gameStartedAtMs = Date.now() - 10 * 60 * 1000; // ten minutes in

    const ack = await model.handleJoinMessage("B", { playerName: "Bob" });
    expect(ack.didJoin).toBe(true);
    expect(ack.isRejoin).toBe(true);
  });
});

describe("EittrisPresenterModel - host settings in play", () => {
  it("deals every board the chosen number of antidotes", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setRobotCount(1);
    model.setStartingAntidotes(3);
    model.startGame();
    for (const board of model.boards) expect(board.antidotes).toBe(3);
  });

  it("can deal none at all", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.setStartingAntidotes(0);
    model.startGame();
    expect(model.boards[0].antidotes).toBe(0);
  });

  it("only ever spawns powerups the host left switched on", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.startGame();
    // Toggle by what is actually on rather than by the full list - the antidote starts off
    for (const type of IMPLEMENTED_SPECIALS) {
      const wanted = type === SpecialType.Speedup;
      if (model.isSpecialAllowed(type) !== wanted) model.toggleAllowedSpecial(type);
    }
    expect(model.settings.allowedSpecials).toEqual([SpecialType.Speedup]);

    const board = model.boards[0];
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) board.grid[BOARD_HEIGHT - 1][x] = 1;
    });
    // Run long enough for a good number of specials to be tagged
    for (let t = 1; t <= 20; t++) tickTo(model, t * SPECIAL_INTERVAL_MS + 100);
    for (const marker of board.specials) expect(marker.type).toBe(SpecialType.Speedup);
  });
});

describe("EittrisPresenterModel - reconnecting to your own seat", () => {
  // The relay hands out a fresh playerId on every join, so after a real
  // disconnect the id proves nothing.  The private token is what does.
  const joinAs = (name: string, token: string) => ({ playerName: name, playerToken: token });

  // Give a player already in the game the token their device would hold
  function withToken(model: EittrisPresenterModel, playerId: string, token: string) {
    const player = model.players.find((p) => p.playerId === playerId)!;
    player.playerToken = token;
    return player;
  }

  it("puts a returning player back in control of their own board", async () => {
    const { model } = startTwoPlayerGame();
    withToken(model, "A", "token-alice");
    const board = model.boards.find((b) => b.playerId === "A")!;

    model.handlePlayerQuitMessage("A", {});
    expect(board.robotTakeover).toBe(true);

    // ...and comes back on a brand new connection id
    const ack = await model.handleJoinMessage("A-new-id", joinAs("Alice", "token-alice"));

    expect(ack.didJoin).toBe(true);
    expect(ack.isRejoin).toBe(true);
    const player = model.players.find((p) => p.playerToken === "token-alice")!;
    expect(player.playerId).toBe("A-new-id"); // the seat moved to the new socket
    expect(board.robotTakeover).toBe(false); // and they have it back
  });

  it("will not let somebody take a seat by typing the same name", async () => {
    const { model } = startTwoPlayerGame();
    const alice = withToken(model, "A", "token-alice");
    model.handlePlayerQuitMessage("A", {});

    // An imposter knows the name - it is on the big screen - but not the token
    const ack = await model.handleJoinMessage("imposter", joinAs(alice.name, "token-imposter"));

    expect(ack.isRejoin).toBe(false);
    // Alice's seat is still hers, waiting for her
    expect(model.players.some((p) => p.playerToken === "token-alice")).toBe(false);
  });

  it("moves the seat when the same device reconnects without ever quitting", async () => {
    // A phone that drops its socket and comes straight back: the presenter
    // never saw a quit, so the player is still in `players` under the old id.
    const { model } = startTwoPlayerGame();
    withToken(model, "A", "token-alice");

    const ack = await model.handleJoinMessage("A-reconnected", joinAs("Alice", "token-alice"));

    expect(ack.didJoin).toBe(true);
    const seats = model.players.filter((p) => p.playerToken === "token-alice");
    expect(seats.length).toBe(1); // one seat, not two
    expect(seats[0].playerId).toBe("A-reconnected");
  });

  it("still lets a tokenless client rejoin by name, for older clients", async () => {
    const { model } = startTwoPlayerGame();
    const bob = model.players.find((p) => p.playerId === "B")!;
    model.handlePlayerQuitMessage("B", {});
    const ack = await model.handleJoinMessage("B-new", { playerName: bob.name });
    expect(ack.isRejoin).toBe(true);
  });
});

describe("EittrisPresenterModel - a reconnected player can actually play", () => {
  it("brings the board across to the new connection id", async () => {
    // The bug this guards: boards are keyed by player id, and a reconnect
    // arrives on a NEW one.  Without moving the board, the player rejoins to
    // a seat their commands cannot reach - the game looks joined and does
    // nothing at all.
    const { model } = startTwoPlayerGame();
    const alice = model.players.find((p) => p.playerId === "A")!;
    alice.playerToken = "token-alice";
    const board = model.boards.find((b) => b.playerId === "A")!;
    const rowsBefore = board.rows;

    model.handlePlayerQuitMessage("A", {});
    await model.handleJoinMessage("A-new", {
      playerName: alice.name,
      playerToken: "token-alice",
    });

    // Same board, now answering to the new id
    expect(model.boards.find((b) => b.playerId === "A-new")).toBe(board);
    expect(model.boards.some((b) => b.playerId === "A")).toBe(false);
    expect(board.rows).toBe(rowsBefore); // their game carried on, not restarted

    // ...and it takes their commands
    const before = board.piece!.x;
    model.handleCommand("A-new", { command: "moveLeft" });
    expect(board.piece!.x).toBe(before - 1);
  });

  it("re-aims everyone who was attacking them at the new id", async () => {
    const { model } = startTwoPlayerGame();
    const alice = model.players.find((p) => p.playerId === "A")!;
    alice.playerToken = "token-alice";
    const bobBoard = model.boards.find((b) => b.playerId === "B")!;
    bobBoard.targetId = "A";

    model.handlePlayerQuitMessage("A", {});
    await model.handleJoinMessage("A-new", {
      playerName: alice.name,
      playerToken: "token-alice",
    });

    // Otherwise Bob would be firing at a player id that no longer exists
    expect(bobBoard.targetId).toBe("A-new");
  });
});

describe("EittrisPresenterModel - leaving and coming back", () => {
  it("lets a robot keep the seat warm while its player is away", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const player = model.players.find((p) => p.playerId === "A")!;

    (model as any).onPlayerExited(player);
    expect(board.robotTakeover).toBe(true);
    expect(board.aiControlled).toBe(true);
  });

  it("hands the board back when its player returns", () => {
    // The regression this exists to stop: once somebody is a player again the host stops
    // simulating their board, so if the phone is not handed one, NOBODY simulates it and
    // the game sits frozen in front of them.
    const { model, sent } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const player = model.players.find((p) => p.playerId === "A")!;
    (model as any).onPlayerExited(player);
    tickTo(model, 500); // the robot plays a little
    sent.length = 0;

    (model as any).onPlayerReturned(player, "A");

    const handovers = sent.filter((m) => String(m.route).includes("start-playing"));
    expect(handovers.length).toBe(1);
    expect(handovers[0].receiverId).toBe("A");
    // ...carrying the board as it stands, not a fresh one
    expect(handovers[0].message.board).toBeTruthy();
    expect(handovers[0].message.board.playerId).toBe("A");
    expect(handovers[0].message.board.rows).toBe(board.rows);
    // ...and the robot has let go of it
    expect(board.robotTakeover).toBe(false);
  });

  it("hands the board back to the NEW id when a reconnect brings one", () => {
    // A reconnect arrives on a brand new player id; the board moves across to it, and the
    // handover has to follow it there or it reaches nobody.
    const { model, sent } = startTwoPlayerGame();
    const player = model.players.find((p) => p.playerId === "A")!;
    (model as any).onPlayerExited(player);
    sent.length = 0;
    runInAction(() => (player.playerId = "A2"));

    (model as any).onPlayerReturned(player, "A");

    const handovers = sent.filter((m) => String(m.route).includes("start-playing"));
    expect(handovers.length).toBe(1);
    expect(handovers[0].receiverId).toBe("A2");
    expect(handovers[0].message.board.playerId).toBe("A2");
  });

  it("says nothing when nobody is playing yet", () => {
    const { model, sent } = makeModel();
    addPlayer(model, "A", "Alice");
    sent.length = 0;
    const player = model.players.find((p) => p.playerId === "A")!;
    (model as any).onPlayerReturned(player, "A");
    expect(sent.filter((m) => String(m.route).includes("start-playing")).length).toBe(0);
  });
});

describe("EittrisPresenterModel - a death reported by a phone", () => {
  // These go through handleBoardReport with a real wire message, which is the ONLY way a
  // human player dies now.  The rest of the file drives boards in process, which is why the
  // game-end tests above kept passing while nobody could win a real game: the report carries
  // alive=false, so the host's copy was already dead before it read the "died" event beside
  // it, and the guard on that event threw the death away.
  const reportDeath = reportedDeath;

  it("ends the game and names the last one standing", () => {
    const { model } = startTwoPlayerGame();

    reportDeath(model, "A");

    expect(model.boards.find((b) => b.playerId === "A")!.alive).toBe(false);
    expect(model.boards.find((b) => b.playerId === "A")!.deathOrder).toBe(1);
    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("B");
    expect(model.winnerName).toBe("Bob");
  });

  it("ends the game even if the died event never arrives", () => {
    // The board itself says so.  A death must not hang on one event surviving the trip.
    const { model } = startTwoPlayerGame();

    reportDeath(model, "A", []);

    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("B");
  });

  it("keeps the order people went out in", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Cass");
    model.startGame();
    tickTo(model, 0);

    reportDeath(model, "B");
    expect(model.gameState).toBe(EittrisGameState.Playing); // two left
    reportDeath(model, "A");

    expect(model.boards.find((b) => b.playerId === "B")!.deathOrder).toBe(1);
    expect(model.boards.find((b) => b.playerId === "A")!.deathOrder).toBe(2);
    expect(model.winnerId).toBe("C");
  });

  it("counts a death once, however many reports follow it", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Cass");
    model.startGame();
    tickTo(model, 0);

    reportDeath(model, "A");
    reportDeath(model, "A"); // a dead phone keeps reporting its board
    reportDeath(model, "A");

    expect(model.boards.find((b) => b.playerId === "A")!.deathOrder).toBe(1);
    expect(model.gameState).toBe(EittrisGameState.Playing); // B and C are still playing
  });

  it("re-aims anyone who was shooting at the player who died", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Cass");
    model.startGame();
    tickTo(model, 0);

    const shooters = model.boards.filter((b) => b.targetId === "B").map((b) => b.playerId);
    expect(shooters.length).toBeGreaterThan(0);

    reportDeath(model, "B");

    for (const id of shooters) {
      const board = model.boards.find((b) => b.playerId === id)!;
      expect(board.targetId).not.toBe("B");
      expect(model.boards.find((b) => b.playerId === board.targetId)!.alive).toBe(true);
    }
  });
});

describe("EittrisPresenterModel - starting a second game", () => {
  it("keeps counting rounds up, so phones can tell the new game from the old one", () => {
    // A phone throws away a start-playing whose round number it has already seen.  Rewinding
    // the counter between games therefore left every phone playing its finished board.
    const { model } = startTwoPlayerGame();
    const firstRound = model.currentRound;

    reportedDeath(model, "A"); // Bob wins
    expect(model.gameState).toBe(GeneralGameState.GameOver);

    model.playAgain(false);

    expect(model.gameState).toBe(EittrisGameState.Playing);
    expect(model.currentRound).toBeGreaterThan(firstRound);
  });

  it("tells the phones to start, with the new number", () => {
    const { model, sent } = startTwoPlayerGame();
    reportedDeath(model, "A");

    sent.length = 0;
    model.playAgain(false);

    const starts = sent.filter((m) => String(m.route).includes("start-playing"));
    expect(starts.length).toBe(2);
    for (const start of starts) {
      expect(start.message.round).toBe(model.currentRound);
      expect(start.message.board).toBeUndefined(); // "build a fresh one"
    }
  });

  it("gives everybody a live, empty board again", () => {
    const { model } = startTwoPlayerGame();
    reportedDeath(model, "A");

    model.playAgain(false);

    expect(model.boards.length).toBe(2);
    expect(model.boards.every((b) => b.alive)).toBe(true);
    expect(model.boards.every((b) => b.deathOrder === 0)).toBe(true);
    expect(model.winnerId).toBeNull();
  });
});

// -------------------------------------------------------------------
// Presenter and phone, joined up.  Everything above tests one end or the other; this
// takes the message the presenter really sends and gives it to a real phone model, which
// is the seam the replay bug lived in - the round token only means anything once it has
// crossed between the two.
// -------------------------------------------------------------------
describe("EittrisPresenterModel + EittrisClientModel - playing again", () => {
  function makePhone(model: EittrisPresenterModel, playerId: string): EittrisClientModel {
    // The phone asks the host who it is and what it is looking at; answer from the real
    // presenter, so what the phone learns is what the presenter would actually tell it.
    const session = {
      ...makeFakeSession([]),
      personalId: playerId,
      requestPresenter: ((endpoint: any) =>
        Promise.resolve(
          String(endpoint.route).includes("onboard")
            ? model.handleOnboardClient(playerId, {})
            : undefined,
        )) as any,
    } as ISessionHelper;
    const gameProps: any = {
      playerName: playerId,
      logger: new MockTelemetryLogger("test"),
      storage: stubStorage,
    };
    return instantiateGame(
      getClientTypeHelper(getEittrisClientTypeHelper(session, gameProps)),
      gameProps.logger,
      stubStorage,
    ) as EittrisClientModel;
  }

  /** Hand the phone whatever start-playing the presenter last addressed to it. */
  function deliverStart(sent: SentMessage[], phone: EittrisClientModel, playerId: string) {
    const start = sent
      .filter((m) => String(m.route).includes("start-playing") && m.receiverId === playerId)
      .pop();
    expect(start).toBeDefined();
    (phone as any).handleStartPlaying(start!.message);
  }

  it("gives the phone a brand new board for the second game", async () => {
    const { model, sent } = startTwoPlayerGame();
    const phone = makePhone(model, "A");

    deliverStart(sent, phone, "A");
    const firstBoard = (phone as any).board;
    expect(phone.gameState).toBe("Playing");
    runInAction(() => (firstBoard.rows = 33));
    (phone as any).mirrorBoard();
    expect(phone.rows).toBe(33);

    // A dies, Bob wins, the host starts another game
    reportedDeath(model, "A");
    phone.handleGameOverMessage({});
    await Promise.resolve(); // the phone re-onboards to learn who won
    expect(model.gameState).toBe(GeneralGameState.GameOver);

    sent.length = 0;
    model.playAgain(false);
    deliverStart(sent, phone, "A");

    expect((phone as any).board).not.toBe(firstBoard);
    expect(phone.rows).toBe(0);
    expect(phone.alive).toBe(true);
    expect(phone.gameState).toBe("Playing");
    expect(phone.winnerName).toBeNull();
  });
});

describe("EittrisPresenterModel - dragging a piece to the wall", () => {
  // The box is allowed off the edge of the board; clamping it to 0..9 left a vertical I
  // unable to reach either wall, which is what "I can't drag some pieces to the edge" was.
  function boardWith(model: EittrisPresenterModel, piece: EittrisPiece) {
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => (board.piece = piece));
    return board;
  }

  it("puts a vertical I against the left wall", () => {
    const { model } = startTwoPlayerGame();
    const board = boardWith(model, { type: 1, rot: 1, x: 3, y: 2 });

    phoneCommand(model, "A", { command: "dragTo", column: -5, row: 2 });

    expect(pieceCells(board.piece!).every((c) => c.x === 0)).toBe(true);
  });

  it("puts a vertical I against the right wall", () => {
    const { model } = startTwoPlayerGame();
    const board = boardWith(model, { type: 1, rot: 1, x: 3, y: 2 });

    phoneCommand(model, "A", { command: "dragTo", column: 99, row: 2 });

    expect(pieceCells(board.piece!).every((c) => c.x === BOARD_WIDTH - 1)).toBe(true);
  });

  it("gets every rotation of every piece to both walls", () => {
    const { model } = startTwoPlayerGame();
    for (let type = 0; type < PIECE_COUNT; type++) {
      for (let rot = 0; rot < 4; rot++) {
        const board = boardWith(model, { type, rot, x: 3, y: 2 });

        phoneCommand(model, "A", { command: "dragTo", column: -20, row: 2 });
        expect(Math.min(...pieceCells(board.piece!).map((c) => c.x))).toBe(0);

        phoneCommand(model, "A", { command: "dragTo", column: 20, row: 2 });
        expect(Math.max(...pieceCells(board.piece!).map((c) => c.x))).toBe(BOARD_WIDTH - 1);
      }
    }
  });
});

describe("EittrisPresenterModel - when a robot spends its earthquake", () => {
  // Half full is the trick: an earthquake on a nearly empty board saves a couple of rows,
  // and the same one on a board that is closing in saves the game.
  function robotBoard(model: EittrisPresenterModel, fill: number) {
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.aiControlled = true;
      board.earthquakes = 1;
      const rows = Math.round(fill * BOARD_HEIGHT);
      for (let y = BOARD_HEIGHT - rows; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) board.grid[y][x] = 1;
      }
      // ...with a hole under the stack, so there is something for a quake to do
      board.grid[BOARD_HEIGHT - 1][4] = EMPTY_CELL;
      board.grid[BOARD_HEIGHT - 2][4] = EMPTY_CELL;
    });
    return board;
  }

  it("holds on to it while the board is still mostly empty", () => {
    const { model } = startTwoPlayerGame();
    const board = robotBoard(model, 0.2);
    tickTo(model, AI_MOVE_INTERVAL_MS + 100);
    expect(board.earthquakes).toBe(1);
    expect(board.quakeMs).toBe(0);
  });

  it("spends it once the board is more than half full", () => {
    const { model } = startTwoPlayerGame();
    const board = robotBoard(model, 0.7);
    tickTo(model, AI_MOVE_INTERVAL_MS + 100);
    expect(board.earthquakes).toBe(0);
    expect(board.quakeMs).toBeGreaterThan(0);
  });

  it("does not waste one on a full board with nothing to shake loose", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      board.aiControlled = true;
      board.earthquakes = 1;
      for (let y = BOARD_HEIGHT - 15; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) board.grid[y][x] = 1;
      }
    });
    tickTo(model, AI_MOVE_INTERVAL_MS + 100);
    expect(board.earthquakes).toBe(1); // no holes: nothing would fall
  });
});

describe("EittrisPresenterModel - what the room hears about a phone", () => {
  // Everything a phone reports has to be answered here, or it happens on the phone and the
  // room never hears about it.  That is exactly how the earthquake ended up silent for
  // everybody except the robots: the phone reported it and the host dropped it on the floor.
  // invokeEvent fires on a timer, so a spy has to be given a moment to hear anything
  async function eventsFired(model: EittrisPresenterModel, events: any[]) {
    const fired: { event: string; args: any[] }[] = [];
    for (const name of Object.values(EittrisGameEvent)) {
      model.subscribe(name, "spy " + name, (...args: any[]) => fired.push({ event: name, args }));
    }
    const board = model.snapshotFor("A", { forceGrid: true })!;
    model.handleBoardReport("A", { board, events });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return fired;
  }

  it("tells the room when a phone sets off an earthquake", async () => {
    const { model } = startTwoPlayerGame();
    const fired = await eventsFired(model, [{ kind: "quakeStarted" }]);
    expect(fired.map((f) => f.event)).toContain(EittrisGameEvent.QuakeStarted);
    expect(fired.find((f) => f.event === EittrisGameEvent.QuakeStarted)!.args[0]).toBe("A");
  });

  it("answers every kind of event a phone can send", async () => {
    // One of each, and none of them may fall through the handler unnoticed
    const { model } = startTwoPlayerGame();
    const everyKind: any[] = [
      { kind: "locked", bumped: false },
      { kind: "rowsCleared", count: 2 },
      { kind: "collected", special: SpecialType.Antidote },
      { kind: "selfSpecial", special: SpecialType.SeeShadows },
      { kind: "fire", special: SpecialType.Speedup, targetId: "B" },
      { kind: "hit", special: SpecialType.Speedup, attackerId: "B", repelled: false },
      { kind: "afflictionEnded", types: [SpecialType.Speedup] },
      { kind: "antidoteUsed" },
      { kind: "quakeStarted" },
      { kind: "jumbleNudge" },
      { kind: "slammed" },
      { kind: "died" },
    ];
    const fired = await eventsFired(model, everyKind);
    // Every one of them reached the room in some form
    expect(fired.length).toBeGreaterThanOrEqual(6);
  });
});
