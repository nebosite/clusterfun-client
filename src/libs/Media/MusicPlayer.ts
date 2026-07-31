import Logger from "js-logger";
import { IMusicSource } from "./IMusicSource";
import { ResolvedTrack } from "./MusicLibrary";

// ==========================================================================================
// MusicPlayer - one background track at a time, through a single <audio> element.
//
// Deliberately NOT Web Audio / decodeAudioData, which is what the sound effects use.  A
// decoded 3-minute stereo track is around 30MB of PCM sitting in memory for the whole game;
// an <audio> element streams and decodes as it goes.  That difference is the entire reason
// music and SFX use different machinery.
// ==========================================================================================

/** Music sits under the sound effects.  Step 1's loudness normalization is what lets one
 *  constant work for every track. */
export const DEFAULT_MUSIC_VOLUME = 0.3;

const FADE_STEP_MS = 30;

export interface MusicPlayerOptions {
  defaultVolume?: number;
  /** Injectable for tests - jsdom has no working media element. */
  createElement?: () => HTMLAudioElement;
}

export interface MusicPlayOptions {
  loop?: boolean;
  fadeInMs?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class MusicPlayer {
  private readonly source: IMusicSource;
  private element: HTMLAudioElement | null;
  private targetVolume: number;
  private fadeTimer: ReturnType<typeof setInterval> | undefined;
  private current: ResolvedTrack | null = null;
  private disposed = false;
  private retryListener: (() => void) | undefined;

  constructor(source: IMusicSource, opts?: MusicPlayerOptions) {
    this.source = source;
    this.targetVolume = clamp01(opts?.defaultVolume ?? DEFAULT_MUSIC_VOLUME);
    this.element = (opts?.createElement ?? (() => new Audio()))();
    this.element.preload = "auto";
    this.element.volume = this.targetVolume;
  }

  get isPlaying(): boolean {
    return !!this.element && !this.element.paused;
  }

  /** The track currently loaded, if any - handy for logging and for tests. */
  get currentTrack(): ResolvedTrack | null {
    return this.current;
  }

  async play(track: ResolvedTrack, opts?: MusicPlayOptions): Promise<void> {
    if (this.disposed) return;
    this.clearFade();
    this.clearRetry();

    // Whatever was playing is done with - let the source drop its object URL.
    if (this.current && this.current.id !== track.id) this.source.release(this.current);

    let url: string;
    try {
      url = await this.source.getPlayableUrl(track);
    } catch (err) {
      Logger.warn(`MusicPlayer: could not get a URL for "${track.title}" - no music`, err);
      return;
    }
    // dispose() can land while that await is outstanding.
    if (this.disposed || !this.element) {
      this.source.release(track);
      return;
    }

    this.current = track;
    this.element.src = url;
    // Note: the loop attribute has an audible gap at the seam in most browsers.  Gapless
    // looping needs two alternating elements or a Web Audio buffer, and is out of scope.
    this.element.loop = !!opts?.loop;

    const fadeInMs = opts?.fadeInMs ?? 0;
    this.element.volume = fadeInMs > 0 ? 0 : this.targetVolume;

    try {
      await this.element.play();
      if (fadeInMs > 0) this.fadeTo(this.targetVolume, fadeInMs);
    } catch (err) {
      // Browsers refuse audio without a user gesture.  Playback is triggered from the
      // start-game click precisely to avoid this, but a stricter browser (or a click the
      // browser did not count) can still land here - so retry on the next input rather
      // than staying silent for the whole game.
      Logger.warn(`MusicPlayer: playback was blocked - retrying on the next user input`, err);
      this.armRetry(fadeInMs);
    }
  }

  stop(fadeOutMs = 0): void {
    this.clearRetry();
    const element = this.element;
    if (!element) return;
    if (fadeOutMs > 0 && !element.paused) {
      this.fadeTo(0, fadeOutMs, () => element.pause());
    } else {
      this.clearFade();
      element.pause();
    }
  }

  setVolume(v: number): void {
    this.targetVolume = clamp01(v);
    this.clearFade();
    if (this.element) this.element.volume = this.targetVolume;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearFade();
    this.clearRetry();
    const element = this.element;
    this.element = null;
    if (element) {
      element.pause();
      // Blanking src stops the browser buffering a track nobody is listening to.
      element.removeAttribute("src");
      element.load?.();
    }
    if (this.current) {
      this.source.release(this.current);
      this.current = null;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Fading is a plain volume ramp on an interval.  Not worth a dependency.
  // ---------------------------------------------------------------------------------------
  private fadeTo(to: number, ms: number, onDone?: () => void) {
    this.clearFade();
    const element = this.element;
    if (!element) return;
    const from = element.volume;
    const steps = Math.max(1, Math.ceil(ms / FADE_STEP_MS));
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step++;
      element.volume = clamp01(from + (to - from) * (step / steps));
      if (step >= steps) {
        this.clearFade();
        onDone?.();
      }
    }, FADE_STEP_MS);
  }

  private clearFade() {
    if (this.fadeTimer !== undefined) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = undefined;
    }
  }

  // One retry, on the next click or keypress, for a play() the browser refused.
  private armRetry(fadeInMs: number) {
    if (typeof document === "undefined" || this.retryListener) return;
    const retry = () => {
      this.clearRetry();
      if (this.disposed || !this.element) return;
      this.element.volume = fadeInMs > 0 ? 0 : this.targetVolume;
      this.element
        .play()
        .then(() => {
          if (fadeInMs > 0) this.fadeTo(this.targetVolume, fadeInMs);
        })
        .catch(() => Logger.warn("MusicPlayer: playback blocked again - giving up on music"));
    };
    this.retryListener = retry;
    document.addEventListener("pointerdown", retry, { once: true });
    document.addEventListener("keydown", retry, { once: true });
  }

  private clearRetry() {
    if (!this.retryListener) return;
    if (typeof document !== "undefined") {
      document.removeEventListener("pointerdown", this.retryListener);
      document.removeEventListener("keydown", this.retryListener);
    }
    this.retryListener = undefined;
  }
}
