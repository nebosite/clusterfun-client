import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState, GeneralGameState } from "libs";
import {
  EittrisPresenterModel,
  EittrisGameState,
  EittrisPlayer,
  getEittrisPresenterTypeHelper,
} from "./PresenterModel";
import {
  ANTIDOTE_DURATION_MS,
  BRIDGE_COLUMN_MS,
  collides,
  GARBAGE_CELL,
  pieceCells,
  STENCIL_ROW_MS,
  WALL_ROWS,
  effectiveIntervalMs,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EMPTY_CELL,
  SPECIAL_INTERVAL_MS,
  SpecialType,
  START_INTERVAL_MS,
} from "./eittrisLogic";
import { AI_MOVE_INTERVAL_MS, SPAWN_DELAY_MS } from "./GameSettings";

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
  return { model, sent };
}

function addPlayer(model: EittrisPresenterModel, id: string, name: string): EittrisPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  runInAction(() => model.players.push(p));
  return p;
}

// Advance the game clock and run one tick
function tickTo(model: EittrisPresenterModel, time_ms: number) {
  model.gameTime_ms = time_ms;
  model.handleTick();
}

function startTwoPlayerGame() {
  const { model, sent } = makeModel();
  addPlayer(model, "A", "Alice");
  addPlayer(model, "B", "Bob");
  model.startGame();
  tickTo(model, 0); // primes the simulation clock
  return { model, sent };
}

