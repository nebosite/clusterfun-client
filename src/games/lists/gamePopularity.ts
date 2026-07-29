import { GameDescriptor } from "./GameDescriptor";

// ==========================================================================================
// Ordering the lobby by what people actually play.
//
// The numbers come from the relay's own counting (GET /api/game_popularity), not from
// Google Analytics - the lobby has to be able to sort itself without a third party in the
// loop, and without anyone holding a GA login.
//
// The server hands back a recency-weighted `score` (a play is worth half as much after a
// month), so a game that was big last year does not permanently outrank the one everyone is
// playing now.
// ==========================================================================================

export interface GamePopularity {
  plays: number;
  players: number;
  recentPlays: number;
  lastPlayed: number;
  score: number;
}

export type PopularityReport = Record<string, GamePopularity>;

export const POPULARITY_ROUTE = "/api/game_popularity";

// -------------------------------------------------------------------
// sortGamesByPopularity - most-played first.
//
// Ties, and games nobody has played yet, keep the order the registry gave
// them.  That matters: a brand new game would otherwise sink to the bottom
// and never get played, which is a self-fulfilling ranking.  The registry
// order is the editorial default, and popularity only reorders what it
// actually knows about.
// -------------------------------------------------------------------
export function sortGamesByPopularity<T extends { name: string }>(
  games: T[],
  popularity: PopularityReport | undefined | null,
): T[] {
  if (!popularity) return games.slice();
  const scoreOf = (game: T) => popularity[game.name]?.score ?? 0;
  return games
    .map((game, index) => ({ game, index, score: scoreOf(game) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.game);
}

// -------------------------------------------------------------------
// fetchPopularity - never let this break the lobby.  An older server has no
// such route, and a Pi that is having a bad day may answer with anything at
// all; either way the lobby just falls back to registry order.
// -------------------------------------------------------------------
export async function fetchPopularity(
  fetcher: typeof fetch = fetch,
): Promise<PopularityReport | null> {
  try {
    const response = await fetcher(POPULARITY_ROUTE, { method: "GET" });
    if (!response.ok) return null;
    const parsed = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PopularityReport;
  } catch {
    return null;
  }
}

// Convenience for the lobby, which holds full descriptors
export function sortDescriptorsByPopularity(
  games: GameDescriptor[],
  popularity: PopularityReport | undefined | null,
): GameDescriptor[] {
  return sortGamesByPopularity(games, popularity);
}
