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
import { BOARD_HEIGHT, BOARD_WIDTH, EMPTY_CELL, START_INTERVAL_MS } from "./eittrisLogic";
import { SPAWN_DELAY_MS } from "./GameSettings";

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
