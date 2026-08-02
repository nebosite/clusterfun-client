import {
  PlayerIdentityStore,
  PLAYER_IDENTITY_KEY,
  PLAYER_TOKENS_KEY,
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
      roomSavedAt: expect.any(Number),
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
          // Freshly saved: this test is about coercing the VALUES, not about expiry
          roomSavedAt: Date.now(),
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
  it("mints one per name and keeps it", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    const first = store.token("Ann");
    expect(first).toBeTruthy();
    expect(store.token("Ann")).toBe(first);
  });

  it("gives differently-named players different tokens", () => {
    // This is what lets several clients share one PC - and one browser, and
    // even one page, as the Test Lobby does.
    const store = new PlayerIdentityStore(memoryAccessor());
    expect(store.token("Ann")).not.toBe(store.token("Bob"));
  });

  it("survives a reload, unlike a per-tab token", () => {
    // A token has to outlive the tab, or closing the browser would cost you
    // your seat in a game you are still playing.
    const shared = memoryAccessor();
    const first = new PlayerIdentityStore(shared).token("Ann");
    expect(new PlayerIdentityStore(shared).token("Ann")).toBe(first);
  });

  it("keeps every name's token when a new one is added", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    const ann = store.token("Ann");
    store.token("Bob");
    store.token("Cass");
    expect(store.token("Ann")).toBe(ann);
  });

  it("treats a blank name as its own player rather than throwing", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    expect(store.token("")).toBeTruthy();
    expect(store.token("   ")).toBe(store.token(""));
  });

  it("ignores leading and trailing space, so 'Ann ' is still Ann", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    expect(store.token(" Ann ")).toBe(store.token("Ann"));
  });

  it("is kept apart from the remembered name and avatar", () => {
    const accessor = memoryAccessor();
    const store = new PlayerIdentityStore(accessor);
    const token = store.token("Ann");
    store.save({ playerName: "Ann", avatarId: 4 });
    expect(accessor.getItem(PLAYER_IDENTITY_KEY) ?? "").not.toContain(token);
    expect(accessor.getItem(PLAYER_TOKENS_KEY) ?? "").toContain(token);
  });

  it("keeps the token when the room code is forgotten", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    const token = store.token("Ann");
    store.save({ roomId: "AB12" });
    store.forgetRoom();
    expect(store.token("Ann")).toBe(token);
    expect(store.load().roomId).toBe("");
  });

  it("survives a corrupt or hostile token blob", () => {
    for (const junk of ["{ not json", "[1,2,3]", "null", '{"Ann": 42}']) {
      const store = new PlayerIdentityStore(memoryAccessor({ [PLAYER_TOKENS_KEY]: junk }));
      expect(store.token("Ann")).toBeTruthy();
    }
  });

  it("still hands out stable tokens when storage is unavailable", () => {
    const store = new PlayerIdentityStore(brokenAccessor);
    const ann = store.token("Ann");
    expect(ann).toBeTruthy();
    expect(store.token("Ann")).toBe(ann);
    expect(store.token("Bob")).not.toBe(ann);
  });

  it("forgetAll drops the tokens too", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    const ann = store.token("Ann");
    store.forgetAll();
    expect(store.token("Ann")).not.toBe(ann);
  });
});

describe("PlayerIdentityStore - a room code goes stale", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("offers a code saved a few hours ago", () => {
    let now = 1_000_000_000_000;
    const accessor = memoryAccessor();
    const store = new PlayerIdentityStore(accessor, () => now);
    store.save({ playerName: "Ann", roomId: "AB12" });

    now += 6 * 60 * 60 * 1000; // six hours later, same evening
    expect(store.load().roomId).toBe("AB12");
  });

  it("still offers it just under a day later", () => {
    let now = 1_000_000_000_000;
    const store = new PlayerIdentityStore(memoryAccessor(), () => now);
    store.save({ roomId: "AB12" });

    now += DAY - 60_000;
    expect(store.load().roomId).toBe("AB12");
  });

  it("forgets a code older than a day, keeping the name and avatar", () => {
    // Rooms do not live anywhere near that long, so an old code would only send
    // somebody to a room that is not there.
    let now = 1_000_000_000_000;
    const store = new PlayerIdentityStore(memoryAccessor(), () => now);
    store.save({ playerName: "Ann", avatarId: 3, roomId: "AB12" });

    now += DAY + 60_000;
    const identity = store.load();
    expect(identity.roomId).toBe("");
    expect(identity.playerName).toBe("Ann");
    expect(identity.avatarId).toBe(3);
  });

  it("restamps the clock when a new code is saved", () => {
    let now = 1_000_000_000_000;
    const store = new PlayerIdentityStore(memoryAccessor(), () => now);
    store.save({ roomId: "AB12" });

    now += DAY - 1000;
    store.save({ roomId: "CD34" }); // a fresh code gets a fresh day
    now += DAY - 1000;
    expect(store.load().roomId).toBe("CD34");
  });

  it("does not resurrect a code that was deliberately forgotten", () => {
    const store = new PlayerIdentityStore(memoryAccessor());
    store.save({ roomId: "AB12" });
    store.forgetRoom();
    expect(store.load().roomId).toBe("");
  });

  it("treats an identity written before this existed as stale", () => {
    // Anything saved by an older build has no timestamp, so it reads as long ago.
    const accessor = memoryAccessor();
    accessor.setItem(
      PLAYER_IDENTITY_KEY,
      JSON.stringify({ playerName: "Ann", avatarId: 1, avatarColor: 2, roomId: "AB12" }),
    );
    const store = new PlayerIdentityStore(accessor);
    expect(store.load().roomId).toBe("");
    expect(store.load().playerName).toBe("Ann");
  });
});
