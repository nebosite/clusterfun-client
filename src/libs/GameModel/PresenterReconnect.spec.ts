import {
  ClusterfunPresenterModel,
  ClusterFunPlayer,
  GeneralGameState,
  ISessionHelper,
  ITelemetryLogger,
  IStorage,
  PresenterGameState,
  ReconnectInfo,
  DISCONNECT_TIMEOUT_MS,
} from "libs";
import MessageEndpoint from "libs/messaging/MessageEndpoint";

// ==========================================================================================
// The reconnect contract.
//
// A phone going quiet mid-game - locked screen, lift, flat battery, a walk past the router -
// is the single most common thing that happens to a party game, and for a long time it was
// the least tested.  These tests pin the rules every game inherits:
//
//   * a player's id is PERMANENT; only the connection under it moves
//   * going quiet never costs you your seat or your state
//   * only the host can free a seat, deliberately
//   * a name on the big screen is not proof of identity
//
// They run against the base class rather than any one game, because the whole point is that
// no game has to get this right on its own.
// ==========================================================================================

class TestPlayer extends ClusterFunPlayer {
  // Stand-in for whatever a real game hangs off a player id - a board, a
  // hand of cards, a pile of photos.
  score = 0;
}

class TestPresenter extends ClusterfunPresenterModel<TestPlayer> {
  returned: { player: TestPlayer; info: ReconnectInfo }[] = [];
  disconnected: TestPlayer[] = [];
  exited: TestPlayer[] = [];

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

  protected onPlayerReturned(player: TestPlayer, info: ReconnectInfo): void {
    this.returned.push({ player, info });
  }
  protected onPlayerDisconnected(player: TestPlayer): void {
    this.disconnected.push(player);
  }
  protected onPlayerExited(player: TestPlayer): void {
    this.exited.push(player);
  }
}

interface SentMessage {
  route: unknown;
  receiverId: string;
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

function fakeSession(sent: SentMessage[]): ISessionHelper {
  return {
    roomId: "ROOM",
    personalId: "HOST",
    personalSecret: "secret",
    sendMessage: (endpoint: MessageEndpoint<unknown, unknown>, receiverId: string) =>
      void sent.push({ route: endpoint.route, receiverId }),
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

// reconstitute starts a ticker; a leaked one keeps Jest alive.
const built: TestPresenter[] = [];
afterEach(() => {
  while (built.length) built.pop()!.shutdown();
});

function makePresenter() {
  const sent: SentMessage[] = [];
  const logger: ITelemetryLogger = {
    logEvent: () => {},
    logPageView: () => {},
    logAnalyticsEvent: () => {},
  };
  const model = new TestPresenter("TestGame", fakeSession(sent), logger, memoryStorage());
  model.reconstitute();
  model.minPlayers = 1;
  built.push(model);
  return { model, sent };
}

const join = (model: TestPresenter, connectionId: string, name: string, token?: string) =>
  model.handleJoinMessage(connectionId, { playerName: name, playerToken: token });

describe("reconnect contract - a player id is permanent", () => {
  it("keeps the same playerId when a phone comes back on a new connection", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    const alice = model.players[0];
    alice.score = 42;

    const ack = await join(model, "conn-2", "Alice", "token-alice");

    expect(ack.isRejoin).toBe(true);
    expect(model.players.length).toBe(1);
    expect(model.players[0].playerId).toBe("conn-1"); // the seat's permanent name
    expect(model.players[0].connectionId).toBe("conn-2"); // only the socket moved
    expect(model.players[0].score).toBe(42); // and their game came with them
  });

  it("tells the returning phone its permanent id, not the new connection", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");

    const ack = await join(model, "conn-2", "Alice", "token-alice");

    // Without this the phone stops recognising itself in anything the host
    // broadcasts - rosters, attack targets, its own scoreboard row.
    expect(ack.playerId).toBe("conn-1");
  });

  it("gives a brand new player their permanent id on the first join", async () => {
    const { model } = makePresenter();
    const ack = await join(model, "conn-1", "Alice", "token-alice");
    expect(ack.didJoin).toBe(true);
    expect(ack.isRejoin).toBe(false);
    expect(ack.playerId).toBe(model.players[0].playerId);
  });

  it("never publishes the private reconnect token as the player id", async () => {
    // playerId travels in every roster to every phone; playerToken is the
    // proof of who owns a seat.  Deriving one from the other would hand
    // everybody what they need to steal a seat.
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    expect(model.players[0].playerId).not.toContain("token-alice");
  });
});

describe("reconnect contract - going quiet keeps your seat", () => {
  it("holds the seat when a client quits cleanly", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    const alice = model.players[0];
    alice.score = 7;

    model.handlePlayerQuitMessage(alice.playerId, {});

    expect(model.players.length).toBe(1); // still at the table
    expect(alice.isConnected).toBe(false); // just not answering
    expect(alice.score).toBe(7); // and nothing was thrown away
    expect(model.disconnected).toEqual([alice]);
  });

  it("marks a silent player disconnected once the timeout passes", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    const alice = model.players[0];
    expect(alice.isConnected).toBe(true);

    alice.lastSeenMs = Date.now() - (DISCONNECT_TIMEOUT_MS + 1000);
    (model as any).checkForDisconnectedPlayers();

    expect(alice.isConnected).toBe(false);
    expect(model.disconnected).toEqual([alice]);
  });

