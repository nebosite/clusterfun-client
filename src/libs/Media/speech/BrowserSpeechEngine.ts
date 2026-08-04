import Logger from "js-logger";
import { ISpeechEngine, SpeechEngineId, SpeechVoiceOptions } from "./ISpeechEngine";

// ==========================================================================================
// The browser's own speechSynthesis.
//
// Free, instant, downloads nothing, and on a normal desktop it is genuinely intelligible -
// which is the whole requirement.  The catch is that the voices are the operating system's,
// so the same room sounds different on a Mac, a Windows box and a Pi, and a Linux machine
// with no speech-dispatcher installed has none at all.  That is what `initialize` is for.
//
// Two gotchas, both worked around below:
//
//   * getVoices() is EMPTY until the browser has loaded them, and in Chrome that happens
//     asynchronously after a `voiceschanged` event.  Asking once at startup gets nothing.
//   * An utterance that never fires `end` (it happens - a tab backgrounded mid-word, or
//     Chrome's long-utterance bug) would hang the queue behind it, so there is a timeout.
// ==========================================================================================

/** Longest we wait for an utterance to report that it ended. */
const UTTERANCE_TIMEOUT_MS = 12000;

/** How long to wait for the voice list to populate before giving up on picking nice ones. */
const VOICE_LOAD_TIMEOUT_MS = 2000;

/**
 * Pick two voices that sound different from each other, out of whatever this machine has.
 * Prefers the local, English ones - a remote voice needs the network per utterance.
 */
export function pickContrastingVoices(
  voices: SpeechSynthesisVoice[],
): [SpeechSynthesisVoice | undefined, SpeechSynthesisVoice | undefined] {
  if (!voices.length) return [undefined, undefined];
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = english.length ? english : voices;
  const local = pool.filter((v) => v.localService);
  const usable = local.length ? local : pool;
  // Ends of the list rather than 0 and 1: consecutive voices are often the same speaker at
  // different qualities, which would make the two teams indistinguishable.
  return [usable[0], usable[usable.length > 1 ? usable.length - 1 : 0]];
}

export class BrowserSpeechEngine implements ISpeechEngine {
  readonly id: SpeechEngineId = "browser";
  private first?: SpeechSynthesisVoice;
  private second?: SpeechSynthesisVoice;

  private get synth(): SpeechSynthesis | undefined {
    return typeof window !== "undefined" ? window.speechSynthesis : undefined;
  }

  async initialize(): Promise<void> {
    const synth = this.synth;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      throw new Error("This browser has no speechSynthesis");
    }

    const voices = await this.loadVoices(synth);
    if (!voices.length) {
      // A browser with the API but no installed voices says nothing at all, silently. Better
      // to fail here and let the caller fall back to noises.
      throw new Error("speechSynthesis has no voices installed");
    }
    [this.first, this.second] = pickContrastingVoices(voices);
    Logger.info(
      `Browser speech ready: "${this.first?.name}" / "${this.second?.name}" of ${voices.length} voices`,
    );
  }

  private loadVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
    const now = synth.getVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        synth.removeEventListener?.("voiceschanged", finish);
        resolve(synth.getVoices());
      };
      const timer = setTimeout(finish, VOICE_LOAD_TIMEOUT_MS);
      synth.addEventListener?.("voiceschanged", finish);
    });
  }

  speak(text: string, options: SpeechVoiceOptions = {}): Promise<void> {
    const synth = this.synth;
    if (!synth) return Promise.resolve();

    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // Nothing may wedge the queue: if `end` never arrives, move on anyway.
      const timer = setTimeout(() => {
        Logger.warn(`Browser speech did not finish "${text}" - moving on`);
        try {
          synth.cancel();
        } catch {
          /* cancelling a stuck utterance is best-effort */
        }
        done();
      }, UTTERANCE_TIMEOUT_MS);

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = options.voice === "second" ? this.second : this.first;
        if (voice) utterance.voice = voice;
        utterance.rate = options.speed ?? 1;
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
      } catch (err) {
        Logger.warn(`Browser speech threw on "${text}": ${err}`);
        done();
      }
    });
  }

  dispose(): void {
    try {
      this.synth?.cancel();
    } catch {
      /* nothing useful to do if the browser will not stop */
    }
  }
}
