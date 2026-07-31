import { MusicLibrary, hashFromFilename, trackContentHash } from "./MusicLibrary";

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

  it("works from a same-origin path, which is how the server hosts it", async () => {
    const { fetcher, calls } = fakeFetch(goodManifest);
    const tracks = await new MusicLibrary("/music", fetcher).loadManifest();
    expect(calls).toEqual(["/music/music.json"]);
    expect(tracks[0].url).toBe("/music/tracks/eittris-main.a91f3c.m4a");
  });

  it("treats a bare / as music at the origin root, not as music turned off", async () => {
    const { fetcher, calls } = fakeFetch(goodManifest);
    const library = new MusicLibrary("/", fetcher);
    expect(library.isEnabled).toBe(true);
    const tracks = await library.loadManifest();
    expect(calls).toEqual(["/music.json"]);
    expect(tracks[0].url).toBe("/tracks/eittris-main.a91f3c.m4a");
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

describe("MusicLibrary - real filenames and content hashes", () => {
  // What the server actually sends: files named by a person, each with a content hash.
  const realManifest = {
    schema: 1,
    version: "7-a1b2c3d4",
    tracks: [
      { id: "bill-g-force", file: "Bill G Force.m4a", title: "Bill G Force", hash: "0f1e2d3c4b5a" },
      {
        id: "cut-and-dried",
        file: "cut and dried.m4a",
        title: "cut and dried",
        hash: "aabbccddeeff",
      },
    ],
  };

  it("encodes spaces in filenames instead of emitting a broken URL", async () => {
    const { fetcher } = fakeFetch(realManifest);
    const tracks = await new MusicLibrary("/music", fetcher).loadManifest();
    expect(tracks[0].url).toBe("/music/Bill%20G%20Force.m4a?v=0f1e2d3c4b5a");
    expect(tracks[1].url).toBe("/music/cut%20and%20dried.m4a?v=aabbccddeeff");
  });

  it("puts the content hash in the URL, so a re-recorded track is a different URL", async () => {
    const { fetcher } = fakeFetch(realManifest);
    const first = (await new MusicLibrary("/music", fetcher).loadManifest())[0];
    const changed = {
      ...realManifest,
      tracks: [{ ...realManifest.tracks[0], hash: "999999999999" }],
    };
    const second = (await new MusicLibrary("/music", fakeFetch(changed).fetcher).loadManifest())[0];
    expect(second.url).not.toBe(first.url);
    expect(second.file).toBe(first.file); // same file on disk, same name
  });

  it("still works for a track with no hash at all", async () => {
    const { fetcher } = fakeFetch({
      schema: 1,
      tracks: [{ id: "plain", file: "plain.m4a", title: "Plain" }],
    });
    const track = (await new MusicLibrary("/music", fetcher).loadManifest())[0];
    expect(track.url).toBe("/music/plain.m4a");
    expect(track.hash).toBeUndefined();
  });
});

describe("trackContentHash", () => {
  const base = { id: "x", file: "tracks/main.a91f3c.m4a", title: "X", seconds: 0, bytes: 0 };

  it("prefers what the server computed", () => {
    expect(trackContentHash({ ...base, hash: "deadbeef1234" })).toBe("deadbeef1234");
  });

  it("falls back to a hash in the filename", () => {
    expect(trackContentHash(base)).toBe("a91f3c");
  });

  it("falls back to the filename itself when there is nothing else", () => {
    expect(trackContentHash({ ...base, file: "Bill G Force.m4a" })).toBe("Bill G Force.m4a");
  });
});
