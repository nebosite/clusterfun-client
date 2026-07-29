import { GameAnalytics } from "./GameAnalytics";
import { AnalyticsEvent } from "./AnalyticsTypes";
import { getDeviceId, DEVICE_ID_KEY } from "./DeviceId";
import { ITelemetryLogger } from "./TelemetryLogger";
import { IStorage } from "../storage/StorageHelper";

// -------------------------------------------------------------------
// The whole point of GameAnalytics is that a caller CANNOT forget the three
// dimensions every report is grouped by.  These tests pin that, plus the
// promise that analytics never throws into game code.
// -------------------------------------------------------------------

interface Sent {
  event: string;
  params: Record<string, any>;
}

function makeLogger(sent: Sent[], throwOnEvent = false): ITelemetryLogger {
  return {
    logEvent: () => {},
    logPageView: () => {},
    logAnalyticsEvent: (event, params) => {
      if (throwOnEvent) throw new Error("GA is down");
      sent.push({ event, params: params as Record<string, any> });
    },
  };
}

function makeAnalytics(sent: Sent[], overrides: Partial<Sent> = {}) {
  return new GameAnalytics(makeLogger(sent), {
    game: "Eittris",
    deviceId: "device-1",
    entity: "host",
    ...overrides,
  } as any);
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

describe("GameAnalytics - the standing dimensions", () => {
  it("stamps game, device and entity onto every single event", () => {
    const sent: Sent[] = [];
    const analytics = makeAnalytics(sent);
    analytics.track("word_played", { length: 7 });

    expect(sent.length).toBe(1);
    expect(sent[0].event).toBe("word_played");
    expect(sent[0].params).toEqual({
      length: 7,
      game: "Eittris",
      device_id: "device-1",
      entity: "host",
    });
  });

  it("will not let a caller's params overwrite the dimensions", () => {
    const sent: Sent[] = [];
    makeAnalytics(sent).track("sneaky", { game: "SomethingElse", entity: "client" });
    expect(sent[0].params.game).toBe("Eittris");
    expect(sent[0].params.entity).toBe("host");
  });

  it("drops undefined params rather than sending the string 'undefined'", () => {
    const sent: Sent[] = [];
    makeAnalytics(sent).track("partial", { present: 1, missing: undefined });
    expect("missing" in sent[0].params).toBe(false);
    expect(sent[0].params.present).toBe(1);
  });

  it("never throws into game code when the telemetry backend fails", () => {
    const analytics = new GameAnalytics(makeLogger([], true), {
      game: "Eittris",
      deviceId: "d",
      entity: "host",
    });
    expect(() => analytics.track("boom")).not.toThrow();
  });

  it("can be re-pointed at another game, keeping device and entity", () => {
    const sent: Sent[] = [];
    const lobby = new GameAnalytics(makeLogger(sent), {
      game: "Lobby",
      deviceId: "device-9",
      entity: "lobby",
    });
    lobby.forGame("Lexible").track("chose_game");
    expect(sent[0].params).toMatchObject({
      game: "Lexible",
      device_id: "device-9",
      entity: "lobby",
    });
  });
});

describe("GameAnalytics - the lifecycle events", () => {
  it("reports a game start with its player count", () => {
    const sent: Sent[] = [];
    makeAnalytics(sent).gameStarted(4);
    expect(sent[0].event).toBe(AnalyticsEvent.GameStarted);
    expect(sent[0].params).toMatchObject({ player_count: 4, replay: false, game: "Eittris" });
  });

  it("reports how a game ended, its length, and whether it finished", () => {
    const sent: Sent[] = [];
    const analytics = makeAnalytics(sent);
    analytics.gameEnded("completed", 5, 612.4);
    expect(sent[0].params).toMatchObject({
      outcome: "completed",
      completed: true,
      player_count: 5,
      duration_seconds: 612, // rounded, so GA gets an integer
    });

    analytics.gameEnded("abandoned", 2, 31);
    expect(sent[1].params).toMatchObject({ outcome: "abandoned", completed: false });
  });

  it("never reports a negative duration, however confused the clock is", () => {
    const sent: Sent[] = [];
    makeAnalytics(sent).gameEnded("completed", 1, -50);
    expect(sent[0].params.duration_seconds).toBe(0);
  });

  it("tells a first join apart from a reconnect, and says how it matched", () => {
    const sent: Sent[] = [];
    const analytics = makeAnalytics(sent);
    analytics.playerJoined(3);
    analytics.playerRejoined(3, "name");
    expect(sent[0].event).toBe(AnalyticsEvent.PlayerJoined);
    expect(sent[1].event).toBe(AnalyticsEvent.PlayerRejoined);
    expect(sent[1].params.matched_by).toBe("name");
  });
});

describe("getDeviceId", () => {
  it("mints an id once and returns the same one thereafter", () => {
    const storage = memoryStorage();
    const first = getDeviceId(storage);
    expect(first).toBeTruthy();
    expect(storage.get(DEVICE_ID_KEY)).toBe(first);
    expect(getDeviceId(storage)).toBe(first);
  });

  it("gives different browsers different ids", () => {
    expect(getDeviceId(memoryStorage())).not.toBe(getDeviceId(memoryStorage()));
  });

  it("still returns an id when storage is unavailable", () => {
    const broken: IStorage = {
      set: () => {
        throw new Error("quota");
      },
      get: () => {
        throw new Error("blocked");
      },
      remove: () => {},
      clear: () => {},
    };
    expect(getDeviceId(broken)).toBeTruthy();
  });
});

// -------------------------------------------------------------------
// A host reports as "Eittris" and its phones as "EittrisClient" unless
// something folds them together - and if they diverge, every by-game report
// silently splits in two.  BaseGameModel does the folding; this pins the rule
// it follows for all seven games in the repo.
// -------------------------------------------------------------------
describe("analytics game naming", () => {
  const canonical = (modelName: string) => modelName.replace(/Client$/, "");

  it("folds every client model name onto its host's game name", () => {
    const pairs: [string, string][] = [
      ["Eittris", "EittrisClient"],
      ["Lexible", "LexibleClient"],
      ["OneOhOne", "OneOhOneClient"],
      ["PartyPix", "PartyPixClient"],
      ["RetroSpectro", "RetroSpectroClient"],
      ["Template", "TemplateClient"],
      ["Stressato", "StressatoClient"],
    ];
    for (const [host, client] of pairs) {
      expect(canonical(client)).toBe(host);
      expect(canonical(host)).toBe(host); // and a host name is left alone
    }
  });

  it("only strips a trailing Client, not one in the middle of a name", () => {
    expect(canonical("ClientSideGame")).toBe("ClientSideGame");
  });
});
