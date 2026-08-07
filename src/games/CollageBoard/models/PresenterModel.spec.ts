import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState } from "libs";
import {
  CollageBoardPresenterModel,
  CollageBoardGameState,
  CollageBoardPlayer,
  getCollageBoardPresenterTypeHelper,
} from "./PresenterModel";
import { ZonePoint } from "./collageBoardLogic";
import { PLAYER_COLORS, ZONE_LIFETIME_MS } from "./GameSettings";

// -------------------------------------------------------------------
// A light integration test that drives the real presenter model through its
// message handlers.  We deliberately skip reconstitute() (it starts a
// setInterval ticker and wires the relay listeners); the handlers under test
// don't depend on it.  The only collaborator they touch is the session (for
// the fire-and-forget pushes), so a recording stub is enough.
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

function makeModel() {
  const sent: SentMessage[] = [];
  const session = makeFakeSession(sent);
  const logger = new MockTelemetryLogger("test");
  const storage = {
    set: () => {},
    get: () => null,
    remove: () => {},
    clear: () => {},
  };
  const model = new CollageBoardPresenterModel(session, logger, storage);
  return { model, sent };
}

function addPlayer(
  model: CollageBoardPresenterModel,
  id: string,
  name: string,
): CollageBoardPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  p.playerId = id;
  runInAction(() => model.players.push(p));
  return p;
}

function startPlaying(model: CollageBoardPresenterModel) {
  runInAction(() => {
    model.gameState = CollageBoardGameState.Playing;
    model.timeOfStageEnd = Number.MAX_SAFE_INTEGER;
  });
}

const SQUARE: ZonePoint[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];

const JPEG = "data:image/jpeg;base64,FAKEIMAGE";

describe("CollageBoardPresenterModel — player colors", () => {
  it("assigns unique palette colors in join order", () => {
    const { model } = makeModel();
    const a = addPlayer(model, "A", "Alice");
    const b = addPlayer(model, "B", "Bob");
    const c = addPlayer(model, "C", "Carol");
    expect(a.color).toBe(PLAYER_COLORS[0]);
    expect(b.color).toBe(PLAYER_COLORS[1]);
    expect(c.color).toBe(PLAYER_COLORS[2]);
  });
});

describe("CollageBoardPresenterModel — claiming", () => {
  it("grants a valid claim and broadcasts the zone with the owner's color", () => {
    const { model, sent } = makeModel();
    const alice = addPlayer(model, "A", "Alice");
    startPlaying(model);

    const res = model.handleClaimZone("A", { points: SQUARE });

    expect(res.granted).toBe(true);
    expect(res.zoneId).toBeTruthy();
    expect(model.zones.length).toBe(1);
    expect(model.zones[0].playerId).toBe("A");

    const infos = model.zoneInfos();
    expect(infos[0].color).toBe(alice.color);
    expect(infos[0].playerName).toBe("Alice");

    const push = sent.find((s) => s.route === "/games/collageboard/push/zones");
    expect(push).toBeTruthy();
    expect(push!.message.zones.length).toBe(1);
  });

  it("rejects a claim before the game starts", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    expect(model.gameState).toBe(PresenterGameState.Gathering);
    const res = model.handleClaimZone("A", { points: SQUARE });
    expect(res.granted).toBe(false);
  });

  it("rejects a claim from an unknown sender", () => {
    const { model } = makeModel();
    startPlaying(model);
    const res = model.handleClaimZone("ghost", { points: SQUARE });
    expect(res.granted).toBe(false);
  });

  it("rejects a degenerate outline", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    startPlaying(model);
    const res = model.handleClaimZone("A", {
      points: [
        { x: 0.5, y: 0.5 },
        { x: 0.5001, y: 0.5 },
        { x: 0.5001, y: 0.5001 },
      ],
    });
    expect(res.granted).toBe(false);
    expect(model.zones.length).toBe(0);
  });

  it("replaces a player's previous claim (one active zone per player)", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    startPlaying(model);

    const first = model.handleClaimZone("A", { points: SQUARE });
    const second = model.handleClaimZone("A", {
      points: SQUARE.map((p) => ({ x: p.x + 0.1, y: p.y + 0.1 })),
    });

    expect(second.granted).toBe(true);
    expect(model.zones.length).toBe(1);
    expect(model.zones[0].zoneId).toBe(second.zoneId);
    expect(model.zones[0].zoneId).not.toBe(first.zoneId);
  });

  it("allows overlapping claims from different players (claims are advisory)", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    startPlaying(model);

    expect(model.handleClaimZone("A", { points: SQUARE }).granted).toBe(true);
    expect(model.handleClaimZone("B", { points: SQUARE }).granted).toBe(true);
    expect(model.zones.length).toBe(2);
  });
});

