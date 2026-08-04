import { ISpeechEngine, SpeechEngineId, SpeechEngineInfo } from "./ISpeechEngine";

// ==========================================================================================
// The engines a host may choose between, and how to get one.
//
// EVERY entry loads by dynamic import, and that is the load-bearing detail of this file.
// Webpack gives each engine its own chunk, so choosing "wahwah" means the Kokoro module is
// never fetched, never parsed, and never runs its CDN import - no library, no 80MB of
// weights, nothing added to the browser's Cache Storage.  A static `import` at the top of
// this file would undo that for every engine at once.
//
// The descriptions are what the host reads while deciding, so they name the cost, not the
// feature.
// ==========================================================================================

export const SPEECH_ENGINE_LIST: SpeechEngineInfo[] = [
  {
    id: "browser",
    label: "Browser",
    description: "This computer's built-in voice. Real words, instant, no download.",
    downloads: false,
  },
  {
    id: "wahwah",
    label: "Wah-wah",
    description: "Peanuts-teacher noises. Works anywhere, says nothing in particular.",
    downloads: false,
  },
];

/**
 * The browser's own synthesiser.  It says the actual word, costs nothing to fetch, and starts
 * immediately - which is the whole job.  Two neural engines (Kokoro and KittenTTS) lived here
 * and were removed: they sounded better and were not worth tens of megabytes of download, a
 * CDN dependency, and - on a machine without a GPU - a two-second freeze of the shared screen
 * every time somebody scored.
 */
export const DEFAULT_SPEECH_ENGINE: SpeechEngineId = "browser";

/** Registry order, for a picker. */
export function speechEngineInfo(id: SpeechEngineId): SpeechEngineInfo | undefined {
  return SPEECH_ENGINE_LIST.find((e) => e.id === id);
}

/** Is this a value we still recognise? Settings outlive the code that wrote them. */
export function isSpeechEngineId(value: unknown): value is SpeechEngineId {
  return SPEECH_ENGINE_LIST.some((e) => e.id === value);
}

/**
 * Build one.  The import happens here and nowhere else, which is what keeps an unchosen
 * engine's cost at exactly zero.
 */
export async function createSpeechEngine(id: SpeechEngineId): Promise<ISpeechEngine> {
  switch (id) {
    case "browser":
      return new (await import("./BrowserSpeechEngine")).BrowserSpeechEngine();
    case "wahwah":
      return new (await import("./WahwahSpeechEngine")).WahwahSpeechEngine();
    default:
      throw new Error(`Unknown speech engine: ${id}`);
  }
}
