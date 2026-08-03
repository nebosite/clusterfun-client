import {
  ClusterFunGameProps,
  ClusterfunPresenterModel,
  ClusterFunPlayer,
  GeneralGameState,
  ISessionHelper,
  IStorage,
  ITelemetryLogger,
  ITypeHelper,
  getPresenterTypeHelper,
} from "libs";
import { instantiateGame } from "libs/GameModel/BaseGameModel";

import {
  EittrisPresenterModel,
  getEittrisPresenterTypeHelper,
} from "games/Eittris/models/PresenterModel";
import {
  LexiblePresenterModel,
  getLexiblePresenterTypeHelper,
} from "games/Lexible/models/PresenterModel";
import {
  OneOhOnePresenterModel,
  getOneOhOnePresenterTypeHelper,
} from "games/OneOhOne/models/PresenterModel";
import {
  PartyPixPresenterModel,
  getPartyPixPresenterTypeHelper,
} from "games/PartyPix/models/PresenterModel";
import {
  RetroSpectroPresenterModel,
  getRetroSpectroPresenterTypeHelper,
} from "games/RetroSpectro/models/PresenterModel";
import {
  TemplatePresenterModel,
  getTemplatePresenterTypeHelper,
} from "games/TemplateGame/models/PresenterModel";
import {
  StressatoPresenterModel,
  getStressatoPresenterTypeHelper,
} from "games/stressgame/models/PresenterModel";

// ==========================================================================================
// The cross-game regression net.
//
// Every game inherits its lifecycle from ClusterfunPresenterModel, and until now only two of
// the seven had a presenter spec at all - so a change to the base class or the serializer
// could break the other five silently, and the way you found out was eight people watching a
// game that would not start.
//
// These tests do not know anything about any game's rules.  They drive the lifecycle EVERY
// game must survive, against each game's REAL presenter and REAL type helper:
//
//   join -> checkpoint round-trip -> drop -> rejoin -> play again -> shut down
//
// The serializer round-trip is the most valuable of them.  A type helper that has forgotten a
// class is invisible until somebody refreshes mid-game and the party restarts; here it is a
// failing test with the game's name on it.
//
// Adding a game?  Add it to GAMES.  If it will not survive this, it will not survive a party.
// ==========================================================================================

type PresenterCtor = new (
  session: ISessionHelper,
  logger: ITelemetryLogger,
  storage: IStorage,
) => ClusterfunPresenterModel<ClusterFunPlayer>;

interface GameUnderTest {
  name: string;
  Model: PresenterCtor;
  typeHelper: (session: ISessionHelper, props: ClusterFunGameProps) => ITypeHelper;
}

const GAMES: GameUnderTest[] = [
  {
    name: "Eittris",
    Model: EittrisPresenterModel as any,
    typeHelper: getEittrisPresenterTypeHelper,
  },
  {
    name: "Lexible",
    Model: LexiblePresenterModel as any,
    typeHelper: getLexiblePresenterTypeHelper,
  },
  {
    name: "OneOhOne",
    Model: OneOhOnePresenterModel as any,
    typeHelper: getOneOhOnePresenterTypeHelper,
  },
  {
    name: "PartyPix",
    Model: PartyPixPresenterModel as any,
    typeHelper: getPartyPixPresenterTypeHelper,
  },
  {
    name: "RetroSpectro",
    Model: RetroSpectroPresenterModel as any,
    typeHelper: getRetroSpectroPresenterTypeHelper,
  },
  {
    name: "Template",
    Model: TemplatePresenterModel as any,
    typeHelper: getTemplatePresenterTypeHelper,
  },
  {
    name: "Stressato",
    Model: StressatoPresenterModel as any,
    typeHelper: getStressatoPresenterTypeHelper,
  },
];

function memoryStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    set: (n, v) => void (v ? map.set(n, v) : map.delete(n)),
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

const silentLogger: ITelemetryLogger = {
  logEvent: () => {},
  logPageView: () => {},
  logAnalyticsEvent: () => {},
};

// reconstitute() starts a ticker, and a leaked one keeps Jest alive.
const built: ClusterfunPresenterModel<ClusterFunPlayer>[] = [];
afterEach(() => {
  while (built.length) {
    try {
      built.pop()!.shutdown();
    } catch {
      /* teardown is best-effort; a failure here must not mask a real one */
    }
  }
});

// Built the way the framework builds one, not by calling the constructor:
// instantiateGame is what wires up the serializer and what would restore a
// saved game, so a test that skips it is testing a different object than the
// app runs.
function makePresenter(game: GameUnderTest) {
  const session = fakeSession();
  const storage = memoryStorage();
  const props = { logger: silentLogger, storage } as unknown as ClusterFunGameProps;
  const typeHelper = getPresenterTypeHelper(game.typeHelper(session, props));
  // instantiateGame's return widens to BaseGameModel (it can return either a
  // restored model or a fresh one), so narrow it back at the boundary.
  const model = instantiateGame<ClusterfunPresenterModel<ClusterFunPlayer>>(
    typeHelper,
    silentLogger,
    storage,
  ) as ClusterfunPresenterModel<ClusterFunPlayer>;
  model.reconstitute();
  built.push(model);
  return { model, session, storage, typeHelper };
}

