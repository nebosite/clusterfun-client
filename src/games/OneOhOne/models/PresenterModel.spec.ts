import { ISessionHelper, ITelemetryLogger, IStorage } from "libs";
import { OneOhOnePresenterModel } from "./PresenterModel";

// ==========================================================================================
// OneOhOne used to have a live reconnect bug: pieces are owned by `ownerId`, which was the
// player's id, and the relay handed out a NEW id every time a phone reconnected.  The
// ownership filters then matched nothing, so a player whose phone slept came back unable to
// move a single piece for the rest of the game - with no error and nothing on screen to
// explain it.
//
// Player ids are permanent now, so there is nothing to migrate.  This is the test that says
// so, from the outside: join, drop, come back, and still be able to play.
// ==========================================================================================

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

const built: OneOhOnePresenterModel[] = [];
afterEach(() => {
  while (built.length) built.pop()!.shutdown();
});

function makeModel() {
  const logger: ITelemetryLogger = {
    logEvent: () => {},
    logPageView: () => {},
    logAnalyticsEvent: () => {},
  };
  const model = new OneOhOnePresenterModel(fakeSession(), logger, memoryStorage());
  model.reconstitute();
  model.minPlayers = 1;
  built.push(model);
  return model;
}

async function startWithOnePlayer() {
  const model = makeModel();
  await model.handleJoinMessage("conn-1", {
    playerName: "Alice",
    playerToken: "token-alice",
  });
  model.startGame();
  return model;
}

describe("OneOhOne - a reconnected player can still play", () => {
  it("leaves their pieces owned by them after a reconnect", async () => {
    const model = await startWithOnePlayer();
    const alice = model.players[0];
    const mine = model.pieces.filter((p) => p.ownerId === alice.playerId);
    expect(mine.length).toBeGreaterThan(0);

    // Phone sleeps, then comes back on a completely new connection
    model.handlePlayerQuitMessage(alice.playerId, {});
    await model.handleJoinMessage("conn-2", {
      playerName: "Alice",
      playerToken: "token-alice",
    });

    const stillMine = model.pieces.filter((p) => p.ownerId === model.players[0].playerId);
    expect(stillMine.length).toBe(mine.length);
  });

  it("accepts a guess from them after they come back", async () => {
    const model = await startWithOnePlayer();
    const alice = model.players[0];
    const piece = model.pieces.find((p) => p.ownerId === alice.playerId)!;

    model.handlePlayerQuitMessage(alice.playerId, {});
    await model.handleJoinMessage("conn-2", {
      playerName: "Alice",
      playerToken: "token-alice",
    });

    // Handlers see the STABLE id - the base class translates the relay's
    // connection id before any game handler is called.
    const response = model.handleSetGuess(model.players[0].playerId, {
      pieceId: piece.pieceId,
      guess: 5,
      confirmed: true,
    });

    expect(response.accepted).toBe(true);
    expect(model.pieces.find((p) => p.pieceId === piece.pieceId)!.guess).toBe(5);
  });

  it("gives them their pieces back when they re-onboard", async () => {
    const model = await startWithOnePlayer();
    const alice = model.players[0];
    const expected = model.pieces.filter((p) => p.ownerId === alice.playerId).length;

    model.handlePlayerQuitMessage(alice.playerId, {});
    await model.handleJoinMessage("conn-2", {
      playerName: "Alice",
      playerToken: "token-alice",
    });

    const onboard = model.handleOnboardClient(model.players[0].playerId, {});
    expect(onboard.myPieces.length).toBe(expected);
  });

  it("keeps them at the table while they are away", async () => {
    const model = await startWithOnePlayer();
    const alice = model.players[0];

    model.handlePlayerQuitMessage(alice.playerId, {});

    expect(model.players.length).toBe(1);
    expect(model.players[0].isConnected).toBe(false);
    // Their pieces stay on the track, holding their position
    expect(model.pieces.some((p) => p.ownerId === alice.playerId)).toBe(true);
  });
});
