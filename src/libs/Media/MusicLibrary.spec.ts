import { MusicLibrary, hashFromFilename } from "./MusicLibrary";

// The one rule that matters here: nothing this class does may throw into a game.  Every
// way a manifest can go wrong is a test, because the alternative is a music server outage
// stopping a party.

const BASE = "https://music.example.com";

const goodManifest = {
  schema: 1,
  version: "2026-07-30",
  tracks: [
    {
      id: "eittris-main",
      file: "tracks/eittris-main.a91f3c.m4a",
      title: "Falling Blocks",
      seconds: 184,
      bytes: 2950000,
    },
    { id: "eittris-fast", file: "tracks/eittris-fast.7d0e12.m4a", title: "Speedrun" },
  ],
};

function fakeFetch(body: any, init?: { ok?: boolean; status?: number }) {
  const calls: string[] = [];
  const fetcher = (async (url: any) => {
    calls.push(String(url));
    return {
      ok: init?.ok ?? true,
      status: init?.status ?? 200,
      json: async () => {
        if (body instanceof Error) throw body;
        return body;
      },
    } as any;
  }) as any;
  return { fetcher, calls };
}

describe("MusicLibrary", () => {
  it("resolves every track to an absolute URL", async () => {
    const { fetcher, calls } = fakeFetch(goodManifest);
    const tracks = await new MusicLibrary(BASE, fetcher).loadManifest();

    expect(calls).toEqual([`${BASE}/music.json`]);
    expect(tracks.map((t) => t.url)).toEqual([
      `${BASE}/tracks/eittris-main.a91f3c.m4a`,
      `${BASE}/tracks/eittris-fast.7d0e12.m4a`,
    ]);
  });

  it("keeps the manifest version so a presenter can say which music it has", async () => {
    const { fetcher } = fakeFetch(goodManifest);
    const library = new MusicLibrary(BASE, fetcher);
    await library.loadManifest();
    expect(library.version).toBe("2026-07-30");
  });

  it("fills in defaults for the optional fields", async () => {
    const { fetcher } = fakeFetch(goodManifest);
    const tracks = await new MusicLibrary(BASE, fetcher).loadManifest();
    expect(tracks[1].seconds).toBe(0);
    expect(tracks[1].bytes).toBe(0);
    expect(tracks[1].title).toBe("Speedrun");
  });

  it("tolerates a trailing slash on the base URL", async () => {
    const { fetcher, calls } = fakeFetch(goodManifest);
    await new MusicLibrary(`${BASE}///`, fetcher).loadManifest();
    expect(calls[0]).toBe(`${BASE}/music.json`);
  });

  it("returns nothing, and makes no request, when no base URL is configured", async () => {
    const { fetcher, calls } = fakeFetch(goodManifest);
    for (const baseUrl of [undefined, "", "   "]) {
      const library = new MusicLibrary(baseUrl, fetcher);
      expect(library.isEnabled).toBe(false);
      expect(await library.loadManifest()).toEqual([]);
    }
    expect(calls).toEqual([]);
  });

  it("returns nothing on a 404 rather than throwing", async () => {
    const { fetcher } = fakeFetch(null, { ok: false, status: 404 });
    expect(await new MusicLibrary(BASE, fetcher).loadManifest()).toEqual([]);
  });

  it("returns nothing when the network (or CORS) rejects", async () => {
    const rejecting = (async () => {
      throw new TypeError("Failed to fetch");
    }) as any;
    expect(await new MusicLibrary(BASE, rejecting).loadManifest()).toEqual([]);
  });

  it("returns nothing on malformed JSON", async () => {
    const { fetcher } = fakeFetch(new SyntaxError("Unexpected token <"));
    expect(await new MusicLibrary(BASE, fetcher).loadManifest()).toEqual([]);
  });

  it("ignores a manifest whose schema it does not know", async () => {
    const { fetcher } = fakeFetch({ ...goodManifest, schema: 99 });
    expect(await new MusicLibrary(BASE, fetcher).loadManifest()).toEqual([]);
  });

  it("drops entries that are not tracks, keeping the ones that are", async () => {
    const { fetcher } = fakeFetch({
      schema: 1,
      tracks: [null, { id: "no-file" }, { file: "no-id.m4a" }, goodManifest.tracks[0]],
    });
    const tracks = await new MusicLibrary(BASE, fetcher).loadManifest();
    expect(tracks.map((t) => t.id)).toEqual(["eittris-main"]);
  });

  it("survives a manifest that is not even an object", async () => {
    for (const body of [null, 42, "nope", []]) {
      const { fetcher } = fakeFetch(body);
      expect(await new MusicLibrary(BASE, fetcher).loadManifest()).toEqual([]);
    }
  });
});

describe("hashFromFilename", () => {
  it("pulls the content hash out of a track filename", () => {
    expect(hashFromFilename("tracks/eittris-main.a91f3c.m4a")).toBe("a91f3c");
    expect(hashFromFilename("eittris-main.A91F3C.m4a")).toBe("a91f3c");
  });

  it("falls back to the filename when a track was uploaded without a hash", () => {
    expect(hashFromFilename("tracks/plain.m4a")).toBe("plain.m4a");
  });
});
