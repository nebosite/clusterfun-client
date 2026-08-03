import { Vector2 } from "libs";
import { LetterBlockModel } from "./LetterBlockModel";
import { LetterGridModel } from "./LetterGridModel";
import { WordTree } from "./WordTree";

// ==========================================================================================
// Which words can be spelled starting from a given letter.
//
// A depth-first walk of the board and the dictionary trie at the same time: step to a
// neighbouring tile, step down the trie by that tile's letters, and stop the moment the trie
// says no word starts this way.  That pruning is what makes it fast enough to answer on every
// tap - the board has thousands of paths and almost none of them spell anything.
//
// Two things that are easy to get wrong and are the reason this is its own tested module:
//
//   * Adjacency here is all EIGHT neighbours, diagonals included.  It is deliberately not the
//     four-way rule used for crossing the board (see teamAreas.ts) - the two rules are
//     different on purpose and were confused for each other before.
//   * A tile may be used once per word.  "Qu" is one tile but two letters in the trie, so a
//     step is not always one character.
// ==========================================================================================

export const MIN_WORD_LENGTH = 3;

/**
 * Every word spellable from `startBlock`, longest first.  Anything on the censor list is
 * dropped here rather than at the phone, so a hint list never suggests one.
 */
export function findWordsFrom(
  grid: LetterGridModel,
  startBlock: LetterBlockModel,
  wordTree: WordTree,
  badWords: Set<string>,
): string[] {
  const usedBlocks = new Set<number>();

  const findHere = (block: LetterBlockModel, parentSpot: WordTree): string[] => {
    const output: string[] = [];
    if (usedBlocks.has(block.__blockid)) return output;

    // A tile can carry more than one letter ("Qu"), so walk the trie per character.
    let wordSpot: WordTree | undefined = parentSpot;
    for (let i = 0; i < block.letter.length; i++) {
      wordSpot = wordSpot?.branch(block.letter[i].toUpperCase());
    }
    // Nothing in the dictionary continues this way - stop, and skip the whole subtree.
    if (!wordSpot) return output;

    const word = wordSpot.myWord;
    if (word && word.length >= MIN_WORD_LENGTH) {
      output.push(word);
    }

    usedBlocks.add(block.__blockid);
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        const neighborBlock = grid.getBlock(new Vector2(x, y).add(block.coordinates));
        if (neighborBlock) {
          output.push(...findHere(neighborBlock, wordSpot));
        }
      }
    }
    usedBlocks.delete(block.__blockid);
    return output;
  };

  const found = findHere(startBlock, wordTree);

  const unique: string[] = [];
  for (const word of found) {
    if (!unique.includes(word) && !badWords.has(word)) unique.push(word);
  }
  unique.sort();
  unique.sort((a, b) => b.length - a.length);
  return unique;
}