describe("EittrisPresenterModel - game start", () => {
  it("builds one live board with a spawned piece for every player", () => {
    const { model } = startTwoPlayerGame();

    expect(model.gameState).toBe(EittrisGameState.Playing);
    expect(model.boards.length).toBe(2);
    for (const board of model.boards) {
      expect(board.alive).toBe(true);
      expect(board.piece).not.toBeNull();
      expect(board.piece!.x).toBe(5); // spawn column
      expect(board.piece!.y).toBe(0);
      expect(board.nextQueue.length).toBe(2); // phones preview the next 2
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
    model.handleCommand("A", { command: "dragTo", column: 8, row: 3 });
    expect(board.piece!.x).toBe(8);
    expect(board.piece!.y).toBe(3);
    expect(board.score).toBe(30); // 3 dragged rows
    // B's board is untouched
    expect(model.boards.find((b) => b.playerId === "B")!.piece!.x).toBe(5);
  });

  it("dragTo onto the floor does NOT lock; release locks the resting piece", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "dragTo", column: 5, row: 20 });
    expect(board.piece!.y).toBe(BOARD_HEIGHT - 1); // resting on the floor...
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(EMPTY_CELL); // ...but NOT locked

    model.handleCommand("A", { command: "release" });
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(0); // now it's settled
    // ...and the board sits empty through the spawn gap (no input possible)
    expect(board.piece).toBeNull();
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.y).toBe(0); // then a fresh piece appears at the top
  });

  it("release on an airborne piece does nothing (gravity just resumes)", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "dragTo", column: 7, row: 0 });
    model.handleCommand("A", { command: "release" });
    expect(board.piece!.x).toBe(7); // same piece, still falling
    expect(board.piece!.y).toBe(0);
    expect(board.grid.every((row) => row.every((cell) => cell === EMPTY_CELL))).toBe(true);
  });

  it("slamLeft/slamRight run the piece to the walls", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "slamLeft" });
    expect(board.piece!.x).toBe(1); // T occupies x-1..x+1
    model.handleCommand("A", { command: "slamRight" });
    expect(board.piece!.x).toBe(8);
  });

  it("rotate spins the piece clockwise", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "rotate" });
    expect(board.piece!.rot).toBe(1);
  });

  it("hardDrop slams to the floor, pays +10 per row, and locks", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "hardDrop" });
    // T dropped 20 rows and locked flat on the bottom row
    expect(board.score).toBe(200);
    expect(board.grid[BOARD_HEIGHT - 1][4]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][6]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 2][5]).toBe(0);
    // the board is empty during the spawn gap, then a fresh piece appears
    expect(board.piece).toBeNull();
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.y).toBe(0);
    expect(board.alive).toBe(true);
  });

  it("accepts no piece commands during the post-lock spawn gap", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    model.handleCommand("A", { command: "hardDrop" });
    const gridAfterLock = JSON.stringify(board.grid);
    const scoreAfterLock = board.score;

    // A stray gesture arriving in the gap must do nothing at all
    model.handleCommand("A", { command: "hardDrop" });
    model.handleCommand("A", { command: "dragTo", column: 0, row: 20 });
    model.handleCommand("A", { command: "rotate" });
    model.handleCommand("A", { command: "release" });
    expect(board.piece).toBeNull();
    expect(JSON.stringify(board.grid)).toBe(gridAfterLock);
    expect(board.score).toBe(scoreAfterLock);

    // After the gap the new piece is untouched at its spawn spot
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(board.piece!.x).toBe(5);
    expect(board.piece!.y).toBe(0);
  });

  it("bumps pieceSeq on every spawn so phones can end a stale gesture", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const seqAtStart = board.pieceSeq;

    // Moving the piece around does NOT change the sequence
    model.handleCommand("A", { command: "dragTo", column: 3, row: 4 });
    model.handleCommand("A", { command: "rotate" });
    expect(board.pieceSeq).toBe(seqAtStart);

    // Placing it spawns the next piece and bumps the sequence
    model.handleCommand("A", { command: "hardDrop" });
    expect(board.pieceSeq).toBe(seqAtStart + 1);

    // A gravity lock bumps it too
    model.handleCommand("A", { command: "dragTo", column: 3, row: BOARD_HEIGHT });
    const seqBeforeGravityLock = board.pieceSeq;
    tickTo(model, 60_000); // long enough for the resting piece to lock
    expect(board.pieceSeq).toBeGreaterThan(seqBeforeGravityLock);
  });

  it("reports pieceSeq in the board snapshot", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(model.snapshotFor("A")!.pieceSeq).toBe(board.pieceSeq);
    model.handleCommand("A", { command: "hardDrop" });
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

    model.handleCommand("A", { command: "hardDrop" });
    tickTo(model, SPAWN_DELAY_MS + 20); // wait out the spawn gap
    expect(boardA.piece!.y).toBe(0); // fresh piece at the top

    // Well under one gravity interval later, NEITHER board has stepped -
    // the hard drop must not accelerate the next piece
    tickTo(model, 240);
    expect(boardA.piece!.y).toBe(boardB.piece!.y);
    expect(boardA.piece!.y).toBe(0);
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
      boardC.grid[0][5] = 3; // C's next spawn will collide
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
  it("broadcasts one shared roster to every player soon after start", () => {
    const { model, sent } = startTwoPlayerGame();
    sent.length = 0;
    tickTo(model, 5); // seeded as changed at start -> first push immediately

    const thumbs = sent.filter((s) => s.route.includes("thumbnails"));
    expect(thumbs.map((s) => s.receiverId).sort()).toEqual(["A", "B"]);
    const payload = thumbs[0].message;
    expect(payload.players.length).toBe(2);
    for (const entry of payload.players) {
      expect(entry.thumb.length).toBe(36);
      expect(entry.alive).toBe(true);
      expect(["Alice", "Bob"]).toContain(entry.name);
    }
    // both receivers share the exact same payload object
    expect(thumbs[1].message).toBe(payload);
  });

  it("throttles to the thumbnail interval and only sends when boards changed", () => {
    const { model, sent } = startTwoPlayerGame();
    tickTo(model, 5); // consumes the seeded push
    sent.length = 0;

    tickTo(model, 50); // nothing changed since -> silence
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(0);

    model.handleCommand("A", { command: "rotate" });
    tickTo(model, 200); // changed, but within the 1s throttle window
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(0);

    tickTo(model, 1100); // window elapsed -> one push to each player
    expect(sent.filter((s) => s.route.includes("thumbnails")).length).toBe(2);
  });
});

