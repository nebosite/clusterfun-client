import Logger from "js-logger";
import { IMusicSource } from "./IMusicSource";
import { ResolvedTrack, hashFromFilename } from "./MusicLibrary";

// ==========================================================================================
// CachedMusicSource - keep track bytes in the Cache API so a reload costs no network.
//
// An <audio src> pointing at a remote URL does not consult the Cache API - nothing does,
// without a service worker.  So caching means going through the bytes ourselves: fetch the
// track, store the Response, then hand the <audio> element a blob: URL minted from it.
//
// Every failure path falls back to the remote URL.  A broken cache degrades to streaming,
// never to silence.
// ==========================================================================================

export const MUSIC_CACHE_NAME = "clusterfun-music-v1";

/** The slice of the Cache API this needs.  Jest has no `caches`, so it is injectable. */
export interface IMusicCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  keys(): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/** The real thing, over window.caches.  Undefined where the Cache API is unavailable. */
export class BrowserMusicCache implements IMusicCache {
  private readonly cacheName: string;
  constructor(cacheName = MUSIC_CACHE_NAME) {
    this.cacheName = cacheName;
  }
  private open() {
    return caches.open(this.cacheName);
  }
  async match(key: string) {
    return (await this.open()).match(key);
  }
  async put(key: string, response: Response) {
    return (await this.open()).put(key, response);
  }
  async keys() {
    const requests = await (await this.open()).keys();
    return requests.map((r) => r.url);
  }
  async delete(key: string) {
    await (await this.open()).delete(key);
  }
}

export interface CachedMusicSourceOptions {
  cache?: IMusicCache;
  fetcher?: typeof fetch;
  /** Injectable for tests - jsdom has no URL.createObjectURL. */
  objectUrls?: { create(blob: Blob): string; revoke(url: string): void };
  /** Injectable for tests - navigator.storage.persist(). */
  requestPersistence?: () => Promise<boolean>;
}

/**
 * The cache key deliberately is NOT the resolved URL.  The resolved URL contains the music
 * base path, so keying on it would orphan every cached byte the day that changes - moving
 * music to a different route, or serving it from somewhere else entirely.  Track id plus
 * content hash depends on neither, and this cannot be retrofitted once real users have a
 * populated cache.
 */
export function musicCacheKey(track: ResolvedTrack): string {
  return `https://music.clusterfun.invalid/${track.id}/${hashFromFilename(track.file)}`;
}

export class CachedMusicSource implements IMusicSource {
  private readonly cache: IMusicCache | undefined;
  private readonly fetcher: typeof fetch;
  private readonly objectUrls: { create(blob: Blob): string; revoke(url: string): void };
  private readonly requestPersistence: (() => Promise<boolean>) | undefined;
  private readonly minted = new Map<string, string>();
  private askedForPersistence = false;

  constructor(opts?: CachedMusicSourceOptions) {
    this.cache =
      opts?.cache ?? (typeof caches !== "undefined" ? new BrowserMusicCache() : undefined);
    this.fetcher = opts?.fetcher ?? ((...args) => fetch(...args));
    this.objectUrls = opts?.objectUrls ?? {
      create: (blob) => URL.createObjectURL(blob),
      revoke: (url) => URL.revokeObjectURL(url),
    };
    this.requestPersistence =
      opts?.requestPersistence ??
      (typeof navigator !== "undefined" && navigator.storage?.persist
        ? () => navigator.storage.persist()
        : undefined);
  }

  async getPlayableUrl(track: ResolvedTrack): Promise<string> {
    const existing = this.minted.get(track.id);
    if (existing) return existing;
    if (!this.cache) return track.url; // no Cache API here - just stream it

    const key = musicCacheKey(track);
    try {
      let response = await this.cache.match(key);
      if (!response) {
        const fetched = await this.fetcher(track.url);
        // Storing a 404 page or a truncated body would poison the cache permanently, and
        // the entry would look perfectly valid forever after.
        if (!fetched.ok || fetched.status !== 200) {
          Logger.warn(`CachedMusicSource: HTTP ${fetched.status} for ${track.url} - not caching`);
          return track.url;
        }
        await this.cache.put(key, fetched.clone());
        this.notePersistence();
        response = fetched;
      }
      const url = this.objectUrls.create(await response.blob());
      this.minted.set(track.id, url);
      return url;
    } catch (err) {
      Logger.warn(`CachedMusicSource: cache unusable for "${track.title}" - streaming it`, err);
      return track.url;
    }
  }

  release(track: ResolvedTrack): void {
    const url = this.minted.get(track.id);
    if (!url) return;
    // Not revoking is a leak that survives every game for the life of the tab.
    this.objectUrls.revoke(url);
    this.minted.delete(track.id);
  }

  /**
   * Drop cached tracks that are no longer in the manifest.  Without this, every replaced
   * track's bytes stay forever - see the replacement procedure in docs/music.md.
   */
  async sweep(tracks: ResolvedTrack[]): Promise<number> {
    if (!this.cache) return 0;
    const valid = new Set(tracks.map(musicCacheKey));
    try {
      const stale = (await this.cache.keys()).filter((key) => !valid.has(key));
      for (const key of stale) await this.cache.delete(key);
      if (stale.length > 0) Logger.info(`CachedMusicSource: swept ${stale.length} stale track(s)`);
      return stale.length;
    } catch (err) {
      Logger.warn("CachedMusicSource: could not sweep the cache", err);
      return 0;
    }
  }

  // Cache API storage is evictable under pressure unless the origin is persistent, and
  // asking is the only thing that changes that.  Once, on the first successful write - no
  // prompting, no gating, no retry.
  private notePersistence() {
    if (this.askedForPersistence || !this.requestPersistence) return;
    this.askedForPersistence = true;
    this.requestPersistence()
      .then((granted) => Logger.info(`CachedMusicSource: persistent storage granted=${granted}`))
      .catch(() => {
        /* nothing to do about it */
      });
  }
}
