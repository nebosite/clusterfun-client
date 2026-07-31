import { ResolvedTrack } from "./MusicLibrary";

// ==========================================================================================
// IMusicSource - where a track's playable URL comes from.
//
// This is the seam between "which track" and "how do I get the bytes".  DirectMusicSource
// hands back the remote URL and lets the browser stream it; CachedMusicSource stores the
// bytes in the Cache API and hands back a blob: URL so a reload costs no network.  The
// player does not know or care which one it has.
// ==========================================================================================
export interface IMusicSource {
  /** Returns a URL playable by an <audio> element.  May be remote or a blob: URL. */
  getPlayableUrl(track: ResolvedTrack): Promise<string>;
  /** Release anything held for this track (object URLs, etc). */
  release(track: ResolvedTrack): void;
}
