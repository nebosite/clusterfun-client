import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getClientTypeHelper, GeneralGameState } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { EittrisClientModel, EittrisClientState, getEittrisClientTypeHelper } from "./ClientModel";
import { EittrisBoardSnapshot, EittrisSpecialEventMessage } from "./eittrisEndpoints";
import { applyIncomingSpecial, stepBoard } from "./eittrisSimulation";
import {
  AFFLICTION_TIMERS,
  BOARD_HEIGHT,
  EARTHQUAKE_SHAKE_MS,
  EMPTY_CELL,
  BOARD_WIDTH,
  defaultSettings,
  emptyGrid,
  encodeGrid,
  makeBoard,
  SpecialType,
} from "./eittrisLogic";

// -------------------------------------------------------------------
// The phone model is a thin mirror, but it IS checkpointed - and a restored
// checkpoint hands collections back as PLAIN arrays.  These tests pin that
// applying a board update still works after a round trip (a MobX-only API
// like observableArray.replace() would throw here).
// -------------------------------------------------------------------

const stubStorage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

function makeFakeSession(): ISessionHelper {
  const fake: Partial<ISessionHelper> = {
    roomId: "ROOM1",
    personalId: "ME",
    personalSecret: "secret",
    sendMessage: () => {},
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

function makeClient(): EittrisClientModel {
  const session = makeFakeSession();
  const gameProps: any = {
    playerName: "Tester",
    logger: new MockTelemetryLogger("test"),
    storage: stubStorage,
  };
  return instantiateGame(
    getClientTypeHelper(getEittrisClientTypeHelper(session, gameProps)),
    gameProps.logger,
    stubStorage,
  ) as EittrisClientModel;
}

function snapshot(overrides: Partial<EittrisBoardSnapshot> = {}): EittrisBoardSnapshot {
  return {
    grid: encodeGrid(emptyGrid()),
    piece: { type: 0, rot: 0, x: 5, y: 0 },
    next: [1, 2],
    rows: 1,
    alive: true,
    intervalMs: 900,
    backgroundIndex: 2,
    targetId: "B",
    pieceSeq: 3,
    specials: [{ i: (BOARD_HEIGHT - 1) * BOARD_WIDTH, t: SpecialType.Antidote }],
    antidotes: 2,
    earthquakes: 0,
    quakeMs: 0,
    speedupStacks: 1,
    slowdownStacks: 0,
    seeShadows: false,
    crystalBall: false,
    evilPieces: false,
    crazyIvan: false,
    freezeDried: false,
    transparency: false,
    clearing: null,
    afflictionMs: [],
    psychoSeed: 0,
    psychoOverlay: null,
    shieldMs: 4000,
    forcedSpecial: null,
    aiControlled: false,
    ...overrides,
  };
}

describe("EittrisClientModel - board updates", () => {
  it("mirrors a board snapshot, specials and all", () => {
    const model = makeClient();
    (model as any).handleBoardUpdate(snapshot());

    expect(model.specials.length).toBe(1);
    expect(model.specials[0].t).toBe(SpecialType.Antidote);
    expect(model.antidotes).toBe(2);
    expect(model.speedupStacks).toBe(1);
    expect(model.shieldMs).toBe(4000);
    expect(model.targetId).toBe("B");
    expect(model.pieceSeq).toBe(3);
  });

  it("still applies updates after a checkpoint round trip", () => {
    const model = makeClient();
    (model as any).handleBoardUpdate(snapshot());

    // Round-trip exactly as a refresh would: collections come back plain
    const serializer = (model as any).serializer!;
    const restored: EittrisClientModel = serializer.parse(serializer.stringify(model));
    expect(restored.specials.length).toBe(1);

    // The crash was here: applying an update to a restored model
    expect(() =>
      (restored as any).handleBoardUpdate(
        snapshot({ specials: [{ i: 5, t: SpecialType.Speedup }], rows: 7 }),
      ),
    ).not.toThrow();
    expect(restored.rows).toBe(7);
    expect(restored.specials.length).toBe(1);
    expect(restored.specials[0].t).toBe(SpecialType.Speedup);
  });

  it("copes with a snapshot that carries no specials", () => {
    const model = makeClient();
    (model as any).handleBoardUpdate(snapshot({ specials: [] }));
    expect(model.specials.length).toBe(0);
  });
});

describe("EittrisClientModel - the hit banner does not linger", () => {
  const hitOnMe = {
    type: SpecialType.Speedup,
    attackerId: "B",
    attackerName: "Bob",
    victimId: "ME",
    victimName: "Tester",
    repelled: false,
  };

  it("clears once the affliction it announced is cured", () => {
    const model = makeClient();
    (model as any).handleBoardUpdate(snapshot({ speedupStacks: 1 }));
    (model as any).handleSpecialEvent(hitOnMe);
    expect(model.lastSpecialEvent).not.toBeNull();

    // An antidote wipes the stacks; the banner goes with them
    (model as any).handleBoardUpdate(snapshot({ speedupStacks: 0 }));
    expect(model.lastSpecialEvent).toBeNull();
  });

  it("keeps showing while the affliction is still on me", () => {
    const model = makeClient();
    (model as any).handleBoardUpdate(snapshot({ speedupStacks: 1 }));
    (model as any).handleSpecialEvent(hitOnMe);
    (model as any).handleBoardUpdate(snapshot({ speedupStacks: 2 }));
    expect(model.lastSpecialEvent).not.toBeNull();
  });

  it("is never checkpointed, so it cannot survive into the next game", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hitOnMe);
    const serializer = (model as any).serializer!;
    const restored: EittrisClientModel = serializer.parse(serializer.stringify(model));
    expect(restored.lastSpecialEvent).toBeNull();
  });
});

