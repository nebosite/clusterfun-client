import { runInAction } from "mobx";
import {
  ClusterfunPresenterModel,
  ClusterFunPlayer,
  GeneralGameState,
  ISessionHelper,
  ITelemetryLogger,
  IStorage,
} from "libs";
import { AnalyticsEvent } from "libs/telemetry/AnalyticsTypes";

// -------------------------------------------------------------------
// The five questions analytics has to answer are all built out of events the
// BASE class fires - no game has to remember to send them.  These tests are
// what stops a refactor from silently removing that.
// -------------------------------------------------------------------

interface Sent {
  event: string;
  params: Record<string, any>;
}

class TestPlayer extends ClusterFunPlayer {}

class TestPresenter extends ClusterfunPresenterModel<TestPlayer> {
  createFreshPlayerEntry(name: string, id: string): TestPlayer {
    const p = new TestPlayer();
    p.name = name;
    p.playerId = id;
    return p;
  }
  handleTick(): void {}
  startNextRound(): void {}
  prepareFreshRound(): void {}
  prepareFreshGame(): void {}
}

function memoryStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    set: (n, v) => void map.set(n, v),
    get: (n) => map.get(n) ?? null,
    remove: (n) => void map.delete(n),
    clear: () => map.clear(),
  };
}

function fakeSession(): ISessionHelper {
  return {
    roomId: "ROOM",
    personalId: "HOST",
    personalSecret: "secret",
    sendMessage: () => {},
    listen: () => ({ unsubscribe: () => {} }),
    listenPresenter: () => ({ unsubscribe: () => {} }),
    request: () => Promise.resolve(undefined),
    requestPresenter: () => Promise.resolve(undefined),
    sendMessageToPresenter: () => {},
    addClosedListener: () => {},
    removeClosedListener: () => {},
    onError: () => {},
    serverCall: () => Promise.resolve(undefined),
    stats: { sentCount: 0, bytesSent: 0, recievedCount: 0, bytesRecieved: 0 },
  } as unknown as ISessionHelper;
}

// Every model built by a test, so they can be torn down again - reconstitute
// starts a ticker, and a leaked one keeps Jest alive.
const built: TestPresenter[] = [];
afterEach(() => {
  while (built.length) built.pop()!.shutdown();
});

function makePresenter() {
  const sent: Sent[] = [];
  const logger: ITelemetryLogger = {
    logEvent: () => {},
    logPageView: () => {},
    logAnalyticsEvent: (event, params) => sent.push({ event, params: params as any }),
  };
  const model = new TestPresenter("TestGame", fakeSession(), logger, memoryStorage());
  // The framework always reconstitutes a model before it is used, and that is
  // where the end-of-game subscriptions are registered.  A test that skips it
  // is testing a half-built model.
  model.reconstitute();
  built.push(model);
  return { model, sent };
}

// invokeEvent defers a tick, so state-change reporting needs the queue drained
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

function addPlayers(model: TestPresenter, count: number) {
  runInAction(() => {
    for (let i = 0; i < count; i++) {
      model.players.push(model.createFreshPlayerEntry(`P${i}`, `id${i}`));
    }
  });
}

const only = (sent: Sent[], event: string) => sent.filter((s) => s.event === event);

describe("Presenter analytics - every event carries the three dimensions", () => {
  it("tags host events with the game, a device id, and entity=host", () => {
    const { model, sent } = makePresenter();
    model.analytics.track("custom_thing", { n: 1 });
    expect(sent[0].params.game).toBe("TestGame");
    expect(sent[0].params.entity).toBe("host");
    expect(sent[0].params.device_id).toBeTruthy();
  });
});

describe("Presenter analytics - which games get played, and by how many", () => {
  it("reports a game start with the player count", () => {
    const { model, sent } = makePresenter();
    addPlayers(model, 4);
    model.startGame();

    const started = only(sent, AnalyticsEvent.GameStarted);
    expect(started.length).toBe(1);
    expect(started[0].params.player_count).toBe(4);
    expect(started[0].params.replay).toBe(false);
    expect(started[0].params.game).toBe("TestGame");
  });

  it("marks a second game on the same room as a replay", () => {
    const { model, sent } = makePresenter();
    addPlayers(model, 2);
    model.startGame();
    model.startGame();
    const started = only(sent, AnalyticsEvent.GameStarted);
    expect(started.map((s) => s.params.replay)).toEqual([false, true]);
  });
});

