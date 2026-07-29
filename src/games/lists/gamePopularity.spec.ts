import {
  sortGamesByPopularity,
  fetchPopularity,
  PopularityReport,
  POPULARITY_ROUTE,
} from "./gamePopularity";

// The lobby's ordering is the one piece of analytics players actually SEE, so
// the rules it follows - and the ways it is allowed to fail - matter.

const games = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];

function report(scores: Record<string, number>): PopularityReport {
  const out: PopularityReport = {};
  for (const [name, score] of Object.entries(scores)) {
    out[name] = { plays: 0, players: 0, recentPlays: 0, lastPlayed: 0, score };
  }
  return out;
}

describe("sortGamesByPopularity", () => {
  it("puts the most played game first", () => {
    const sorted = sortGamesByPopularity(games, report({ Alpha: 1, Beta: 9, Gamma: 4 }));
    expect(sorted.map((g) => g.name)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("leaves a game nobody has played yet in its registry position", () => {
    // A new game must not sink to the bottom forever - that would be a ranking
    // that guarantees its own result.
    const sorted = sortGamesByPopularity(games, report({ Gamma: 5 }));
    expect(sorted.map((g) => g.name)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("breaks ties by registry order, so the list never shuffles at random", () => {
    const sorted = sortGamesByPopularity(games, report({ Alpha: 3, Beta: 3, Gamma: 3 }));
    expect(sorted.map((g) => g.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("keeps registry order when there is no popularity data at all", () => {
    expect(sortGamesByPopularity(games, null).map((g) => g.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(sortGamesByPopularity(games, undefined).map((g) => g.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("does not modify the list it was handed", () => {
    const original = [...games];
    sortGamesByPopularity(games, report({ Gamma: 10 }));
    expect(games).toEqual(original);
  });

  it("ignores scores for games that are not in the list", () => {
    const sorted = sortGamesByPopularity(games, report({ Retired: 99, Beta: 1 }));
    expect(sorted.map((g) => g.name)).toEqual(["Beta", "Alpha", "Gamma"]);
  });
});

describe("fetchPopularity", () => {
  const ok = (body: string) =>
    (async () => ({ ok: true, text: async () => body })) as unknown as typeof fetch;

  it("reads the report from the relay", async () => {
    let requested = "";
    const fetcher = (async (url: string) => {
      requested = url;
      return { ok: true, text: async () => JSON.stringify(report({ Beta: 2 })) };
    }) as unknown as typeof fetch;

    const result = await fetchPopularity(fetcher);
    expect(requested).toBe(POPULARITY_ROUTE);
    expect(result!["Beta"].score).toBe(2);
  });

  // Everything below is the same promise: the lobby still renders.
  it("returns null when the route is missing (an older server)", async () => {
    const fetcher = (async () => ({ ok: false, text: async () => "" })) as unknown as typeof fetch;
    expect(await fetchPopularity(fetcher)).toBeNull();
  });

  it("returns null when the network throws", async () => {
    const fetcher = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchPopularity(fetcher)).toBeNull();
  });

  it("returns null on a body that is not a report", async () => {
    expect(await fetchPopularity(ok("not json at all"))).toBeNull();
    expect(await fetchPopularity(ok("[1,2,3]"))).toBeNull();
    expect(await fetchPopularity(ok("null"))).toBeNull();
  });
});
