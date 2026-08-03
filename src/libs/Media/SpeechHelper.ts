import Logger from "js-logger";

// ==========================================================================================
// Speech for the shared screen.
//
// This replaces SAM, a 1982 formant synthesiser, which was characterful but frequently
// unintelligible - the point of reading a word out is that the room hears which word it was.
// Kokoro-82M is a small modern TTS model that runs entirely in the browser.
//
// Three rules, because a party game must not wait for a neural network:
//
//   1. LAZY.  Neither kokoro-js nor the model is touched until something actually asks to
//      speak.  The import is dynamic, so it is its own chunk and no phone downloads any of
//      it - only the presenter ever speaks.
//   2. NEVER BLOCKING.  speak() returns immediately.  While the model is still coming down
//      the wire - which is tens of megabytes on first use - the caller's fallback sound plays
//      instead, so the game keeps its rhythm from the very first word.
//   3. NEVER FATAL.  No network, an old browser, a model that will not load: every one of
//      those degrades to the fallback sound and logs.  Nothing here throws into game code.
//
// The model is cached by transformers.js in the browser's Cache Storage, so the download
// happens once per browser and every game after that starts speaking immediately.
// ==========================================================================================

/** Called when we cannot speak, so the game can make some other noise instead. */
export type SpeechFallback = (text: string) => void;

export interface SpeechVoiceOptions {
  /** A Kokoro voice id, e.g. "af_heart". Different per team makes the room follow along. */
  voice?: string;
  /** 0.5 - 2.0. Below 1 is slower. */
  speed?: number;
}

export interface ISpeechHelper {
  speak(text: string, options?: SpeechVoiceOptions): void;
  /** True once the model is loaded and speech is actually coming out. */
  readonly isReady: boolean;
}

// Small and quantised on purpose: the difference between q8 and full precision is not
// audible over a television in a room full of people, and it is a third of the download.
export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const KOKORO_DTYPE = "q8";

/** Two clearly different voices, so a team is recognisable before you parse the word. */
export const DEFAULT_VOICE_A = "af_heart";
export const DEFAULT_VOICE_B = "am_michael";

/** Injectable so tests never touch the network. */
export type KokoroLoader = () => Promise<KokoroLike>;

export interface KokoroLike {
  generate(
    text: string,
    options?: { voice?: string; speed?: number },
  ): Promise<RawAudioLike> | RawAudioLike;
}

export interface RawAudioLike {
  toBlob?: () => Blob;
  audio?: Float32Array;
  sampling_rate?: number;
}

/**
 * Where the library itself comes from.
 *
 * Deliberately NOT a bundled dependency.  kokoro-js pulls in transformers.js, which pulls in
 * the ONNX runtime, and that ships a 20.6MB WebAssembly binary: bundling it took the deploy
 * from 6MB to 29MB, all of it on the Pi's SD card and its home uplink, for a feature most
 * rounds never reach.  Fetching it from a CDN at the moment of first use keeps the app the
 * size it was and puts the cost on the one browser that actually speaks - which is the same
 * bargain we already made for the model weights.
 *
 * Override with REACT_APP_KOKORO_URL to pin a version or serve it yourself.
 */
export const KOKORO_CDN_URL =
  process.env.REACT_APP_KOKORO_URL ?? "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

async function defaultLoader(): Promise<KokoroLike> {
  // The specifier is a variable and carries webpackIgnore, so webpack leaves
  // this alone instead of trying to bundle the module graph behind it.
  const url = KOKORO_CDN_URL;
  const module: any = await import(/* webpackIgnore: true */ url);
  const KokoroTTS = module.KokoroTTS ?? module.default?.KokoroTTS;
  if (!KokoroTTS) throw new Error("kokoro-js did not export KokoroTTS");
  return (await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
    dtype: KOKORO_DTYPE,
  })) as KokoroLike;
}

export class SpeechHelper implements ISpeechHelper {
  private readonly fallback: SpeechFallback;
  private readonly loader: KokoroLoader;
  private readonly play: (url: string) => void;