describe("Presenter analytics - how long, and how often finished", () => {
  it("reports completed with a duration when the game reaches game over", async () => {
    const { model, sent } = makePresenter();
    addPlayers(model, 3);
    model.startGame();
    model.gameState = GeneralGameState.GameOver;
    await settle();

    const ended = only(sent, AnalyticsEvent.GameEnded);
    expect(ended.length).toBe(1);
    expect(ended[0].params.outcome).toBe("completed");
    expect(ended[0].params.completed).toBe(true);
    expect(ended[0].params.player_count).toBe(3);
    expect(typeof ended[0].params.duration_seconds).toBe("number");
    expect(ended[0].params.duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it("reports abandoned when a playing game is destroyed instead", async () => {
    const { model, sent } = makePresenter();
    addPlayers(model, 2);
    model.startGame();
    model.gameState = GeneralGameState.Destroyed;
    await settle();

    const ended = only(sent, AnalyticsEvent.GameEnded);
    expect(ended.length).toBe(1);
    expect(ended[0].params.outcome).toBe("abandoned");
    expect(ended[0].params.completed).toBe(false);
  });

  it("reports an ending exactly once, even though game over is followed by destroy", async () => {
    const { model, sent } = makePresenter();
    addPlayers(model, 2);
    model.startGame();
    model.gameState = GeneralGameState.GameOver;
    await settle();
    model.gameState = GeneralGameState.Destroyed;
    await settle();

    const ended = only(sent, AnalyticsEvent.GameEnded);
    expect(ended.length).toBe(1);
    expect(ended[0].params.outcome).toBe("completed"); // the first ending is the true one
  });

  it("does not report an ending for a game that was never started", async () => {
    const { model, sent } = makePresenter();
    model.gameState = GeneralGameState.Destroyed;
    await settle();
    expect(only(sent, AnalyticsEvent.GameEnded).length).toBe(0);
  });
});

describe("Presenter analytics - joins and lost-connection rejoins", () => {
  const join = (name: string, id: string) => ({ playerName: name, avatarId: 1, avatarColor: 2 });

  it("counts a first join", async () => {
    const { model, sent } = makePresenter();
    const ack = await model.handleJoinMessage("id1", join("Ann", "id1"));
    expect(ack.didJoin).toBe(true);
    expect(ack.isRejoin).toBe(false);
    expect(only(sent, AnalyticsEvent.PlayerJoined).length).toBe(1);
    expect(only(sent, AnalyticsEvent.PlayerRejoined).length).toBe(0);
  });

  it("counts a reconnect as a rejoin, matched by device id", async () => {
    const { model, sent } = makePresenter();
    await model.handleJoinMessage("id1", join("Ann", "id1"));
    model.handlePlayerQuitMessage("id1", {}); // the phone drops off
    sent.length = 0;

    const ack = await model.handleJoinMessage("id1", join("Ann", "id1"));
    expect(ack.isRejoin).toBe(true);
    const rejoins = only(sent, AnalyticsEvent.PlayerRejoined);
    expect(rejoins.length).toBe(1);
    expect(rejoins[0].params.matched_by).toBe("id");
    expect(rejoins[0].params.game).toBe("TestGame");
  });

  it("says so when the rejoin only matched on name - a rebooted device", async () => {
    const { model, sent } = makePresenter();
    await model.handleJoinMessage("id1", join("Ann", "id1"));
    model.handlePlayerQuitMessage("id1", {});
    sent.length = 0;

    // Same person, brand new personal id
    const ack = await model.handleJoinMessage("id-new", join("Ann", "id-new"));
    expect(ack.isRejoin).toBe(true);
    expect(only(sent, AnalyticsEvent.PlayerRejoined)[0].params.matched_by).toBe("name");
  });

  it("records why a join was turned away", async () => {
    const { model, sent } = makePresenter();
    model.maxPlayers = 1;
    await model.handleJoinMessage("id1", join("Ann", "id1"));
    sent.length = 0;

    await model.handleJoinMessage("id2", join("Bob", "id2"));
    const denied = only(sent, AnalyticsEvent.JoinDenied);
    expect(denied.length).toBe(1);
    expect(denied[0].params.reason).toBe("room_full");
  });

  it("does not count a repeated join message as a rejoin", async () => {
    const { model, sent } = makePresenter();
    await model.handleJoinMessage("id1", join("Ann", "id1"));
    sent.length = 0;
    await model.handleJoinMessage("id1", join("Ann", "id1")); // duplicate, still connected
    expect(only(sent, AnalyticsEvent.PlayerRejoined).length).toBe(0);
    expect(only(sent, AnalyticsEvent.PlayerJoined).length).toBe(0);
  });
});
