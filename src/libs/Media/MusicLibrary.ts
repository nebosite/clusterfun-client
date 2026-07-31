import Logger from "js-logger";

// ==========================================================================================
// MusicLibrary - reads music.json from the music folder and turns it into playable tracks.
//
// Music is served by the same server as the app, from a folder the deploy does not touch
// (see docs/music.md), so it is same-origin and there is no CORS to get wrong.  What can
// still go wrong is the folder simply not being there yet.
//
// Music is a nicety, so nothing in here is allowed to throw into a game.  A missing folder,
// a 404 or a manifest somebody hand-edited into invalid JSON all end the same way: one
// warning and an empty track list.  A silent game is a fine outcome; a game that fails to
// start because somebody has not uploaded any music is not.
//
// The manifest is fetched exactly once.  That is what makes a track replaceable while games
// are running - see docs/music.md.
// ==========================================================================================

/** The schema version this loader understands.  A manifest claiming anything else is ignored. */
export const MUSIC_SCHEMA_VERSION = 1;

export interface MusicTrack {
  id: string;
  file: string;
  title: string;
  seconds: number;
  bytes: number;
  /** Content hash of the audio, when the server knows it.  See trackContentHash. */
  hash?: string;
}

export interface ResolvedTrack extends MusicTrack {
  /** Absolute URL, base URL applied. */
  url: string;
}

export class MusicLibrary {
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly fetcher: typeof fetch;

  /** The manifest's version string, once loaded - logged so "which music is this?" is answerable. */
  version: string | undefined;

  // The base URL is normally the same-origin path the server hosts music under ("/music"),
  // but an absolute URL works just as well.  The fetch implementation is injectable so the
  // tests need no network.
  constructor(baseUrl: string | undefined, fetcher?: typeof fetch) {
    const trimmed = (baseUrl ?? "").trim();
    // Configured-but-trims-to-nothing ("/") means music at the origin root, which is still
    // music.  Only a genuinely absent setting turns it off.
    this.enabled = trimmed.length > 0;
    this.baseUrl = trimmed.replace(/\/+$/, "");
    this.fetcher = fetcher ?? ((...args) => fetch(...args));
  }

  /** False when no music base URL is configured, which means "music is off", not "broken". */
  get isEnabled(): boolean {
    return this.enabled;
  }

  async loadManifest(): Promise<ResolvedTrack[]> {
    if (!this.isEnabled) return [];

    const manifestUrl = `${this.baseUrl}/music.json`;
    try {
      const response = await this.fetcher(manifestUrl);
      if (!response.ok) {
        Logger.warn(`MusicLibrary: could not load manifest (HTTP ${response.status}) - no music`);
        return [];
      }
      const body = await response.json();
      const tracks = this.readManifest(body);
      if (tracks.length === 0) {
        Logger.warn("MusicLibrary: manifest contained no usable tracks - no music");
        return [];
      }
      Logger.info(
        `MusicLibrary: ${tracks.length} track(s), manifest version ${this.version ?? "(unversioned)"}`,
      );
      return tracks;
    } catch (err) {
      // Network failure and malformed JSON both land here.
      Logger.warn(`MusicLibrary: could not load manifest from ${manifestUrl} - no music`, err);
      return [];
    }
  }

  // Validates the manifest shape and resolves every file to an absolute URL.  Anything
  // that does not look like a track is dropped rather than passed on to break later.
  private readManifest(body: any): ResolvedTrack[] {
    if (!body || typeof body !== "object") return [];
    if (body.schema !== MUSIC_SCHEMA_VERSION) {
      Logger.warn(`MusicLibrary: unknown manifest schema ${body.schema} - no music`);
      return [];
    }
    this.version = typeof body.version === "string" ? body.version : undefined;
    if (!Array.isArray(body.tracks)) return [];

    return body.tracks
      .filter((t: any) => t && typeof t.id === "string" && typeof t.file === "string")
      .map((t: any) => {
        const hash = typeof t.hash === "string" && t.hash.length > 0 ? t.hash : undefined;
        return {
          id: t.id,
          file: t.file,
          title: typeof t.title === "string" ? t.title : t.id,
          seconds: typeof t.seconds === "number" ? t.seconds : 0,
          bytes: typeof t.bytes === "number" ? t.bytes : 0,
          hash,
          url: this.resolveUrl(String(t.file), hash),
        };
      });
  }

  // Real track files are named by a person, so they contain spaces and the odd apostrophe -
  // each path segment has to be encoded or the URL is wrong the moment somebody names a
  // song sensibly.  The content hash rides along as ?v=, which is what makes a file that
  // keeps its name still cache-bustable when its contents change.
  private resolveUrl(file: string, hash: string | undefined): string {
    const encoded = file
      .replace(/^\/+/, "")
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.baseUrl}/${encoded}${hash ? `?v=${encodeURIComponent(hash)}` : ""}`;
  }
}

/**
 * The identity of a track's *bytes*: the server's content hash when there is one, otherwise
 * a hash lifted out of the filename.  This, not the URL, is what the byte cache keys on.
 */
export function trackContentHash(track: MusicTrack): string {
  return track.hash ?? hashFromFilename(track.file);
}

/**
 * The 6-hex content fragment out of a track filename ("tracks/main.a91f3c.m4a" -> "a91f3c").
 * Track files are immutable and named by content, so this is a stable identity for the
 * bytes - which is what CachedMusicSource keys on.  Falls back to the whole filename for a
 * track that was uploaded without a hash, which still works, just less precisely.
 */
export function hashFromFilename(file: string): string {
  const name = file.split("/").pop() ?? file;
  const match = name.match(/\.([0-9a-f]{6,})\.[^.]+$/i);
  return match ? match[1].toLowerCase() : name;
}