  it("does not drop a player who is still pinging", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    const alice = model.players[0];

    alice.lastSeenMs = Date.now();
    (model as any).checkForDisconnectedPlayers();

    expect(alice.isConnected).toBe(true);
    expect(model.disconnected).toEqual([]);
  });

  it("fires onPlayerReturned with the disconnect flag set when they come back", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});

    await join(model, "conn-2", "Alice", "token-alice");

    expect(model.returned.length).toBe(1);
    expect(model.returned[0].info.wasDisconnected).toBe(true);
    expect(model.returned[0].info.matchedBy).toBe("token");
    expect(model.returned[0].info.previousConnectionId).toBe("conn-1");
    expect(model.players[0].isConnected).toBe(true);
  });

  it("does not report a rejoin when a live phone just re-sends its join", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");

    await join(model, "conn-1", "Alice", "token-alice");

    expect(model.players.length).toBe(1);
    expect(model.returned[0].info.wasDisconnected).toBe(false);
  });
});

describe("reconnect contract - only the host frees a seat", () => {
  it("removes a booted player and lets somebody else take the slot", async () => {
    const { model } = makePresenter();
    model.maxPlayers = 1;
    await join(model, "conn-1", "Alice", "token-alice");
    const alice = model.players[0];

    model.bootPlayer(alice);

    expect(model.players.length).toBe(0);
    expect(model.exited).toEqual([alice]);
    const ack = await join(model, "conn-2", "Bob", "token-bob");
    expect(ack.didJoin).toBe(true);
  });

  it("tells a booted player their game is over, if it can still reach them", async () => {
    const { model, sent } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    sent.length = 0;

    model.bootPlayer(model.players[0]);

    expect(sent.length).toBe(1);
    expect(sent[0].receiverId).toBe("conn-1");
  });

  it("says nothing to a booted player who is already gone", async () => {
    const { model, sent } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});
    sent.length = 0;

    model.bootPlayer(model.players[0]);

    expect(sent.length).toBe(0);
  });
});

describe("reconnect contract - a name is not proof", () => {
  it("refuses a stranger who types a seated player's name", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});

    const ack = await join(model, "imposter", "Alice", "token-imposter");

    expect(ack.isRejoin).toBe(false);
    expect(ack.didJoin).toBe(false); // the name is taken - by Alice
    expect(model.players[0].connectionId).toBe("conn-1"); // her seat is untouched
  });

  it("still lets a tokenless client back in by name, for older phones", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});

    const ack = await join(model, "conn-2", "Alice");

    expect(ack.isRejoin).toBe(true);
    expect(model.players.length).toBe(1);
  });
});

