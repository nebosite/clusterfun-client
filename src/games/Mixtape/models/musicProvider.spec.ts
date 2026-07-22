import { MockMusicProvider, MOCK_CATALOG, isRealVideoId } from "./musicProvider";
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
