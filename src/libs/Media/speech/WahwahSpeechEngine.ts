import Logger from "js-logger";
import { getSharedAudioContext } from "../audioContext";
import { ISpeechEngine, SpeechEngineId, SpeechVoiceOptions } from "./ISpeechEngine";

// ==========================================================================================
// "Wah-wah" - speech-shaped noise, and no speech.
//
// The adults in a Peanuts cartoon.  It does not say the word; it says that a word happened,
// with roughly the right number of syllables and roughly the right length, in one of two
// voices so you can tell the teams apart.
//
// This is the DEFAULT engine, and that is a deliberate trade rather than a placeholder.  It
// downloads nothing, caches nothing, starts instantly, cannot block the presenter's main
// thread, and works identically on every machine in the world.  The real synthesisers all
// give up at least one of those, and a party game notices.  A host who wants the word read
// out properly can pick one at the start screen.
//
// Every "wah" is a sawtooth run through a bandpass filter whose centre frequency sweeps up
// and back down - which is exactly what a mouth opening and closing does to a vowel, and why
// a wah pedal is called that.
// ==========================================================================================

/** Roughly one wah per two letters, so a long word takes longer to say. */
const LETTERS_PER_SYLLABLE = 2;
const MIN_SYLLABLES = 1;
const MAX_SYLLABLES = 7;

/** Seconds per syllable at speed 1. */
const SYLLABLE_SECONDS = 0.19;

/** The two voices, as the pitch the vowel sits on. */
const VOICE_HZ: Record<string, number> = { first: 196, second: 130 };

export function syllableCountFor(text: string): number {
  const letters = text.replace(/[^a-z0-9]/gi, "").length;
  const guess = Math.round(letters / LETTERS_PER_SYLLABLE);
  return Math.max(MIN_SYLLABLES, Math.min(MAX_SYLLABLES, guess));
}

/**
 * A stable number in 0..1 for a string.  The same word always wahs the same way, which makes
 * the noise feel like it belongs to the word rather than being random each time.
 */
export function hashFraction(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export class WahwahSpeechEngine implements ISpeechEngine {
  readonly id: SpeechEngineId = "wahwah";
  private stopped = false;

  async initialize(): Promise<void> {
    // Nothing to fetch and nothing to warm up.  The one thing that can be wrong is a browser
    // with no Web Audio at all, and the caller wants to know that now rather than per word.
    if (!getSharedAudioContext()) throw new Error("This browser has no Web Audio");
  }

  speak(text: string, options: SpeechVoiceOptions = {}): Promise<void> {
    const ctx = getSharedAudioContext();
    if (!ctx || this.stopped) return Promise.resolve();

    try {
      const speed = options.speed && options.speed > 0 ? options.speed : 1;
      const base = VOICE_HZ[options.voice ?? "first"] ?? VOICE_HZ.first;
      const syllables = syllableCountFor(text);
      const each = SYLLABLE_SECONDS / speed;
      const start = ctx.currentTime + 0.02;

      for (let i = 0; i < syllables; i++) {
        // Each syllable gets its own pitch step and vowel colour, drawn from the word so it
        // is the same every time that word comes up.
        const step = hashFraction(text, i) * 5 - 2; // roughly -2..+3 semitones
        const openness = 0.5 + hashFraction(text, i + 100) * 0.5;
        this.wah(ctx, start + i * each, each, base * Math.pow(2, step / 12), openness);
      }

      // Resolve when the last syllable has stopped sounding, so the queue does not overlap
      // the next word onto this one.
      const total = (syllables * each + 0.08) * 1000;
      return new Promise<void>((resolve) => setTimeout(resolve, total));
    } catch (err) {
      Logger.warn(`wahwah could not speak: ${err}`);
      return Promise.resolve();
    }
  }

  // -------------------------------------------------------------------
  // wah - one syllable: a buzzy tone under a sweeping bandpass.
  // -------------------------------------------------------------------
  private wah(ctx: AudioContext, at: number, duration: number, hz: number, openness: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(hz, at);
    // A slight downward glide on each syllable keeps it from sounding like a test tone.
    osc.frequency.linearRampToValueAtTime(hz * 0.94, at + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 6;
    // The sweep IS the wah: mouth opens, then closes.
    const peak = 500 + openness * 1400;
    filter.frequency.setValueAtTime(320, at);
    filter.frequency.linearRampToValueAtTime(peak, at + duration * 0.45);
    filter.frequency.linearRampToValueAtTime(300, at + duration);

    const gain = ctx.createGain();
    // Soft edges: a hard start clicks, and a room hears the click before the tone.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + duration * 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.95);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration);
  }

  dispose(): void {
    // The shared context stays - other things use it - and every node here stops on its own.
    this.stopped = true;
  }
}
