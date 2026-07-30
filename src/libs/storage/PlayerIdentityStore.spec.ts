import {
  PlayerIdentityStore,
  PLAYER_IDENTITY_KEY,
  PLAYER_TOKEN_KEY,
  BLANK_IDENTITY,
} from "./PlayerIdentityStore";
import { IStorageAccessor } from "./StorageHelper";

// This is what makes "open the browser and see your old name" work, so the
// properties that matter are: it round-trips, it survives junk, and it never
// throws into lobby startup.

function memoryAccessor(seed: Record<string, string> = {}): IStorageAccessor {
  const map = new Map(Object.entries(seed));
  return {
    setItem: (n, v) => void map.set(n, v),
    getItem: (n) => map.get(n) ?? null,
    removeItem: (n) => void map.delete(n),
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

const brokenAccessor: IStorageAccessor = {
  setItem: () => {
    throw new Error("quota exceeded");
  },
  getItem: () => {
    throw new Error("access denied");
  },
  removeItem: () => {
    throw new Error("nope");
  },
  length: 0,
  key: () => null,
};

describe("PlayerIdentityStore", () => {
  it("remembers a name, avatar, color and room code", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ playerName: "Ann", avatarId: 7, avatarColor: 3, roomId: "AB12" });
    expect(store.load()).toEqual({
      playerName: "Ann",
      avatarId: 7,
      avatarColor: 3,
      roomId: "AB12",
    });
  });

  it("merges partial saves instead of blanking the rest", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ playerName: "Ann", avatarId: 7 });
    store.save({ roomId: "WXYZ" });
    expect(store.load()).toMatchObject({ playerName: "Ann", avatarId: 7, roomId: "WXYZ" });
  });

  it("returns a blank identity for a first-time visitor", () => {
    expect(new PlayerIdentityStore(memoryAccessor()).load()).toEqual(BLANK_IDENTITY);
  });

  it("forgets only the room code when the game ends", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ playerName: "Ann", avatarId: 4, avatarColor: 2, roomId: "AB12" });
    store.forgetRoom();
    const after = store.load();
    expect(after.roomId).toBe("");
    expect(after).toMatchObject({ playerName: "Ann", avatarId: 4, avatarColor: 2 });
  });

  it("forgetAll wipes the lot", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ playerName: "Ann", roomId: "AB12" });
    store.forgetAll();
    expect(store.load()).toEqual(BLANK_IDENTITY);
  });
});

describe("PlayerIdentityStore - refusing to trust what it reads", () => {
  it("survives a corrupt entry", () => {
    const store = new PlayerIdentityStore(memoryAccessor({ [PLAYER_IDENTITY_KEY]: "{ not json" }));
    expect(store.load()).toEqual(BLANK_IDENTITY);
  });

  it("survives an entry that is valid JSON but the wrong shape", () => {
    for (const junk of ["null", "[1,2,3]", '"a string"', "42"]) {
      const store = new PlayerIdentityStore(memoryAccessor({ [PLAYER_IDENTITY_KEY]: junk }));
      expect(store.load().playerName).toBe("");
    }
  });

  it("coerces nonsense field values into something usable", () => {
    const store = new PlayerIdentityStore(
      memoryAccessor({
        [PLAYER_IDENTITY_KEY]: JSON.stringify({
          playerName: 12345,
          avatarId: "not a number",
          avatarColor: -5,
          roomId: "ab-12!!",
        }),
      }),
    );
    const loaded = store.load();
    expect(loaded.playerName).toBe(""); // a number is not a name
    expect(loaded.avatarId).toBe(0);
    expect(loaded.avatarColor).toBe(0); // negative is not an index
    expect(loaded.roomId).toBe("AB12"); // uppercased, punctuation dropped
  });

  it("truncates an over-long name and code", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ playerName: "x".repeat(50), roomId: "ABCDEFGH" });
    // The stored value is trimmed on the way back out
    expect(store.load().playerName.length).toBeLessThanOrEqual(16);
    expect(store.load().roomId.length).toBeLessThanOrEqual(4);
  });

  it("keeps working for this page load when storage is unavailable", () => {
    // Private browsing, a full quota, a locked-down browser: the lobby must
    // still work, it just cannot remember you next time.
    const store = new PlayerIdentityStore(brokenAccessor);
    expect(() => store.save({ playerName: "Ann", avatarId: 3 })).not.toThrow();
    expect(store.load()).toMatchObject({ playerName: "Ann", avatarId: 3 });
    expect(() => store.forgetAll()).not.toThrow();
  });
});

