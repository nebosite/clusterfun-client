import { PlayerIdentityStore, PLAYER_IDENTITY_KEY, BLANK_IDENTITY } from "./PlayerIdentityStore";
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