  private tts?: KokoroLike;
  private loading?: Promise<void>;
  private failed = false;

  get isReady() {
    return !!this.tts;
  }

  constructor(
    fallback: SpeechFallback,
    loader: KokoroLoader = defaultLoader,
    play: (url: string) => void = playUrl,
  ) {
    this.fallback = fallback;
    this.loader = loader;
    this.play = play;
  }

  // -------------------------------------------------------------------
  // warmUp - start fetching the model before anybody needs it.
  //
  // Worth calling when a game reaches its gathering screen: the download has
  // a couple of minutes of people joining to finish in, and then the first
  // word of the round is spoken rather than beeped.
  // -------------------------------------------------------------------
  warmUp() {
    void this.ensureLoaded();
  }

  private ensureLoaded(): Promise<void> {
    if (this.tts || this.failed) return Promise.resolve();
    if (!this.loading) {
      this.loading = (async () => {
        try {
          Logger.info("Loading the speech model...");
          this.tts = await this.loader();
          Logger.info("Speech model ready");
        } catch (err) {
          // Offline, an unsupported browser, a blocked CDN - all the same to
          // us, and none of them are worth interrupting a game over.
          this.failed = true;
          Logger.warn(`Speech is unavailable, falling back to sound effects: ${err}`);
        } finally {
          this.loading = undefined;
        }
      })();
    }
    return this.loading;
  }

  // -------------------------------------------------------------------
  // speak - say it if we can, make a noise if we cannot.
  //
  // Returns immediately either way.  The first call also kicks off the model
  // download, and plays the fallback while it runs.
  // -------------------------------------------------------------------
  speak(text: string, options: SpeechVoiceOptions = {}) {
    const words = text?.trim();
    if (!words) return;

    if (!this.tts) {
      // Not ready: make the noise now, and get the model going for next time.
      this.safeFallback(words);
      void this.ensureLoaded();
      return;
    }

    void (async () => {
      try {
        const result = await this.tts!.generate(words, {
          voice: options.voice ?? DEFAULT_VOICE_A,
          speed: options.speed ?? 1,
        });
        const url = audioUrlFor(result);
        if (!url) {
          this.safeFallback(words);
          return;
        }
        this.play(url);
      } catch (err) {
        Logger.warn(`Could not speak "${words}": ${err}`);
        this.safeFallback(words);
      }
    })();
  }

  private safeFallback(text: string) {
    try {
      this.fallback(text);
    } catch (err) {
      Logger.warn(`Speech fallback failed: ${err}`);
    }
  }
}

// -------------------------------------------------------------------
// Turning what the model returns into something an <audio> can play.
//
// transformers.js hands back a RawAudio.  Newer versions can produce a Blob
// directly; older ones only expose the samples, so build the WAV by hand
// rather than pinning a version.
// -------------------------------------------------------------------
export function audioUrlFor(result: RawAudioLike): string | undefined {
  try {
    if (typeof result.toBlob === "function") {
      return URL.createObjectURL(result.toBlob());
    }
    if (result.audio && result.sampling_rate) {
      return URL.createObjectURL(encodeWav(result.audio, result.sampling_rate));
    }
  } catch (err) {
    Logger.warn(`Could not turn speech into audio: ${err}`);
  }
  return undefined;
}

/** Mono 16-bit PCM WAV from float samples. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWavBuffer(samples, sampleRate)], { type: "audio/wav" });
}

/**
 * The bytes of that WAV.  Split out from encodeWav so the header can be checked directly -
 * jsdom's Blob has no arrayBuffer(), so a test cannot read one back.
 */
export function encodeWavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling, or a sample slightly over 1.0 wraps to full-scale
    // negative and the word ends in a crack.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function playUrl(url: string) {
  const audio = new Audio(url);
  // The object URL is only needed until the clip has been decoded and played.
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
  void audio.play().catch((err) => Logger.warn(`Could not play speech: ${err}`));
}
