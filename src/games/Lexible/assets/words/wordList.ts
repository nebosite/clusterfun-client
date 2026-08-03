import wordsUrl from "./words50k.txt.gz";
import { reportError } from "libs/telemetry/ErrorReporter";

// ==========================================================================================
// The Lexible dictionary.
//
// It used to be a 2.8MB TypeScript module holding one enormous template literal, which meant
// the JS engine parsed 2.8MB of source before the game could start and the presenter carried
// the whole Collins tournament list - 279,496 words - in memory.  Most of that list is words
// no party guest will ever play (see _artifacts/README.md for how it was pared down).
//
// Now it is 50,000 words as a gzipped text file, fetched at runtime:
//
//   * 438KB of text compressed to 137KB on disk and on the wire, whatever the server or the
//     CDN in front of it decides to do about encoding - the file is already compressed.
//   * No JS parse at all.  It is data, fetched and decompressed, not code.
//   * Still presenter-only and still lazily loaded: nothing here is imported until the
//     Lexible presenter model asks for it, so a phone never downloads a dictionary.
// ==========================================================================================

// -------------------------------------------------------------------
// loadWordList - the newline-separated, upper-case word list.
//
// Throws rather than returning something empty: a Lexible presenter with no
// dictionary cannot validate a single word, and failing loudly here is far
// easier to diagnose than a game where nothing is ever a valid word.
// -------------------------------------------------------------------
export async function loadWordList(): Promise<string> {
  const response = await fetch(wordsUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch the Lexible word list: ${response.status}`);
  }

  // DecompressionStream is the browser's own gunzip.  Chrome has had it since
  // 2020 and Safari/Firefox since 2023, and the presenter is a desktop or TV
  // browser rather than somebody's old phone - but if it is missing we want to
  // know, so it is reported rather than silently degrading.
  if (typeof DecompressionStream === "undefined") {
    const err = new Error("DecompressionStream is unavailable; cannot read the word list");
    reportError("window", err);
    throw err;
  }

  const stream = response.body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) throw new Error("The word list response had no body");
  return await new Response(stream).text();
}
