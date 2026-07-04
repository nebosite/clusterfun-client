// -------------------------------------------------------------------
// groupNaming
//
// When ideas are dragged together into a group during sorting, an
// auto-generated group ("Group A", "Group B", …) is renamed to the
// meaningful words its ideas share. Pure, side-effect-free helpers so
// the rule is easy to unit-test; wired into RetroSpectroAnswerCollection
// .handleDrop in PresenterModel.ts.
// -------------------------------------------------------------------

// Common utility words that, on their own, don't make a meaningful group
// name. A shared phrase must contain at least one word outside this set.
const STOPWORDS = new Set<string>([
  "a",
  "an",
  "and",
  "the",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "as",
  "is",
  "it",
  "its",
  "be",
  "am",
  "are",
  "was",
  "were",
  "this",
  "that",
  "these",
  "those",
  "i",
  "we",
  "you",
  "he",
  "she",
  "they",
  "my",
  "our",
  "your",
  "me",
  "us",
  "but",
  "or",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "can",
  "will",
  "would",
  "should",
  "could",
  "do",
  "does",
  "did",
  "not",
  "no",
  "yes",
  "up",
  "out",
  "about",
  "into",
]);

// Split text into lowercased word tokens, dropping punctuation.
export function normalizeToWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// Remove leading/trailing stopwords so titles read cleanly ("the soda" ->
// "soda"). Returns [] if nothing but stopwords remains.
function trimStopwords(tokens: string[]): string[] {
  let start = 0;
  let end = tokens.length;
  while (start < end && STOPWORDS.has(tokens[start])) start++;
  while (end > start && STOPWORDS.has(tokens[end - 1])) end--;
  return tokens.slice(start, end);
}

// -------------------------------------------------------------------
// sharedSignificantPhrase
//
// The longest contiguous run of words appearing in both texts that,
// after trimming edge stopwords, still contains at least one meaningful
// word. Returns the phrase (lowercased) or null when there is no such
// overlap. Case-insensitive; punctuation-insensitive.
// -------------------------------------------------------------------
export function sharedSignificantPhrase(a: string, b: string): string | null {
  const wa = normalizeToWords(a);
  const wb = normalizeToWords(b);
  let best: string[] = [];

  for (let i = 0; i < wa.length; i++) {
    for (let j = 0; j < wb.length; j++) {
      let k = 0;
      while (i + k < wa.length && j + k < wb.length && wa[i + k] === wb[j + k]) {
        k++;
      }
      if (k > 0) {
        const trimmed = trimStopwords(wa.slice(i, i + k));
        if (trimmed.length > best.length) best = trimmed;
      }
    }
  }

  return best.length > 0 ? best.join(" ") : null;
}

// -------------------------------------------------------------------
// pickGroupNameFromSharedWords
//
// Given the text of the just-dropped idea(s) and the text of the ideas
// already in the group, return the best shared phrase to name the group
// after, or null if the dropped ideas share nothing meaningful with the
// existing ones. Picks the phrase with the most words.
// -------------------------------------------------------------------
export function pickGroupNameFromSharedWords(
  droppedTexts: string[],
  existingTexts: string[],
): string | null {
  let best: string | null = null;
  let bestWordCount = 0;

  for (const dropped of droppedTexts) {
    for (const existing of existingTexts) {
      const phrase = sharedSignificantPhrase(dropped, existing);
      if (phrase) {
        const wordCount = phrase.split(" ").length;
        if (wordCount > bestWordCount) {
          bestWordCount = wordCount;
          best = phrase;
        }
      }
    }
  }

  return best;
}

// An auto-generated group name is either empty (a brand-new group) or the
// "Group X" placeholder. Only these should be overwritten by shared words.
export function isAutoGroupName(name: string | undefined | null): boolean {
  return !name || name.startsWith("Group");
}
