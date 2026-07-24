import {
  MockMusicProvider,
  RelayMusicProvider,
  MOCK_CATALOG,
  isRealVideoId,
  getMusicProvider,
} from "./musicProvider";
import { MAX_SEARCH_RESULTS } from "./GameSettings";

describe("isRealVideoId", () => {
  it("treats mock ids as not real", () => {
    expect(isRealVideoId("mock-01")).toBe(false);
  });
  it("treats a normal id as real", () => {
    expect(isRealVideoId("dQw4w9WgXcQ")).toBe(true);
  });
  it("treats empty as not real", () => {
    expect(isRealVideoId("")).toBe(false);
  });
});

describe("MockMusicProvider", () => {
  const provider = new MockMusicProvider();

  it("returns the catalog head for an empty query", async () => {
    const res = await provider.search("");
    expect(res.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
    expect(res.length).toBeGreaterThan(0);
    expect(res[0].videoId).toBe(MOCK_CATALOG[0].videoId);
  });

  it("finds tracks by a term in the title", async () => {
    const res = await provider.search("bonfire");
    expect(res[0].title.toLowerCase()).toContain("bonfire");
  });

  it("finds tracks by artist name", async () => {
    const res = await provider.search("Metro Ghost");
    expect(res.some((t) => t.artist === "Metro Ghost")).toBe(true);
  });

  it("never dead-ends: falls back to the catalog for an unmatched query", async () => {
    const res = await provider.search("zzzzz-nothing-matches-xyz");
    expect(res.length).toBeGreaterThan(0);
  });

  it("caps results at the configured maximum", async () => {
    const res = await provider.search("");
    expect(res.length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
  });

  it("gives every mock track a clamp-able duration", () => {
    expect(MOCK_CATALOG.every((t) => t.durationSec > 30)).toBe(true);
  });
});

// The client no longer holds a YouTube key or calls googleapis directly: it asks the relay
// proxy.  These pin the request URL + parsing and the dev-vs-prod provider selection, so a
// regression can't silently reintroduce a client-side key or hit the wrong endpoint.
describe("RelayMusicProvider", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("queries the relay proxy and returns the parsed Track[]", async () => {
    const tracks = [
      { videoId: "abc12345678", title: "T", artist: "A", thumbnailUrl: "u", durationSec: 0 },
    ];
    const mockFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => tracks });
    global.fetch = mockFetch as any;

    const results = await new RelayMusicProvider().search("hello world");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/youtube_search?q=hello%20world");
    expect(results).toEqual(tracks);
  });

  it("returns [] for a blank query without calling the network", async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch as any;

    expect(await new RelayMusicProvider().search("   ")).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when the relay responds with a non-ok status", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    await expect(new RelayMusicProvider().search("x")).rejects.toThrow(/Music search failed/);
  });
});

describe("getMusicProvider", () => {
  const orig = process.env.REACT_APP_DEVMODE;
  afterEach(() => {
    process.env.REACT_APP_DEVMODE = orig;
  });

  it("uses the offline mock catalog in the dev Test Lobby", () => {
    process.env.REACT_APP_DEVMODE = "development";
    expect(getMusicProvider()).toBeInstanceOf(MockMusicProvider);
  });

  it("uses the relay proxy in production", () => {
    process.env.REACT_APP_DEVMODE = "";
    expect(getMusicProvider()).toBeInstanceOf(RelayMusicProvider);
  });
});
