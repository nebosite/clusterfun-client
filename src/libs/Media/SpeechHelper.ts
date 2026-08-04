import Logger from "js-logger";
import { ISpeechEngine, SpeechEngineId, SpeechVoiceOptions } from "./speech/ISpeechEngine";
import { DEFAULT_SPEECH_ENGINE, createSpeechEngine } from "./speech/SpeechEngines";

// ==========================================================================================
// Speech for the shared screen.
//
// This class holds the POLICY - what happens when speech is slow, absent, or asked for twice
// at once.  It knows nothing about how a word is turned into sound; that is an ISpeechEngine,
// picked by the host at the start screen and loaded on demand (see speech/SpeechEngines.ts).
//
// Four rules, because a party game must not wait for a synthesiser:
//
//   1. LAZY.  No engine is loaded until something asks to speak, or warmUp() is called.
//      An engine nobody chose is never even imported, so it downloads and caches nothing.
//   2. NEVER BLOCKING.  speak() returns immediately.  While an engine is still getting
//      ready - which may be tens of megabytes for a neural one - the caller's fallback sound
//      plays instead, so the game keeps its rhythm from the very first word.
//   3. NEVER FATAL.  No network, an old browser, a model that will not load: every one of
//      those degrades to the fallback sound and logs.  Nothing here throws into game code.
//   4. ONE AT A TIME.  Two syntheses in flight share a runtime and come back interleaved, and
//      two clips started together simply play over each other; either way the room hears
//      gibberish rather than a word.
// ==========================================================================================

/** Called when we cannot speak, so the game can make some other noise instead. */
export type SpeechFallback = (text: string) => void;

export interface ISpeechHelper {
  speak(text: string, options?: SpeechVoiceOptions): void;
  /** True once an engine is ready and speech is actually coming out. */
  readonly isReady: boolean;
}

/**
 * How many words may be waiting to be spoken.  Deliberately tiny: in a room, the word that
 * matters is the one that just landed.  A backlog read out thirty seconds late is narration
 * of the past, and it is what a queue with no limit turns into the moment two people play at
 * the same time.
 */
export const MAX_SPEECH_QUEUE = 2;

/** A word that has waited longer than this is dropped rather than spoken late. */
export const SPEECH_STALE_MS = 8000;

/**
 * Longest we will wait for one word before moving on.  Nothing here may wedge permanently:
 * an engine that never resolves would otherwise leave the queue stuck behind it and the game
 * silent for the rest of the night.
 */
export const SPEECH_MAX_UTTERANCE_MS = 15000;

/** Injectable so tests never touch the network. */
export type SpeechEngineFactory = (id: SpeechEngineId) => Promise<ISpeechEngine>;

export class SpeechHelper implements ISpeechHelper {
  private readonly fallback: SpeechFallback;
  private readonly factory: SpeechEngineFactory;

  private engineId: SpeechEngineId;
  private engine?: ISpeechEngine;
  private loading?: Promise<void>;
  private failed = false;

  private readonly queue: { text: string; options: SpeechVoiceOptions; queuedAt: number }[] = [];
  private draining = false;

  get isReady() {
    return !!this.engine;
  }

  /** Which engine this helper is using. */
  get currentEngineId() {
    return this.engineId;
  }

  /** How many words are waiting. Exposed for tests and diagnostics. */
  get pendingCount() {
    return this.queue.length;
  }

  constructor(
    fallback: SpeechFallback,
    engineId: SpeechEngineId = DEFAULT_SPEECH_ENGINE,
    factory: SpeechEngineFactory = createSpeechEngine,
  ) {
    this.fallback = fallback;
    this.engineId = engineId;
    this.factory = factory;
  }

  // -------------------------------------------------------------------
  // setEngine - switch engines, e.g. because the host changed the setting.
  //
  // Throws nothing and drops whatever was queued: the words in flight belong
  // to the engine being retired.
  // -------------------------------------------------------------------
  setEngine(id: SpeechEngineId) {
    if (id === this.engineId) return;
    this.queue.length = 0;
    this.disposeEngine();
    this.engineId = id;
    this.failed = false;
  }

