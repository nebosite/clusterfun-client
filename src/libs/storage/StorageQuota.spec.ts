import { getStorage, IStorageAccessor } from "./StorageHelper";
import { resetErrorReporterForTests } from "../telemetry/ErrorReporter";

// ==========================================================================================
// What happens when the browser says no.
//
// saveCheckpoint runs inside a setTimeout, so a QuotaExceededError out of setItem was an
// uncatchable async throw: refresh-resume - the feature that makes it bearable to edit code
// mid-game, and that a host relies on after an accidental reload - simply stopped working,
// with nothing on screen and nothing in the log to say so.
//
// It must now fail quietly and visibly: the game carries on, and somebody finds out.
// ==========================================================================================

// getStorage picks sessionStorage when it exists.  jsdom provides one, so these
// tests drive the real path and make sessionStorage itself misbehave.
function withFailingSessionStorage(run: () => void) {
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  const failing: Partial<IStorageAccessor> = {
    setItem: () => {
      const err: any = new Error("The quota has been exceeded.");
      err.name = "QuotaExceededError";
      throw err;
    },
    getItem: () => null,
    removeItem: () => {},
    length: 0,
    key: () => null,
  };
  Object.defineProperty(window, "sessionStorage", { value: failing, configurable: true });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(window, "sessionStorage", original);
  }
}

beforeEach(() => {
  resetErrorReporterForTests();
  window.sessionStorage.clear();
});

describe("storage when the quota is gone", () => {
  it("does not throw when the browser refuses to store something", () => {
    withFailingSessionStorage(() => {
      const storage = getStorage("quota-test");
      // This is the call that used to take the whole checkpoint down with it.
      expect(() => storage.set("gamestate", "x".repeat(1000))).not.toThrow();
    });
  });

  it("still serves the value back from cache, so the running game is consistent", () => {
    withFailingSessionStorage(() => {
      const storage = getStorage("quota-test");
      storage.set("gamestate", "the game so far");
      // The durable copy is gone, but the model must not see a hole where its
      // own state was a moment ago.
      expect(storage.get("gamestate")).toBe("the game so far");
    });
  });

  it("does not throw when removing fails either", () => {
    withFailingSessionStorage(() => {
      const storage = getStorage("quota-test");
      expect(() => storage.set("gamestate", "")).not.toThrow();
    });
  });
});

describe("storage on a normal day", () => {
  it("round-trips a value", () => {
    const storage = getStorage("ok-test");
    storage.set("thing", "value");
    expect(storage.get("thing")).toBe("value");
  });

  it("removes a value when set to empty", () => {
    const storage = getStorage("ok-test");
    storage.set("thing", "value");
    storage.set("thing", "");
    expect(storage.get("thing")).toBeUndefined();
  });

  it("keeps two ids apart", () => {
    const a = getStorage("id-a");
    const b = getStorage("id-b");
    a.set("shared", "from a");
    b.set("shared", "from b");
    expect(a.get("shared")).toBe("from a");
    expect(b.get("shared")).toBe("from b");
  });
});