describe("EittrisClientModel - a live board is not thrown away", () => {
  // The phone owns its board.  A start-playing with no board means "make a fresh one",
  // which is right at the start of a round and catastrophic in the middle of one: the
  // phone would begin playing an empty board and then report it upward, blanking the
  // host's copy too.  The round number is what tells those two cases apart.
  function playingModel() {
    const model = makeClient();
    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 1,
      targetId: null,
    });
    return model;
  }

  it("starts a board when the host says go", () => {
    const model = playingModel();
    expect((model as any).board).toBeTruthy();
    expect((model as any).board.playerId).toBe(model.playerId);
  });

  it("ignores a repeat for the same round, keeping the board it is playing", () => {
    const model = playingModel();
    const board = (model as any).board;
    board.rows = 43; // something only THIS board has

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 1,
      targetId: null,
    });

    expect((model as any).board).toBe(board);
    expect((model as any).board.rows).toBe(43);
  });

  it("does start fresh when the round moves on", () => {
    const model = playingModel();
    (model as any).board.rows = 43;

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 2,
      targetId: null,
    });

    expect((model as any).board.rows).toBe(0);
  });

  it("takes a handed-back board even within the same round", () => {
    // This is a rejoin: the host is giving the seat back, and what it sends wins.
    const model = playingModel();
    const handedBack = makeBoard("someone-else", () => 0.5);
    handedBack.rows = 9;

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 1,
      targetId: null,
      board: handedBack,
    });

    expect((model as any).board.rows).toBe(9);
    expect((model as any).board.playerId).toBe(model.playerId);
  });
});

