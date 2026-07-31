import { IMusicSource } from "./IMusicSource";
import { ResolvedTrack } from "./MusicLibrary";

// ==========================================================================================
// DirectMusicSource - hand the remote URL straight to the <audio> element and let the
// browser stream it.  Nothing is held, so nothing needs releasing.
//
// This is the fallback behaviour the cached source degrades to when anything goes wrong,
// so it is worth keeping trivial.
// ==========================================================================================
export class DirectMusicSource implements IMusicSource {
  async getPlayableUrl(track: ResolvedTrack): Promise<string> {
    return track.url;
  }

  release(_track: ResolvedTrack): void {
    // Nothing held.
  }
}