describe("CollageBoardPresenterModel — release + expiry", () => {
  it("releases only the sender's own zone", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    startPlaying(model);
    const zoneId = model.handleClaimZone("A", { points: SQUARE }).zoneId!;

    model.handleReleaseZone("B", { zoneId }); // Bob can't release Alice's zone
    expect(model.zones.length).toBe(1);

    model.handleReleaseZone("A", { zoneId });
    expect(model.zones.length).toBe(0);
  });

  it("expires abandoned claims on tick", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    startPlaying(model);
    model.handleClaimZone("A", { points: SQUARE });
    expect(model.zones.length).toBe(1);

    runInAction(() => {
      model.gameTime_ms = model.zones[0].claimedAt + ZONE_LIFETIME_MS + 1;
    });
    model.handleTick();
    expect(model.zones.length).toBe(0);
  });
});

describe("CollageBoardPresenterModel — committing photos", () => {
  it("paints the patch, frees the zone, and credits the author", () => {
    const { model } = makeModel();
    const alice = addPlayer(model, "A", "Alice");
    startPlaying(model);
    const zoneId = model.handleClaimZone("A", { points: SQUARE }).zoneId!;

    const res = model.handleCommitPhoto("A", { zoneId, image: JPEG });

    expect(res.ok).toBe(true);
    expect(model.patches.length).toBe(1);
    expect(model.patches[0].authorId).toBe("A");
    expect(model.patches[0].bounds.width).toBeCloseTo(0.4, 3);
    expect(model.zones.length).toBe(0); // zone released after the shot
    expect(alice.photosTaken).toBe(1);
  });

  it("rejects a commit for a zone the sender doesn't hold", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    startPlaying(model);
    const zoneId = model.handleClaimZone("A", { points: SQUARE }).zoneId!;

    const res = model.handleCommitPhoto("B", { zoneId, image: JPEG });
    expect(res.ok).toBe(false);
    expect(model.patches.length).toBe(0);
    expect(model.zones.length).toBe(1); // Alice's claim survives
  });

  it("rejects non-image and oversized payloads", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    startPlaying(model);
    const zoneId = model.handleClaimZone("A", { points: SQUARE }).zoneId!;

    expect(model.handleCommitPhoto("A", { zoneId, image: "hello" }).ok).toBe(false);
    const huge = "data:image/jpeg;base64," + "x".repeat(1_000_000);
    expect(model.handleCommitPhoto("A", { zoneId, image: huge }).ok).toBe(false);
    expect(model.patches.length).toBe(0);
  });
});

describe("CollageBoardPresenterModel — onboarding", () => {
  it("reports state, the player's color, and active zones", () => {
    const { model } = makeModel();
    const alice = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    startPlaying(model);
    model.handleClaimZone("A", { points: SQUARE });

    const info = model.handleOnboard("A", {});
    expect(info.state).toBe(CollageBoardGameState.Playing);
    expect(info.playerColor).toBe(alice.color);
    expect(info.zones.length).toBe(1);
    expect(info.zones[0].playerId).toBe("A");
  });
});

describe("CollageBoardPresenterModel — checkpoint serialization", () => {
  // Patches hold base64 images and zones hold live claims; both are excluded
  // from the checkpoint.  If either leaked into the serialized graph the deep
  // serializer would blow the storage quota or throw, silently killing ALL
  // checkpoints.  Build the serializer the production way.
  it("round-trips through the real serializer, preserving players and skipping the collage", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getCollageBoardPresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(
      typeHelper,
      logger,
      storage,
    ) as unknown as CollageBoardPresenterModel;

    runInAction(() => {
      const p = model.createFreshPlayerEntry("Alice", "A");
      p.playerId = "A";
      p.photosTaken = 3;
      model.players.push(p);
    });
    startPlaying(model);
    const zoneId = model.handleClaimZone("A", { points: SQUARE }).zoneId!;
    model.handleCommitPhoto("A", { zoneId, image: JPEG });
    model.handleClaimZone("A", { points: SQUARE });

    const serializer = model.serializer!;
    let json = "";
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();
    expect(json).not.toContain("FAKEIMAGE"); // patch images never hit storage

    const back = serializer.parse<CollageBoardPresenterModel>(json);
    expect(back.players.length).toBe(1);
    expect(back.players[0].color).toBe(PLAYER_COLORS[0]);
    expect(back.players[0].photosTaken).toBe(4); // 3 restored + 1 committed above
    expect(back.patches.length).toBe(0); // collage intentionally not serialized
    expect(back.zones.length).toBe(0); // claims intentionally not serialized
  });
});