describe("reconnect contract - the host only talks to phones that are listening", () => {
  it("skips disconnected players when broadcasting", async () => {
    const { model, sent } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    await join(model, "conn-2", "Bob", "token-bob");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});
    sent.length = 0;

    model.sendToEveryone({ route: "/test/broadcast" } as MessageEndpoint<{}, void>, () => ({}));

    // Alice is asleep; a message to her goes nowhere and she rebuilds her
    // state when she returns anyway.
    expect(sent.map((s) => s.receiverId)).toEqual(["conn-2"]);
  });

  it("addresses broadcasts to the CURRENT connection after a reconnect", async () => {
    const { model, sent } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    await join(model, "conn-2", "Alice", "token-alice");
    sent.length = 0;

    model.sendToEveryone({ route: "/test/broadcast" } as MessageEndpoint<{}, void>, () => ({}));

    expect(sent.map((s) => s.receiverId)).toEqual(["conn-2"]);
  });
});

describe("reconnect contract - playing again", () => {
  it("keeps identity and connection across a replay", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    await join(model, "conn-2", "Alice", "token-alice");
    const before = model.players[0];
    before.score = 99;

    model.gameState = GeneralGameState.GameOver;
    model.playAgain(false);

    const after = model.players[0];
    expect(after.playerId).toBe(before.playerId);
    expect(after.connectionId).toBe("conn-2");
    expect(after.playerToken).toBe("token-alice");
    expect(after.isConnected).toBe(true);
    // ...but the game's own per-player state IS reset, which is the point
    expect(after.score).toBe(0);
  });
});

describe("reconnect contract - a restored host is patient", () => {
  it("gives every seat a fresh grace period after a checkpoint restore", async () => {
    const { model } = makePresenter();
    await join(model, "conn-1", "Alice", "token-alice");
    model.players[0].lastSeenMs = Date.now() - (DISCONNECT_TIMEOUT_MS + 60_000);

    // A host that refreshes mid-game has heard from nobody yet.  Declaring
    // the whole room disconnected half a second later would be wrong.
    model.reconstitute();

    expect(model.players[0].lastSeenMs).toBeGreaterThan(Date.now() - DISCONNECT_TIMEOUT_MS);
  });
});

describe("reconnect contract - pausing while we wait", () => {
  async function twoPlayerGameThatPauses() {
    const { model } = makePresenter();
    model.minPlayers = 2;
    await join(model, "conn-a", "Alice", "token-alice");
    await join(model, "conn-b", "Bob", "token-bob");
    model.startGame();
    model.handlePlayerQuitMessage(model.players[0].playerId, {});
    return model;
  }

  it("pauses when too few phones are left", async () => {
    const model = await twoPlayerGameThatPauses();
    expect(model.gameState).toBe(GeneralGameState.Paused);
  });

  it("resumes on its own once they come back", async () => {
    // The half that was missing: the game paused itself when a phone slept
    // and then stayed paused after it woke up, with nothing on screen to say
    // why or any way to carry on.
    const model = await twoPlayerGameThatPauses();

    await join(model, "conn-a2", "Alice", "token-alice");

    expect(model.gameState).toBe(GeneralGameState.Playing);
    expect(model.isPaused).toBe(false);
  });

  it("can still resume after a second player drops while paused", async () => {
    // _stateBeforePause used to be overwritten by the second pause, latching
    // it to "Paused" - after which the game could never be resumed at all.
    const model = await twoPlayerGameThatPauses();
    model.handlePlayerQuitMessage(model.players[1].playerId, {});

    await join(model, "conn-a2", "Alice", "token-alice");
    await join(model, "conn-b2", "Bob", "token-bob");

    expect(model.gameState).toBe(GeneralGameState.Playing);
  });

  it("leaves a deliberate host pause alone", async () => {
    const { model } = makePresenter();
    model.minPlayers = 1;
    await join(model, "conn-a", "Alice", "token-alice");
    model.startGame();
    model.pauseGame(); // the host wanted a break

    await join(model, "conn-a2", "Alice", "token-alice");

    expect(model.gameState).toBe(GeneralGameState.Paused);
  });
});

describe("reconnect contract - the game is still gathering", () => {
  it("does not pause a game that has not started", async () => {
    const { model } = makePresenter();
    model.minPlayers = 2;
    await join(model, "conn-1", "Alice", "token-alice");
    await join(model, "conn-2", "Bob", "token-bob");
    expect(model.gameState).toBe(PresenterGameState.Gathering);

    model.handlePlayerQuitMessage(model.players[0].playerId, {});

    expect(model.isPaused).toBe(false);
  });
});