const join = (
  model: ClusterfunPresenterModel<ClusterFunPlayer>,
  connectionId: string,
  name: string,
  token: string,
) => model.handleJoinMessage(connectionId, { playerName: name, playerToken: token });

describe.each(GAMES.map((g) => [g.name, g] as const))("%s - lifecycle", (_name, game) => {
  it("lets a player join and gives them a permanent id", async () => {
    const { model } = makePresenter(game);
    const ack = await join(model, "conn-1", "Alice", "token-alice");

    expect(ack.didJoin).toBe(true);
    expect(model.players.length).toBe(1);
    expect(ack.playerId).toBe(model.players[0].playerId);
    expect(model.players[0].connectionId).toBe("conn-1");
    expect(model.players[0].isConnected).toBe(true);
  });

  it("keeps the seat, the id and the state when a phone drops", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    const idBefore = model.players[0].playerId;

    model.handlePlayerQuitMessage(idBefore, {});

    expect(model.players.length).toBe(1); // still at the table
    expect(model.players[0].isConnected).toBe(false);
    expect(model.players[0].playerId).toBe(idBefore);
  });

  it("moves only the connection when they come back", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    const idBefore = model.players[0].playerId;
    model.handlePlayerQuitMessage(idBefore, {});

    const ack = await join(model, "conn-2", "Alice", "token-alice");

    expect(ack.isRejoin).toBe(true);
    expect(model.players.length).toBe(1);
    expect(model.players[0].playerId).toBe(idBefore); // permanent
    expect(model.players[0].connectionId).toBe("conn-2"); // transient
    expect(model.players[0].isConnected).toBe(true);
  });

  it("does not let a stranger take a seat by typing the name", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    model.handlePlayerQuitMessage(model.players[0].playerId, {});

    const ack = await join(model, "imposter", "Alice", "token-imposter");

    expect(ack.isRejoin).toBe(false);
    expect(model.players[0].connectionId).not.toBe("imposter");
  });

  // ------------------------------------------------------------------
  // The one that catches type-helper mistakes.
  //
  // A class the helper has forgotten serializes to nothing useful and comes
  // back as a plain object with no methods.  Nothing notices until a host
  // refreshes mid-game, at which point the party restarts for no visible
  // reason.  Doing it here means the failure names the game.
  // ------------------------------------------------------------------
  it("survives a real serializer round-trip", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    await join(model, "conn-2", "Bob", "token-bob");

    // The model's own serializer - the one the framework gave it, wrapping this
    // game's own type helper.  Anything else would be testing a different setup
    // than the one that runs.
    const serializer = model.serializer!;
    expect(serializer).toBeTruthy();

    const json = serializer.stringify(model);
    expect(json.length).toBeGreaterThan(0);

    const restored = serializer.parse<ClusterfunPresenterModel<ClusterFunPlayer>>(json);
    built.push(restored);

    // The roster is the part every game has, so it is the part worth asserting.
    expect(restored.players.length).toBe(2);
    expect(restored.players.map((p) => p.name).sort()).toEqual(["Alice", "Bob"]);
    expect(restored.players.map((p) => p.playerId).sort()).toEqual(
      model.players.map((p) => p.playerId).sort(),
    );
    // Identity and connection are not game state and must come back intact,
    // or every phone in the room is a stranger after a refresh.
    expect(restored.players[0].playerToken).toBe(model.players[0].playerToken);
    expect(restored.players[0].connectionId).toBe(model.players[0].connectionId);
    expect(restored.players[0].isConnected).toBe(model.players[0].isConnected);
    expect(restored.gameState).toBe(model.gameState);
  });

  it("keeps identity across play again", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    const before = {
      id: model.players[0].playerId,
      token: model.players[0].playerToken,
      connection: model.players[0].connectionId,
    };

    model.gameState = GeneralGameState.GameOver;
    model.playAgain(false);

    expect(model.players.length).toBe(1);
    expect(model.players[0].playerId).toBe(before.id);
    expect(model.players[0].playerToken).toBe(before.token);
    expect(model.players[0].connectionId).toBe(before.connection);
  });

  it("can be shut down without throwing", async () => {
    const { model } = makePresenter(game);
    await join(model, "conn-1", "Alice", "token-alice");
    expect(() => model.shutdown()).not.toThrow();
    // ...and again, because Destroyed can arrive more than once
    expect(() => model.shutdown()).not.toThrow();
  });
});
