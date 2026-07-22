// ==========================================================================================
// Music search provider abstraction.
//
// The phone searches for songs directly against a provider — this never crosses the relay.
// Two implementations behind one interface so the game is verifiable headlessly and never
// hard-depends on the network:
//   - YouTubeProvider: YouTube Data API v3 search.list (key from REACT_APP_YT_API_KEY /
//     src/secrets.ts).  Used in production.
//   - MockMusicProvider: a small in-memory catalog filtered by substring.  Used in the dev
//     Test Lobby or whenever no API key is present, so the whole loop runs offline.
//
// A `Track` is identical from either provider.  Only real YouTube video ids ever produce
// audio; mock ids ("mock-..") render a silent placeholder tile on the same 30s timeline
// (see the presenter view).
// ==========================================================================================

import { MAX_SEARCH_RESULTS, MAX_QUERY_LEN } from "./GameSettings";

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSec: number; // 0 = unknown (YouTube search does not return durations)
}

export interface MusicProvider {
  readonly kind: "youtube" | "mock";
  search(query: string): Promise<Track[]>;
}

// A real YouTube video id is 11 URL-safe chars; mock ids are prefixed so the view can tell
// them apart without a network round-trip.
export function isRealVideoId(videoId: string): boolean {
  return !!videoId && !videoId.startsWith("mock-");
}

// ------------------------------------------------------------------------------------------
// Mock catalog — deliberately varied fake tracks so search returns something for common
// party queries.  durationSec is set so start-offset clamping has something to work with.
// ------------------------------------------------------------------------------------------
export const MOCK_CATALOG: Track[] = [
  ["Midnight Highway", "The Neon Coyotes", 214],
  ["Sunrise Kids", "Paper Planes", 198],
  ["Slow Dance in the Kitchen", "Marlowe Fields", 243],
  ["Rocket to Nowhere", "Static Bloom", 176],
  ["Golden Hour", "Wren & the Tides", 231],
  ["Basement Anthem", "Loud Tuesday", 189],
  ["Rainy Window Blues", "Sable & Co", 267],
  ["Victory Lap", "Big Sky Republic", 205],
  ["Campfire Hymn", "The Wanderlights", 258],
  ["City Walker", "Metro Ghost", 222],
  ["Heartbreak Recovery", "Odessa Lane", 249],
  ["Windows Down", "Sunbelt Drive", 193],
  ["Main Character", "Violet Static", 211],
  ["Karaoke Disaster", "The Off-Keys", 184],
  ["National Anthem of Summer", "Palm Reader", 236],
  ["Villain's Theme", "Obsidian Choir", 271],
  ["Warm Hug", "Cozy Machine", 202],
  ["Countdown", "New Year Ghosts", 215],
  ["Annoy the Neighbors", "Subwoofer Saints", 178],
  ["Study Hall Focus", "Lo-Fi Otter", 288],
  ["Grandma's Record Player", "The Sepia Tones", 224],
  ["Beach Bonfire", "Saltwater Radio", 239],
  ["Cook Dinner Groove", "Kitchen Table", 207],
  ["Pump It Up", "Adrenaline Ave", 181],
  ["Sunday Morning Slow", "Featherweight", 254],
  ["First Date Montage", "Butterflies Inc", 196],
  ["Cry in the Shower", "Porcelain Sky", 262],
  ["Closing Credits", "The Long Goodbye", 245],
  ["Party Starter", "Confetti Cannon", 187],
  ["Underrated Gem", "Hidden Track", 219],
].map(([title, artist, durationSec], i) => ({
  videoId: `mock-${String(i + 1).padStart(2, "0")}`,
  title: title as string,
  artist: artist as string,
  thumbnailUrl: "", // the view renders a gradient/music-note tile for empty thumbnails
  durationSec: durationSec as number,
}));

export class MockMusicProvider implements MusicProvider {
  readonly kind = "mock" as const;

  async search(query: string): Promise<Track[]> {
    const q = (query ?? "").trim().toLowerCase().slice(0, MAX_QUERY_LEN);
    if (!q) return MOCK_CATALOG.slice(0, MAX_SEARCH_RESULTS);
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = MOCK_CATALOG.map((t) => {
      const hay = `${t.title} ${t.artist}`.toLowerCase();
      const hits = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      return { t, hits };
    });
    const matches = scored.filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
    // Always return something so the phone flow never dead-ends on an odd query.
    const base = matches.length > 0 ? matches.map((s) => s.t) : MOCK_CATALOG;
    return base.slice(0, MAX_SEARCH_RESULTS);
  }
}

// ------------------------------------------------------------------------------------------
// YouTube Data API v3 provider (production).
// ------------------------------------------------------------------------------------------
export class YouTubeProvider implements MusicProvider {
  readonly kind = "youtube" as const;
  constructor(private apiKey: string) {}

  async search(query: string): Promise<Track[]> {
    const q = (query ?? "").trim().slice(0, MAX_QUERY_LEN);
    if (!q) return [];
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      videoCategoryId: "10", // Music
      maxResults: String(MAX_SEARCH_RESULTS),
      q,
      key: this.apiKey,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`YouTube search failed (${res.status})`);
    }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((it: any) => it?.id?.videoId)
      .map((it: any) => {
        const sn = it.snippet ?? {};
        const thumb = sn.thumbnails?.medium ?? sn.thumbnails?.default ?? {};
        return {
          videoId: it.id.videoId as string,
          title: decodeEntities(sn.title ?? "Unknown title"),
          artist: decodeEntities(sn.channelTitle ?? "Unknown"),
          thumbnailUrl: thumb.url ?? "",
          durationSec: 0, // search.list does not include durations
        } as Track;
      });
  }
}

// YouTube snippet strings arrive HTML-entity encoded (&amp; &#39; ...).
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ------------------------------------------------------------------------------------------
// Provider selection.  Mock in dev / when no key is configured; real YouTube otherwise.
// The key is read from the CRA env (REACT_APP_YT_API_KEY); secrets.ts can re-export it there.
// ------------------------------------------------------------------------------------------
export function getYouTubeApiKey(): string {
  try {
    return (process.env.REACT_APP_YT_API_KEY ?? "").trim();
  } catch {
    return "";
  }
}

export function getMusicProvider(): MusicProvider {
  const isDev = (() => {
    try {
      return process.env.REACT_APP_DEVMODE === "development";
    } catch {
      return false;
    }
  })();
  const key = getYouTubeApiKey();
  if (isDev || !key) return new MockMusicProvider();
  return new YouTubeProvider(key);
}
