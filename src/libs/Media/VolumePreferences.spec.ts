import { VolumePreferences, VOLUME_PREFS_KEY, DEFAULT_VOLUMES } from "./VolumePreferences";

// A host reloads the shared screen mid-party - the game resumes from its checkpoint, and the
// volume must come back with it.  Everything else here is about never letting a bad saved
// value silence, or blast, a room.

class FakeStorage {
  items = new Map<string, string>();
  failWrites = false;
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  key() {
    return null;
  }
  get length() {
    return this.items.size;
  }
}

const make = () => {
  const storage = new FakeStorage();
  return { storage, prefs: new VolumePreferences(storage as unknown as Storage) };
};

describe("VolumePreferences", () => {
  it("starts at the defaults - music under the sound effects", () => {
    const { prefs } = make();
    expect(prefs.load()).toEqual(DEFAULT_VOLUMES);
    expect(DEFAULT_VOLUMES.music).toBeLessThan(DEFAULT_VOLUMES.effects);
  });

  it("survives a reload", () => {
    const { storage, prefs } = make();
    prefs.save({ effects: 0.4, music: 0.15 });
    const reloaded = new VolumePreferences(storage as unknown as Storage);
    expect(reloaded.load()).toEqual({ effects: 0.4, music: 0.15 });
  });

  it("clamps what it stores", () => {
    const { prefs } = make();
    prefs.save({ effects: 7, music: -3 });
    expect(prefs.load()).toEqual({ effects: 1, music: 0 });
  });

  it("keeps a real zero rather than treating it as missing", () => {
    const { prefs } = make();
    prefs.save({ effects: 0, music: 0 });
    expect(prefs.load()).toEqual({ effects: 0, music: 0 });
  });

  it("falls back to defaults for junk in storage", () => {
    const { storage, prefs } = make();
    for (const junk of ["not json", "null", '{"effects":"loud"}', '{"music":null}', "[]"]) {
      storage.items.set(VOLUME_PREFS_KEY, junk);
      const loaded = prefs.load();
      expect(loaded.effects).toBeGreaterThanOrEqual(0);
      expect(loaded.effects).toBeLessThanOrEqual(1);
      expect(loaded.music).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the half it can read when the other half is junk", () => {
    const { storage, prefs } = make();
    storage.items.set(VOLUME_PREFS_KEY, '{"effects":0.5,"music":"loud"}');
    expect(prefs.load()).toEqual({ effects: 0.5, music: DEFAULT_VOLUMES.music });
  });

  it("does not throw when storage refuses to write", () => {
    const { storage, prefs } = make();
    storage.failWrites = true;
    expect(() => prefs.save({ effects: 0.5, music: 0.5 })).not.toThrow();
  });

  it("uses the browser's own storage when none is handed to it", () => {
    const prefs = new VolumePreferences();
    prefs.save({ effects: 0.25, music: 0.75 });
    expect(JSON.parse(localStorage.getItem(VOLUME_PREFS_KEY)!)).toEqual({
      effects: 0.25,
      music: 0.75,
    });
    localStorage.removeItem(VOLUME_PREFS_KEY);
  });

  it("survives a browser with storage switched off", () => {
    // Not undefined - a storage object whose every method throws, which is what a
    // locked-down browser actually gives you.
    const hostile = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const prefs = new VolumePreferences(hostile);
    expect(() => prefs.save({ effects: 0.5, music: 0.5 })).not.toThrow();
    expect(prefs.load()).toEqual(DEFAULT_VOLUMES);
  });
});