describe("EittrisClientModel - choosing a target", () => {
  // The phone owns its board, so aiming has to happen on the phone.  Sending it as a
  // command put it on the host's copy, which this phone's next report then overwrote -
  // so the target list looked completely dead.
  function playingWithRoster() {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    (model as any).applyRoster([
      { playerId: model.playerId, name: "Me", avatarId: 0, avatarColor: 0 },
      { playerId: "B", name: "Bob", avatarId: 1, avatarColor: 1 },
      { playerId: "C", name: "Cid", avatarId: 2, avatarColor: 2 },
    ]);
    return model;
  }

  it("aims at a living opponent, on this phone's own board", () => {
    const model = playingWithRoster();
    model.pickTarget("B");
    expect(model.targetId).toBe("B");
    expect((model as any).board.targetId).toBe("B");
  });

  it("refuses to aim at yourself", () => {
    const model = playingWithRoster();
    model.pickTarget("B");
    model.pickTarget(model.playerId);
    expect(model.targetId).toBe("B");
  });

  it("refuses to aim at somebody who is out", () => {
    const model = playingWithRoster();
    (model as any).handleThumbnails({ boards: [{ i: 2, alive: false, thumb: "" }] });
    model.pickTarget("C");
    expect(model.targetId).toBeNull();
  });

  it("cycles through the living opponents", () => {
    const model = playingWithRoster();
    model.cycleTarget(1);
    const first = model.targetId;
    model.cycleTarget(1);
    const second = model.targetId;
    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
    expect([first, second].sort()).toEqual(["B", "C"]);
  });
});

describe("EittrisClientModel - antidotes", () => {
  // Spending a charge has to happen on the phone.  Sent as a command it was spent on the
  // host's copy of the board, which this phone's next report immediately overwrote - the
  // charge came back and nothing was cured.
  function afflictedModel() {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    const board = (model as any).board;
    board.antidotes = 2;
    return { model, board };
  }

  it("spends a charge and cures what is on the board", () => {
    const { model, board } = afflictedModel();
    board.freezeDried = true;
    board.speedupStacks = 2;
    board.crazyIvan = true;

    model.useAntidote();

    expect(board.antidotes).toBe(1);
    expect(board.freezeDried).toBe(false);
    expect(board.speedupStacks).toBe(0);
    expect(board.crazyIvan).toBe(false);
    // ...and the view sees it, because the board is mirrored straight afterwards
    expect(model.antidotes).toBe(1);
    expect(model.freezeDried).toBe(false);
  });

  it("clears the countdowns as well as the effects", () => {
    // A timed affliction whose clock survived would put itself straight back on.
    const { model, board } = afflictedModel();
    board.freezeDried = true;
    board.freezeDriedMs = 12000;
    board.transparency = true;
    board.transparencyMs = 9000;

    model.useAntidote();

    expect(board.freezeDriedMs).toBe(0);
    expect(board.transparencyMs).toBe(0);
    expect(board.transparency).toBe(false);
  });

  it("raises a shield that turns the next attack away", () => {
    const { model, board } = afflictedModel();
    model.useAntidote();
    expect(board.shieldMs).toBeGreaterThan(0);

    const repelled = applyIncomingSpecial(
      board,
      SpecialType.FreezeDried,
      (model as any).simContext,
    );
    expect(repelled).toBe(true);
    expect(board.freezeDried).toBe(false);
  });

  it("works during the spawn gap, when no piece is falling", () => {
    const { model, board } = afflictedModel();
    board.piece = null;
    board.freezeDried = true;

    model.useAntidote();

    expect(board.freezeDried).toBe(false);
    expect(board.antidotes).toBe(1);
  });

  it("does nothing with no charges banked", () => {
    const { model, board } = afflictedModel();
    board.antidotes = 0;
    board.freezeDried = true;
    model.useAntidote();
    expect(board.freezeDried).toBe(true);
  });
});

