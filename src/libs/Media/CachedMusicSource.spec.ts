import { CachedMusicSource, IMusicCache, musicCacheKey } from "./CachedMusicSource";
import { ResolvedTrack } from "./MusicLibrary";

// The rule under test throughout: a cache that misbehaves must degrade to streaming the
// remote URL, never to silence - and a bad response must never be stored, because a cached
// 404 would look valid forever.

const track = (id: string, hash = "a91f3c"): ResolvedTrack => ({
  id,
  file: `tracks/${id}.${hash}.m4a`,
  title: id,
  seconds: 100,
  bytes: 1000,
  url: `https://music.example.com/tracks/${id}.${hash}.m4a`,
});

class FakeCache implements IMusicCache {
  entries = new Map<string, Response>();
  throwOn: "match" | "put" | "keys" | null = null;
  async match(key: string) {
    if (this.throwOn === "match") throw new Error("cache broken");
    return this.entries.get(key);
  }
  async put(key: string, response: Response) {
    if (this.throwOn === "put") throw new Error("cache broken");
    this.entries.set(key, response);
  }
  async keys() {
    if (this.throwOn === "keys") throw new Error("cache broken");
    return [...this.entries.keys()];
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

function makeSource(opts?: { status?: number; ok?: boolean }) {
  const cache = new FakeCache();
  const fetched: string[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  let minted = 0;
  const fetcher = (async (url: any) => {
    fetched.push(String(url));
    return {
      ok: opts?.ok ?? true,
      status: opts?.status ?? 200,
      clone() {
        return this;
      },
      blob: async () => ({}) as Blob,
    } as any;
  }) as any;
  const source = new CachedMusicSource({
    cache,
    fetcher,
    objectUrls: {
      create: () => {
        const url = `blob:minted-${++minted}`;
        created.push(url);
        return url;
      },
      revoke: (url: string) => revoked.push(url),
    },
    requestPersistence: async () => true,
  });
  return { source, cache, fetched, created, revoked };
}

describe("CachedMusicSource", () => {
  it("fetches once, then serves the same track from cache", async () => {
    const { source, fetched } = makeSource();
    const first = await source.getPlayableUrl(track("main"));
    source.release(track("main"));
    const second = await source.getPlayableUrl(track("main"));

    expect(fetched).toEqual([track("main").url]);
    expect(first).toMatch(/^blob:/);
    expect(second).toMatch(/^blob:/);
  });

  it("hands back the URL it already minted rather than minting another", async () => {
    const { source, created } = makeSource();
    const a = await source.getPlayableUrl(track("main"));
    const b = await source.getPlayableUrl(track("main"));
    expect(a).toBe(b);
    expect(created.length).toBe(1);
  });

  it("keys on the track id and content hash, not on the base URL", async () => {
    const { source, cache } = makeSource();
    await source.getPlayableUrl(track("main"));
    const key = [...cache.entries.keys()][0];

    expect(key).toBe("https://music.clusterfun.invalid/main/a91f3c");
    expect(key).not.toContain("music.example.com");
    // A track served from a different domain resolves to the same cache entry
    const elsewhere = { ...track("main"), url: "https://other.example.net/tracks/main.a91f3c.m4a" };
    expect(musicCacheKey(elsewhere)).toBe(key);
  });

  it("does not cache a bad response, and streams instead", async () => {
    const { source, cache } = makeSource({ ok: false, status: 404 });
    const url = await source.getPlayableUrl(track("main"));
    expect(url).toBe(track("main").url);
    expect(cache.entries.size).toBe(0);
  });

  it("streams when the cache itself throws", async () => {
    const { source, cache } = makeSource();
    cache.throwOn = "match";
    expect(await source.getPlayableUrl(track("main"))).toBe(track("main").url);
  });

  it("releases by revoking the object URL", async () => {
    const { source, created, revoked } = makeSource();
    await source.getPlayableUrl(track("main"));
    source.release(track("main"));
    expect(revoked).toEqual(created);
    // Releasing twice is harmless
    source.release(track("main"));
    expect(revoked.length).toBe(1);
  });

  it("sweeps tracks that have left the manifest, and keeps the ones that have not", async () => {
    const { source, cache } = makeSource();
    await source.getPlayableUrl(track("keep"));
    await source.getPlayableUrl(track("drop"));
    expect(cache.entries.size).toBe(2);

    const swept = await source.sweep([track("keep")]);
    expect(swept).toBe(1);
    expect([...cache.entries.keys()]).toEqual([musicCacheKey(track("keep"))]);
  });

  it("sweeps a re-encoded track, because its content hash changed", async () => {
    const { source, cache } = makeSource();
    await source.getPlayableUrl(track("main", "a91f3c"));
    await source.sweep([track("main", "ffffff")]);
    expect([...cache.entries.keys()]).toEqual([]);
  });

  it("survives a cache that cannot even be listed", async () => {
    const { source, cache } = makeSource();
    await source.getPlayableUrl(track("main"));
    cache.throwOn = "keys";
    expect(await source.sweep([])).toBe(0);
  });

  it("asks for persistent storage once, on the first successful write", async () => {
    const cache = new FakeCache();
    let asked = 0;
    const source = new CachedMusicSource({
      cache,
      fetcher: (async () => ({
        ok: true,
        status: 200,
        clone() {
          return this;
        },
        blob: async () => ({}) as Blob,
      })) as any,
      objectUrls: { create: () => "blob:x", revoke: () => {} },
      requestPersistence: async () => {
        asked++;
        return true;
      },
    });
    await source.getPlayableUrl(track("one"));
    await source.getPlayableUrl(track("two"));
    expect(asked).toBe(1);
  });
});