  private disposeEngine() {
    try {
      this.engine?.dispose();
    } catch (err) {
      Logger.warn(`Speech engine did not dispose cleanly: ${err}`);
    }
    this.engine = undefined;
    this.loading = undefined;
  }

  /** Let go of everything. Call when the view goes away. */
  shutdown() {
    this.queue.length = 0;
    this.disposeEngine();
  }

  // -------------------------------------------------------------------
  // warmUp - get the engine ready before anybody needs it.
  //
  // Worth calling when a game reaches its gathering screen: a download has a
  // couple of minutes of people joining to finish in, and then the first word
  // of the round is spoken rather than beeped.
  // -------------------------------------------------------------------
  warmUp() {
    void this.ensureLoaded();
  }

  private ensureLoaded(): Promise<void> {
    if (this.engine || this.failed) return Promise.resolve();
    if (!this.loading) {
      const loadingId = this.engineId;
      this.loading = (async () => {
        try {
          Logger.info(`Loading the "${loadingId}" speech engine...`);
          const engine = await this.factory(loadingId);
          await engine.initialize();
          // The host may have switched engines while this was loading; that choice wins.
          if (loadingId !== this.engineId) {
            engine.dispose();
            return;
          }
          this.engine = engine;
          Logger.info(`Speech engine "${loadingId}" ready`);
        } catch (err) {
          // Offline, an unsupported browser, a blocked CDN, no voices installed - all the
          // same to us, and none of them are worth interrupting a game over.
          if (loadingId === this.engineId) this.failed = true;
          Logger.warn(`Speech engine "${loadingId}" is unavailable, using sounds: ${err}`);
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
  // Returns immediately either way.  The first call also starts loading the
  // engine, and plays the fallback while that runs.
  // -------------------------------------------------------------------
  speak(text: string, options: SpeechVoiceOptions = {}) {
    const words = text?.trim();
    if (!words) return;

    if (!this.engine) {
      // Not ready: make the noise now, and get the engine going for next time.
      this.safeFallback(words);
      void this.ensureLoaded();
      return;
    }

    this.queue.push({ text: words, options, queuedAt: performance.now() });
    // Keep the NEWEST words: an overtaken one gets its fallback sound so the moment is still
    // marked, just not narrated.
    while (this.queue.length > MAX_SPEECH_QUEUE) {
      const dropped = this.queue.shift()!;
      Logger.info(`Speech queue full, beeping "${dropped.text}" instead`);
      this.safeFallback(dropped.text);
    }
    void this.drain();
  }

  // -------------------------------------------------------------------
  // drain - work through the backlog, strictly one word at a time.
  // -------------------------------------------------------------------
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!;
        const waited = performance.now() - next.queuedAt;
        if (waited > SPEECH_STALE_MS) {
          Logger.info(`Dropping "${next.text}" - ${Math.round(waited)}ms stale`);
          this.safeFallback(next.text);
          continue;
        }
        await this.sayOne(next.text, next.options);
      }
    } finally {
      this.draining = false;
    }
  }

  private async sayOne(words: string, options: SpeechVoiceOptions): Promise<void> {
    const engine = this.engine;
    if (!engine) {
      this.safeFallback(words);
      return;
    }
    try {
      await withTimeout(engine.speak(words, options), SPEECH_MAX_UTTERANCE_MS, words);
    } catch (err) {
      Logger.warn(`Could not speak "${words}": ${err}`);
      this.safeFallback(words);
    }
  }

  private safeFallback(text: string) {
    try {
      this.fallback(text);
    } catch (err) {
      Logger.warn(`Speech fallback failed: ${err}`);
    }
  }
}

/** Resolve either way, and never later than `ms`. */
function withTimeout(work: Promise<void>, ms: number, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      Logger.warn(`Speech did not finish "${what}" within ${ms}ms - moving on`);
      resolve();
    }, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