describe("EittrisClientModel - a second game", () => {
  // The phone ignores a start-playing for a round it is already playing, so a stray repeat
  // cannot blank a live board.  A FINISHED game is not a live board, and refusing to start
  // over is how everybody ended up replaying the game they had just lost.
  function finishedGame() {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    const board = (model as any).board;
    board.grid[BOARD_HEIGHT - 1][0] = 1;
    (model as any).mirrorBoard();
    runInAction(() => {
      model.gameState = GeneralGameState.GameOver;
      model.winnerName = "Bob";
    });
    return { model, oldBoard: board };
  }

  it("starts fresh when the host starts another game", () => {
    const { model, oldBoard } = finishedGame();

    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 2, targetId: "B" });

    expect((model as any).board).not.toBe(oldBoard);
    expect(model.gameState).toBe(EittrisClientState.Playing);
    expect(model.winnerName).toBeNull();
    expect(model.youWon).toBe(false);
    expect(model.targetId).toBe("B");
  });

  it("starts fresh even if the round number comes round again", () => {
    // A host restarted from nothing counts from one again.  After a game over there is
    // nothing to protect, so the number does not get to veto a new game.
    const { model, oldBoard } = finishedGame();

    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });

    expect((model as any).board).not.toBe(oldBoard);
    expect(model.gameState).toBe(EittrisClientState.Playing);
  });

  it("still refuses to rebuild a round it is in the middle of", () => {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    const board = (model as any).board;
    board.rows = 9;

    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });

    expect((model as any).board).toBe(board);
    expect(board.rows).toBe(9);
  });

  it("does not rebuild under a dead player waiting out the round", () => {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    const board = (model as any).board;
    runInAction(() => (model.gameState = EittrisClientState.Dead));

    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });

    expect((model as any).board).toBe(board);
    expect(model.gameState).toBe(EittrisClientState.Dead);
  });
});

describe("EittrisClientModel - noticing who got hit", () => {
  // The target list flashes whoever just took an attack.  The phone therefore has to keep
  // hold of hits aimed at OTHER people, which it used to throw away - only what happened
  // to me got past the door.
  function hit(overrides: Partial<EittrisSpecialEventMessage> = {}): EittrisSpecialEventMessage {
    return {
      type: SpecialType.Speedup,
      attackerId: "A",
      attackerName: "Alice",
      victimId: "B",
      victimName: "Bob",
      repelled: false,
      ...overrides,
    };
  }

  it("remembers a hit on somebody else", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hit());
    expect(model.hitPulses.get("B")).toBeDefined();
    expect(model.hitPulses.get("B")!.repelled).toBe(false);
  });

  it("marks a shielded hit differently, so the two do not look alike", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hit({ repelled: true }));
    expect(model.hitPulses.get("B")!.repelled).toBe(true);
  });

  it("gives a repeat hit a new number, so the flash plays again", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hit());
    const first = model.hitPulses.get("B")!.seq;
    (model as any).handleSpecialEvent(hit());
    expect(model.hitPulses.get("B")!.seq).toBeGreaterThan(first);
  });

  it("does not flash a powerup somebody kept for themselves", () => {
    // Attacker and victim are the same player - that is a defensive pickup, not an attack
    const model = makeClient();
    (model as any).handleSpecialEvent(hit({ attackerId: "B", attackerName: "Bob" }));
    expect(model.hitPulses.get("B")).toBeUndefined();
  });

  it("still banners only what happened to me", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hit());
    expect(model.lastSpecialEvent).toBeNull();

    (model as any).handleSpecialEvent(hit({ victimId: model.playerId }));
    expect(model.lastSpecialEvent).not.toBeNull();
  });

  it("forgets the flashes when a new round starts", () => {
    const model = makeClient();
    (model as any).handleSpecialEvent(hit());
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 7, targetId: null });
    expect(model.hitPulses.size).toBe(0);
  });
});

describe("EittrisClientModel - knowing you are afflicted", () => {
  // The phone turns red while something is wrong with you, so this has to be right about
  // what "wrong" means: the six timed afflictions, and none of the self-buffs.
  function playing() {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    return model;
  }

  it("is fine to begin with", () => {
    expect(playing().afflicted).toBe(false);
  });

  it("knows about every affliction that has a clock", () => {
    for (const spec of AFFLICTION_TIMERS) {
      const model = playing();
      const board = (model as any).board;
      applyIncomingSpecial(board, spec.type, (model as any).simContext);
      (model as any).mirrorBoard();
      expect(model.afflicted).toBe(true);
    }
  });

  it("does not count a self-buff as an affliction", () => {
    const model = playing();
    const board = (model as any).board;
    board.seeShadows = true;
    board.crystalBall = true;
    board.slowdownStacks = 2;
    (model as any).mirrorBoard();
    expect(model.afflicted).toBe(false);
  });

  it("is fine again once the antidote has cured it", () => {
    const model = playing();
    const board = (model as any).board;
    board.antidotes = 1;
    applyIncomingSpecial(board, SpecialType.FreezeDried, (model as any).simContext);
    (model as any).mirrorBoard();
    expect(model.afflicted).toBe(true);

    model.useAntidote();
    expect(model.afflicted).toBe(false);
  });
});

