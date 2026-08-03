import { IStorage } from "libs/storage/StorageHelper";
import { MockTelemetryLoggerFactory } from "libs/telemetry/MockTelemetryLogger";
import { GameTestModel } from "./GameTestModel";

// ==========================================================================================
// The Test Lobby remembers which game it is running across a page reload.  It stopped doing
// that, and the failure was ugly and remote from its cause: the NEXT client to join was sent
// to a game named "" and the page said "Could not find game ''".
//
// saveState wrote { presenterSize, gameName, joinCount } in that order, loadState did an
// Object.assign, and presenterSize's setter calls saveState().  So restoring the first key
// immediately re-saved the whole record while gameName was still "" - erasing it before
// Object.assign reached it.
//
// The Test Lobby is how every game gets verified, so a harness that quietly forgets what it
// is running costs more than it looks.
// ==========================================================================================

function memoryStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    set: (n, v) => void (v ? map.set(n, v) : map.delete(n)),
    get: (n) => map.get(n) ?? null,
    remove: (n) => void map.delete(n),
    clear: () => map.clear(),
  };
}

const built: GameTestModel[] = [];
function makeModel(storage: IStorage) {
  const model = new GameTestModel(2, storage, new MockTelemetryLoggerFactory());
  built.push(model);
  return model;
}

afterEach(() => {
  while (built.length) {
    const model = built.pop()!;
    try {
      (model as any).presenterModel?.shutdown?.();
    } catch {
      /* the harness owns a lot; a best-effort teardown is enough here */
    }
  }
});

describe("Test Lobby state across a reload", () => {
  it("remembers the game name", () => {
    const storage = memoryStorage();
    const first = makeModel(storage);
    first.gameName = "Lexible";
    first.saveState();

    // A page reload builds a fresh model over the same storage.
    const second = makeModel(storage);

    expect(second.gameName).toBe("Lexible");
  });

  it("remembers the join count, so client ids do not collide after a reload", () => {
    const storage = memoryStorage();
    const first = makeModel(storage);
    first.gameName = "Eittris";
    first.joinCount = 4;
    first.saveState();

    const second = makeModel(storage);

    // Reusing client0_id for a second player would hand them somebody's seat.
    expect(second.joinCount).toBe(4);
  });

  it("survives a reload that touches presenterSize first", () => {
    // This is the exact shape that broke it: presenterSize is the first key in
    // the saved record, and its setter saves.
    const storage = memoryStorage();
    const first = makeModel(storage);
    first.presenterSize = 1581;
    first.gameName = "PartyPix";
    first.joinCount = 2;
    first.saveState();

    const second = makeModel(storage);

    expect(second.presenterSize).toBe(1581);
    expect(second.gameName).toBe("PartyPix");
    expect(second.joinCount).toBe(2);
  });

  it("survives being reloaded twice", () => {
    // The original bug needed two loads to show itself: the first load wiped
    // the stored name, and the second read the wiped copy.
    const storage = memoryStorage();
    const first = makeModel(storage);
    first.presenterSize = 900;
    first.gameName = "OneOhOne";
    first.saveState();

    makeModel(storage); // reload once
    const third = makeModel(storage); // ...and again

    expect(third.gameName).toBe("OneOhOne");
  });

  it("starts blank when there is nothing saved", () => {
    const model = makeModel(memoryStorage());
    expect(model.gameName).toBe("");
    expect(model.joinCount).toBe(0);
  });
});
