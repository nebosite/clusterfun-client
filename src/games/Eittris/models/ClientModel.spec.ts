import { ISessionHelper, instantiateGame, getClientTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { EittrisClientModel, getEittrisClientTypeHelper } from "./ClientModel";
import { EittrisBoardSnapshot } from "./eittrisEndpoints";
import {
  BOARD_HEIGHT,
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
    score: 100,
    rows: 1,
    alive: true,
    intervalMs: 900,
    backgroundIndex: 2,
    targetId: "B",
    pieceSeq: 3,
    specials: [{ i: (BOARD_HEIGHT - 1) * BOARD_WIDTH, t: SpecialType.Antidote }],
    antidotes: 2,
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

    expect(model.score).toBe(100);
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
        snapshot({ specials: [{ i: 5, t: SpecialType.Speedup }], score: 250 }),
      ),
    ).not.toThrow();
    expect(restored.score).toBe(250);
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
    board.score = 4321; // something only THIS board has

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 1,
      targetId: null,
    });

    expect((model as any).board).toBe(board);
    expect((model as any).board.score).toBe(4321);
  });

  it("does start fresh when the round moves on", () => {
    const model = playingModel();
    (model as any).board.score = 4321;

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 2,
      targetId: null,
    });

    expect((model as any).board.score).toBe(0);
  });

  it("takes a handed-back board even within the same round", () => {
    // This is a rejoin: the host is giving the seat back, and what it sends wins.
    const model = playingModel();
    const handedBack = makeBoard("someone-else", () => 0.5);
    handedBack.score = 999;

    (model as any).handleStartPlaying({
      settings: defaultSettings(),
      round: 1,
      targetId: null,
      board: handedBack,
    });

    expect((model as any).board.score).toBe(999);
    expect((model as any).board.playerId).toBe(model.playerId);
  });
});