describe("EittrisClientModel - the earthquake", () => {
  // Two halves on purpose: pressing the button starts the board shaking, and the stack
  // only comes down when the shaking stops.  A grid that rearranged itself the instant you
  // pressed a button would read as a bug rather than as a powerup.
  function quaking(rows: string[] = []) {
    const model = makeClient();
    (model as any).handleStartPlaying({ settings: defaultSettings(), round: 1, targetId: null });
    const board = (model as any).board;
    board.piece = null; // out of the way; the shake holds the piece anyway
    rows.forEach((row, i) => {
      const y = BOARD_HEIGHT - rows.length + i;
      for (let x = 0; x < row.length; x++) if (row[x] === "#") board.grid[y][x] = 1;
    });
    board.earthquakes = 1;
    return { model, board };
  }

  it("spends a charge and starts the board shaking", () => {
    const { model, board } = quaking(["#........."]);
    model.useEarthquake();
    expect(board.earthquakes).toBe(0);
    expect(board.quakeMs).toBeGreaterThan(0);
    expect(model.quakeMs).toBeGreaterThan(0); // and the view can see it
  });

  it("does not touch the stack until the shaking stops", () => {
    const { model, board } = quaking(["#.........", "..........", ".........."]);
    model.useEarthquake();
    expect(board.grid[BOARD_HEIGHT - 3][0]).toBe(1); // still up there
    expect(board.grid[BOARD_HEIGHT - 1][0]).toBe(EMPTY_CELL);
  });

  it("brings everything down when it does stop", () => {
    const { model, board } = quaking(["#.........", "..........", ".........."]);
    model.useEarthquake();
    stepBoard(board, EARTHQUAKE_SHAKE_MS + 10, (model as any).simContext);
    expect(board.quakeMs).toBe(0);
    expect(board.grid[BOARD_HEIGHT - 1][0]).toBe(1);
    expect(board.grid[BOARD_HEIGHT - 3][0]).toBe(EMPTY_CELL);
  });

  it("clears whatever the collapse completed, and counts the rows", () => {
    const { model, board } = quaking(["#########.", ".........#"]);
    const before = board.rows;
    model.useEarthquake();
    stepBoard(board, EARTHQUAKE_SHAKE_MS + 10, (model as any).simContext);
    expect(board.rows).toBe(before + 1);
    expect(board.grid[BOARD_HEIGHT - 1].every((c: number) => c === EMPTY_CELL)).toBe(true);
  });

  it("sets off the powerups sitting on the rows it completed", () => {
    const { model, board } = quaking(["#########.", ".........#"]);
    // A banked antidote riding the block that is about to land on the full row
    board.specials = [{ index: (BOARD_HEIGHT - 1) * BOARD_WIDTH + 9, type: SpecialType.Antidote }];
    const antidotesBefore = board.antidotes;

    model.useEarthquake();
    stepBoard(board, EARTHQUAKE_SHAKE_MS + 10, (model as any).simContext);

    expect(board.antidotes).toBe(antidotesBefore + 1);
    expect(board.specials.length).toBe(0);
  });

  it("does nothing with none banked", () => {
    const { model, board } = quaking(["#........."]);
    board.earthquakes = 0;
    model.useEarthquake();
    expect(board.quakeMs).toBe(0);
  });

  it("cannot be set off twice at once", () => {
    const { model, board } = quaking(["#........."]);
    board.earthquakes = 2;
    model.useEarthquake();
    model.useEarthquake();
    expect(board.earthquakes).toBe(1); // only the first one was spent
  });
});