describe("EittrisPresenterModel - gravity ticks", () => {
  it("advances a piece one row when the gravity interval elapses", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    tickTo(model, 500);
    expect(board.piece!.y).toBe(0); // not due yet
    tickTo(model, 1100);
    expect(board.piece!.y).toBe(1); // one gravity step
    expect(board.intervalMs).toBeLessThan(START_INTERVAL_MS); // and it sped up
  });

  it("pushes a board update only to the player whose board changed", () => {
    const { model, sent } = startTwoPlayerGame();
    sent.length = 0;
    model.handleCommand("A", { command: "rotate" }); // only A's board is dirty
    tickTo(model, 10); // too soon for gravity - just flushes dirt
    const updates = sent.filter((s) => s.route.includes("board-update"));
    expect(updates.length).toBe(1);
    expect(updates[0].receiverId).toBe("A");
    expect(updates[0].message.piece.rot).toBe(1);
    expect(typeof updates[0].message.grid).toBe("string");
    expect(updates[0].message.grid.length).toBe(BOARD_WIDTH * BOARD_HEIGHT);
  });
});

describe("EittrisPresenterModel - clears, death, and game end", () => {
  it("scores a contrived single-row clear (1000 + drop points)", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
    });

    model.handleCommand("A", { command: "hardDrop" }); // T fills 4..6 on the bottom row

    expect(board.rows).toBe(1);
    expect(board.score).toBe(200 + 1000); // 20 dropped rows + single-row clear
    // the cleared row leaves only the T's bump, which shifted to the bottom
    expect(board.grid[BOARD_HEIGHT - 1][5]).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][4]).toBe(EMPTY_CELL);
  });

  it("kills a board when a fresh spawn immediately collides, ending a 2-player game", () => {
    const { model, sent } = startTwoPlayerGame();
    const boardA = model.boards.find((b) => b.playerId === "A")!;
    runInAction(() => {
      boardA.grid[0][5] = 3; // blocks the next spawn at (5,0)
    });

    model.handleCommand("A", { command: "hardDrop" }); // locks...
    tickTo(model, SPAWN_DELAY_MS + 20); // ...and the delayed spawn collides

    expect(boardA.alive).toBe(false);
    expect(boardA.piece).toBeNull();
    expect(boardA.deathOrder).toBe(1);

    // Last player standing: Bob wins and the game is over
    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("B");
    expect(model.winnerName).toBe("Bob");

    // The dead player's final board state was pushed before the announcement
    const updatesToA = sent.filter((s) => s.route.includes("board-update") && s.receiverId === "A");
    expect(updatesToA.length).toBeGreaterThan(0);
    expect(updatesToA[updatesToA.length - 1].message.alive).toBe(false);
  });

  it("a solo game plays until the lone board dies", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.startGame();
    tickTo(model, 0);
    const board = model.boards[0];

    model.handleCommand("A", { command: "hardDrop" });
    tickTo(model, SPAWN_DELAY_MS + 20);
    expect(model.gameState).toBe(EittrisGameState.Playing); // still alive, still playing

    runInAction(() => {
      board.grid[0][5] = 3;
    });
    model.handleCommand("A", { command: "hardDrop" });
    // tickTo takes an ABSOLUTE game time - push past the second gap
    tickTo(model, 2 * SPAWN_DELAY_MS + 60); // the fatal spawn lands after the gap
    expect(model.gameState).toBe(GeneralGameState.GameOver);
    expect(model.winnerId).toBe("A"); // ranked by death order; solo player still "wins"
  });

  it("onboard hands a phone its own board (with target + background) and the outcome", () => {
    const { model } = startTwoPlayerGame();
    model.handleCommand("A", { command: "dragTo", column: 2, row: 0 });

    const info = model.handleOnboardClient("A", {});
    expect(info.gameState).toBe(EittrisGameState.Playing);
    expect(info.board).not.toBeNull();
    expect(info.board!.piece!.x).toBe(2);
    expect(info.board!.next.length).toBe(2);
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
    model.handleCommand("A", { command: "dragTo", column: 7, row: 0 });
    model.handleCommand("A", { command: "hardDrop" });
    model.handleCommand("B", { command: "rotate" });

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
    expect(boardA.score).toBe(200); // the hard drop's points survived
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
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Antidote });
    });
    const antidotesBefore = board.antidotes;

    model.handleCommand("A", { command: "hardDrop" }); // completes the row

    expect(board.rows).toBe(1);
    expect(board.antidotes).toBe(antidotesBefore + 1); // collected
    expect(board.specials.length).toBe(0); // slot free again
  });

  it("useAntidote spends a charge and raises the shield", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    expect(board.antidotes).toBe(1); // everyone starts with one
    model.handleCommand("A", { command: "useAntidote" });
    expect(board.antidotes).toBe(0);
    expect(board.shieldMs).toBe(ANTIDOTE_DURATION_MS);

    // With none banked, a second press does nothing
    model.handleCommand("A", { command: "useAntidote" });
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
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
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

    model.handleCommand("A", { command: "hardDrop" }); // clears the marked row

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
    model.handleCommand("A", { command: "hardDrop" });

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
    model.handleCommand("B", { command: "useAntidote" }); // B raises the shield
    const beforeB = boardB.intervalMs;
    sent.length = 0;

    model.handleCommand("A", { command: "hardDrop" });

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
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH, type: SpecialType.Speedup });
    });
    expect(() => model.handleCommand("A", { command: "hardDrop" })).not.toThrow();
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

    model.handleCommand("B", { command: "useAntidote" });

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
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
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

    model.handleCommand("A", { command: "hardDrop" }); // collects and fires
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
    model.handleCommand("A", { command: "hardDrop" });
    expect(attacker.pendingStencil).toBeNull();
  });

  it("is turned away by an antidote shield", () => {
    const { model } = startTwoPlayerGame();
    armWall(model);
    const victim = model.boards.find((b) => b.playerId === "B")!;
    model.handleCommand("B", { command: "useAntidote" });

    model.handleCommand("A", { command: "hardDrop" });

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

    model.handleCommand("A", { command: "hardDrop" });
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
  it("is fired automatically by a four-row clear", () => {
    const { model } = startTwoPlayerGame();
    const attacker = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    // Four rows ready to go, with a vertical I about to complete them
    runInAction(() => {
      for (let y = BOARD_HEIGHT - 4; y < BOARD_HEIGHT; y++) {
        for (let x = 0; x < BOARD_WIDTH; x++) {
          if (x !== 0) attacker.grid[y][x] = 1;
        }
      }
      attacker.piece = { type: 1, rot: 0, x: 0, y: 1 }; // I piece over column 0
    });

    model.handleCommand("A", { command: "hardDrop" });

    expect(attacker.rows).toBe(4);
    expect(victim.pendingBridge).not.toBeNull(); // a free Bridge for the target
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
  it("switches the landing ghost on for the collector, permanently", () => {
    const { model } = startTwoPlayerGame();
    const board = model.boards.find((b) => b.playerId === "A")!;
    const victim = model.boards.find((b) => b.playerId === "B")!;
    expect(board.seeShadows).toBe(false);

    runInAction(() => {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        if (x < 4 || x > 6) board.grid[BOARD_HEIGHT - 1][x] = 1;
      }
      board.specials.push({
        index: (BOARD_HEIGHT - 1) * BOARD_WIDTH,
        type: SpecialType.SeeShadows,
      });
    });
    model.handleCommand("A", { command: "hardDrop" });

    expect(board.seeShadows).toBe(true); // kept by the collector...
    expect(victim.seeShadows).toBe(false); // ...not inflicted on the target
    expect(model.snapshotFor("A")!.seeShadows).toBe(true);

    // and an antidote does not take your own perk away
    model.handleCommand("A", { command: "useAntidote" });
    expect(board.seeShadows).toBe(true);
  });
});