describe("PlayerIdentityStore - the reconnect token", () => {
  it("mints one on first use and keeps it", () => {
    const store = new PlayerIdentityStore(memoryAccessor(), memoryAccessor());
    const first = store.token();
    expect(first).toBeTruthy();
    expect(store.token()).toBe(first);
  });

  it("lives in the per-tab store, NOT alongside the long-term identity", () => {
    // This is what lets two clients run on one PC: localStorage is shared by
    // every tab, so a token kept there would make both tabs the same player.
    const identity = memoryAccessor();
    const tab = memoryAccessor();
    const store = new PlayerIdentityStore(identity, tab);
    const token = store.token();

    expect(tab.getItem(PLAYER_TOKEN_KEY)).toBe(token);
    expect(identity.getItem(PLAYER_IDENTITY_KEY) ?? "").not.toContain(token);
  });

  it("gives two tabs sharing one long-term identity different tokens", () => {
    // Same person, same remembered name and avatar, two windows open - and
    // they must still be two separate players.
    const sharedIdentity = memoryAccessor();
    const tabA = new PlayerIdentityStore(sharedIdentity, memoryAccessor());
    const tabB = new PlayerIdentityStore(sharedIdentity, memoryAccessor());
    expect(tabA.token()).not.toBe(tabB.token());
  });

  it("keeps the token when the room code is forgotten", () => {
    // The token has to outlive a game, or reconnecting after one ends - which
    // is exactly when you want to rejoin - would mint a brand new identity.
    const store = new PlayerIdentityStore(memoryAccessor(), memoryAccessor());
    const token = store.token();
    store.save({ roomId: "AB12" });
    store.forgetRoom();
    expect(store.token()).toBe(token);
    expect(store.load().roomId).toBe("");
  });

  it("survives a save of everything else", () => {
    const store = new PlayerIdentityStore(memoryAccessor(), memoryAccessor());
    const token = store.token();
    store.save({ playerName: "Ann", avatarId: 4, avatarColor: 2, roomId: "WXYZ" });
    expect(store.token()).toBe(token);
  });

  it("still hands out a token when storage is unavailable", () => {
    const store = new PlayerIdentityStore(brokenAccessor, brokenAccessor);
    const token = store.token();
    expect(token).toBeTruthy();
    expect(store.token()).toBe(token); // stable for this page load
  });
});

describe("PlayerIdentityStore - several clients sharing one tab", () => {
  it("gives scoped stores different tokens even in the same tab storage", () => {
    // The Test Lobby runs four clients on ONE page.  Without a scope they
    // would all present the same token and be taken for the same player.
    const sharedTab = memoryAccessor();
    const client0 = new PlayerIdentityStore(memoryAccessor(), sharedTab, "client0");
    const client1 = new PlayerIdentityStore(memoryAccessor(), sharedTab, "client1");
    expect(client0.token()).not.toBe(client1.token());
  });

  it("keeps each scope's token stable across reloads", () => {
    const sharedTab = memoryAccessor();
    const first = new PlayerIdentityStore(memoryAccessor(), sharedTab, "client2").token();
    const again = new PlayerIdentityStore(memoryAccessor(), sharedTab, "client2").token();
    expect(again).toBe(first);
  });

  it("leaves an unscoped store on the plain key - one client per tab", () => {
    const tab = memoryAccessor();
    const token = new PlayerIdentityStore(memoryAccessor(), tab).token();
    expect(tab.getItem(PLAYER_TOKEN_KEY)).toBe(token);
  });
});
