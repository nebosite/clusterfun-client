import { LobbyModel, ILobbyDependencies } from "./LobbyModel";
import { PLAYER_IDENTITY_KEY } from "../../libs/storage/PlayerIdentityStore";
import { MockTelemetryLoggerFactory } from "../../libs/telemetry/MockTelemetryLogger";

// Two things here are worth pinning:
//  - the lobby remembers who you are between visits (and forgets a stale room)
//  - a failed join says something useful, because it happens on somebody
//    else's phone, at a party, once.

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    set: (n: string, v: string) => void map.set(n, v),
    get: (n: string) => map.get(n) ?? null,
    remove: (n: string) => void map.delete(n),
    clear: () => map.clear(),
  };
}

function makeLobby(serverCall?: ILobbyDependencies["serverCall"]) {
  const calls: { url: string; payload: any }[] = [];
  const deps: ILobbyDependencies = {
    serverCall:
      serverCall ??
      (async (url: string, payload: any) => {
        calls.push({ url, payload });
        return {} as any;
      }),
    storage: memoryStorage(),
    telemetryFactory: new MockTelemetryLoggerFactory() as any,
    messageThingFactory: (() => ({}) as any) as any,
    onGameEnded: () => {},
  };
  return { model: new LobbyModel(deps, "test"), calls };
}

beforeEach(() => localStorage.clear());

describe("LobbyModel - remembering who you are", () => {
  it("keeps your name, avatar and room code for the next visit", () => {
    const first = makeLobby().model;
    first.playerName = "Ann";
    first.avatarId = 9;
    first.avatarColor = 4;
    first.roomId = "ab12";

    // A brand new lobby - as if the browser had been closed and reopened
    const second = makeLobby().model;
    expect(second.playerName).toBe("Ann");
    expect(second.avatarId).toBe(9);
    expect(second.avatarColor).toBe(4);
    expect(second.roomId).toBe("AB12"); // upper-cased on the way in
  });

  it("uses localStorage, not the per-session store", () => {
    const { model } = makeLobby();
    model.playerName = "Ann";
    expect(localStorage.getItem(PLAYER_IDENTITY_KEY)).toContain("Ann");
  });

  it("forgets a room code once the host says the game is over, but not you", () => {
    const { model } = makeLobby();
    model.playerName = "Ann";
    model.avatarId = 3;
    model.roomId = "WXYZ";

    (model as any).onGameEnded();

    expect(model.roomId).toBe("");
    const reopened = makeLobby().model;
    expect(reopened.roomId).toBe("");
    expect(reopened.playerName).toBe("Ann");
    expect(reopened.avatarId).toBe(3);
  });

  it("forgetMe clears the lot", () => {
    const { model } = makeLobby();
    model.playerName = "Ann";
    model.avatarId = 5;
    model.forgetMe();
    expect(makeLobby().model.playerName).toBe("");
    expect(makeLobby().model.avatarId).toBe(0);
  });

  it("only accepts room-code characters", () => {
    const { model } = makeLobby();
    model.roomId = "a b-1!2xyz";
    expect(model.roomId).toBe("AB12");
  });
});

describe("LobbyModel - when a join fails", () => {
  const failWith = (message: string) => async () => {
    throw new Error(message);
  };

  async function attempt(message: string) {
    const { model } = makeLobby(failWith(message) as any);
    model.playerName = "Ann";
    model.roomId = "AB12";
    await model.joinGame();
    // joinGame does not await its own promise chain
    await new Promise((r) => setTimeout(r, 5));
    return model;
  }

  it("explains a room that is not open, in the server's own words", async () => {
    const model = await attempt(
      'Server call failed{ "errorMessage": "Room AB12 is not open. Check the code on the big screen - and note that a room closes after an hour of quiet." }',
    );
    expect(model.joinDiagnostics!.category).toBe("no_such_room");
    expect(model.lobbyErrorMessage).toMatch(/not open/i);
    expect(model.lobbyErrorMessage).toMatch(/hour/i);
  });

  it("tells a network failure apart from a rejection", async () => {
    const model = await attempt("Failed to fetch");
    expect(model.joinDiagnostics!.category).toBe("offline");
    expect(model.lobbyErrorMessage).toMatch(/wifi|signal/i);
  });

  it("recognises a server-side crash and keeps the timecode", async () => {
    const model = await attempt(
      'Server call failed{ "errorMessage": "There was a server error in JoinGame.  Reference timecode 1785347000000" }',
    );
    expect(model.joinDiagnostics!.category).toBe("server_error");
    expect(model.joinDiagnostics!.reason).toMatch(/timecode 1785347000000/);
  });

  it("records what was attempted, so the report is self-contained", async () => {
    const model = await attempt("Failed to fetch");
    const d = model.joinDiagnostics!;
    expect(d.roomId).toBe("AB12");
    expect(d.playerName).toBe("Ann");
    expect(d.url).toBe("/api/joingame");
    expect(d.when).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const text = model.joinDiagnosticsText();
    expect(text).toContain("AB12");
    expect(text).toContain("Ann");
    expect(text).toContain("offline");
  });

  it("clears the previous failure when a join succeeds", async () => {
    const model = await attempt("Failed to fetch");
    expect(model.joinDiagnostics).not.toBeNull();

    (model as any)._serverCall = async () => ({ gameName: "Eittris", roomId: "AB12" });
    await model.joinGame();
    await new Promise((r) => setTimeout(r, 5));
    expect(model.joinDiagnostics).toBeNull();
    expect(model.lobbyErrorMessage).toBeUndefined();
  });

  it("has no diagnostics text before anything has gone wrong", () => {
    expect(makeLobby().model.joinDiagnosticsText()).toBe("");
  });
});
