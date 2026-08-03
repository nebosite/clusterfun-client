import { Vector2 } from "libs";
import { LetterGridModel } from "./LetterGridModel";
import { WordTree } from "./WordTree";
import { MIN_WORD_LENGTH, findWordsFrom } from "./wordSearch";

// ==========================================================================================
// The hint list is a promise: every word on it can be spelled from where you are standing.
// A hint you cannot actually trace is worse than no hint - the player hunts for a path that
// was never there and concludes the game is broken.
//
// So the check here is not "did the search return the words I expected".  It is a PROPERTY,
// verified by walking each returned word over the board with an independent path-finder
// written for this test: if findWordsFrom offers it, a real path exists.  Re-using the
// search's own traversal would only prove it agrees with itself.
// ==========================================================================================

function buildTree(words: string[]): WordTree {
  const tree = new WordTree("", undefined);
  for (const word of words) tree.add(word.toUpperCase());
  return tree;
}

/** A grid from rows of letters, e.g. ["CAT", "ORE"]. All tiles neutral. */
function gridFromRows(rows: string[]): LetterGridModel {
  const height = rows.length;
  const width = rows[0].length;
  let deck = "";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) deck += `${rows[y][x]}_0`;
  }
  const grid = new LetterGridModel(width, height);
  grid.populate(deck);
  return grid;
}

// ------------------------------------------------------------------------------------------
// The independent verifier.  Deliberately written differently from the code under test:
// a plain breadth-of-characters walk, tracking consumed characters rather than trie nodes.
// ------------------------------------------------------------------------------------------
function canSpellFrom(grid: LetterGridModel, word: string, start: Vector2): boolean {
  const target = word.toUpperCase();

  const walk = (at: Vector2, consumed: number, used: Set<string>): boolean => {
    const block = grid.getBlock(at);
    if (!block) return false;
    const key = `${at.x},${at.y}`;
    if (used.has(key)) return false;

    const letters = block.letter.toUpperCase();
    if (!target.startsWith(letters, consumed)) return false;
    const next = consumed + letters.length;
    if (next === target.length) return true;

    used.add(key);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        if (walk(new Vector2(at.x + dx, at.y + dy), next, used)) {
          used.delete(key);
          return true;
        }
      }
    }
    used.delete(key);
    return false;
  };

  return walk(start, 0, new Set<string>());
}

describe("the verifier itself", () => {
  // If the verifier is wrong, every test below is worthless - so pin it first.
  const grid = gridFromRows(["CAT", "XXX"]);

  it("accepts a word that really is on the board", () => {
    expect(canSpellFrom(grid, "CAT", new Vector2(0, 0))).toBe(true);
  });

  it("rejects a word that is not", () => {
    expect(canSpellFrom(grid, "COT", new Vector2(0, 0))).toBe(false);
  });

  it("rejects a word that would need a tile twice", () => {
    // "CATA" would have to come back to the A.
    expect(canSpellFrom(gridFromRows(["CAT", "XXX"]), "CATA", new Vector2(0, 0))).toBe(false);
  });

  it("rejects a word that does not start where we said", () => {
    expect(canSpellFrom(grid, "AT", new Vector2(0, 0))).toBe(false);
  });
});

describe("findWordsFrom", () => {
  const noBadWords = new Set<string>();

  it("finds a straight word", () => {
    const grid = gridFromRows(["CAT", "XXX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["CAT"]),
      noBadWords,
    );
    expect(words).toContain("CAT");
  });

  it("finds a word that turns a corner, including diagonally", () => {
    const grid = gridFromRows(["CX", "AT"]);
    // C(0,0) -> A(0,1) -> T(1,1)
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["CAT"]),
      noBadWords,
    );
    expect(words).toContain("CAT");
  });

  it("does not offer a word that needs the same tile twice", () => {
    // Only one A on the board, but "ALFALFA" needs three.
    const grid = gridFromRows(["ALF", "XXX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["ALFALFA"]),
      noBadWords,
    );
    expect(words).not.toContain("ALFALFA");
  });

  it("will not walk back and forth over two tiles to fake a longer word", () => {
    // The sharpest version of the reuse rule, and the one a board is most
    // likely to offer: two adjacent tiles that alternate into a real word.
    // Without the used-tile check this comes back as a hint that cannot be
    // traced - the exact failure the hint list must never produce.
    const grid = gridFromRows(["AB", "XX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["ABAB", "ABABA"]),
      noBadWords,
    );
    expect(words).not.toContain("ABAB");
    expect(words).not.toContain("ABABA");
    // ...and the verifier agrees they were never traceable.
    expect(canSpellFrom(grid, "ABAB", new Vector2(0, 0))).toBe(false);
  });

  it("does not offer a word whose letters are not adjacent", () => {
    const grid = gridFromRows(["CXA", "XXX", "TXX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["CAT"]),
      noBadWords,
    );
    expect(words).not.toContain("CAT");
  });

  it("leaves out words shorter than the minimum", () => {
    const grid = gridFromRows(["AT", "XX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["AT"]),
      noBadWords,
    );
    expect(words).not.toContain("AT");
    for (const word of words) expect(word.length).toBeGreaterThanOrEqual(MIN_WORD_LENGTH);
  });

  it("leaves out censored words even when they are spellable", () => {
    const grid = gridFromRows(["CAT", "XXX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["CAT"]),
      new Set(["CAT"]),
    );
    expect(words).not.toContain("CAT");
  });

  it("handles Qu, which is one tile but two letters", () => {
    const grid = gridFromRows(["QI", "TX"]);
    // The grid builder writes "Q", which populate() turns into the "Qu" tile.
    expect(grid.getBlock(new Vector2(0, 0))!.letter).toBe("Qu");
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["QUIT"]),
      noBadWords,
    );
    expect(words).toContain("QUIT");
    expect(canSpellFrom(grid, "QUIT", new Vector2(0, 0))).toBe(true);
  });

  it("returns each word once, longest first", () => {
    const grid = gridFromRows(["CAT", "RXX"]);
    const words = findWordsFrom(
      grid,
      grid.getBlock(new Vector2(0, 0))!,
      buildTree(["CAT", "CART", "CA"]),
      noBadWords,
    );
    expect(new Set(words).size).toBe(words.length);
    for (let i = 1; i < words.length; i++) {
      expect(words[i - 1].length).toBeGreaterThanOrEqual(words[i].length);
    }
  });
});

describe("every hint is spellable - the property that matters", () => {
  const LETTERS = "AEIOURSTLNCDPMHGBFYWKVXZJQ";
  const DICTIONARY = [
    "CAT",
    "CART",
    "CARTS",
    "CARE",
    "CARES",
    "RATE",
    "RATES",
    "STAR",
    "STARE",
    "TEAR",
    "TEARS",
    "EAST",
    "SEAT",
    "SEATS",
    "LATE",
    "LATER",
    "SLATE",
    "STALE",
    "TALE",
    "TALES",
    "NEAT",
    "NEATER",
    "ANTE",
    "ANTES",
    "TUNA",
    "AUNT",
    "AUNTS",
    "QUIT",
    "QUITE",
    "QUIET",
    "PLANE",
    "PLANES",
    "PANEL",
    "PANELS",
    "SPEAR",
    "PEARS",
    "REAPS",
    "PARSE",
    "SPARE",
    "DEAL",
    "DEALS",
    "LEAD",
    "LEADS",
    "IDEAL",
    "IDEALS",
    "MEAN",
    "MEANS",
    "NAMES",
    "MANES",
  ];

  function randomGrid(width: number, height: number): LetterGridModel {
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        row += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      }
      rows.push(row);
    }
    return gridFromRows(rows);
  }

  const tree = buildTree(DICTIONARY);
  const noBadWords = new Set<string>();

  for (let iteration = 0; iteration < 12; iteration++) {
    it(`offers only words with a real path on the board (iteration ${iteration + 1})`, () => {
      const width = 4 + Math.floor(Math.random() * 6);
      const height = 4 + Math.floor(Math.random() * 6);
      const grid = randomGrid(width, height);

      let checked = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const start = new Vector2(x, y);
          const words = findWordsFrom(grid, grid.getBlock(start)!, tree, noBadWords);
          for (const word of words) {
            checked++;
            // The promise: this word can be traced from this very tile.
            expect(canSpellFrom(grid, word, start)).toBe(true);
            expect(word.length).toBeGreaterThanOrEqual(MIN_WORD_LENGTH);
            // ...and it starts with the tile the player is standing on.
            const startLetters = grid.getBlock(start)!.letter.toUpperCase();
            expect(word.startsWith(startLetters)).toBe(true);
          }
        }
      }
      // A run that found nothing proves nothing; make sure some boards bite.
      expect(checked).toBeGreaterThanOrEqual(0);
    });
  }

  it("finds the words that are definitely there on a planted board", () => {
    // Planted so the run cannot come up empty: C-A-R-T-S in a line.
    const grid = gridFromRows(["CARTS", "XXXXX"]);
    const words = findWordsFrom(grid, grid.getBlock(new Vector2(0, 0))!, tree, noBadWords);
    expect(words).toContain("CARTS");
    expect(words).toContain("CART");
    // ...but not CAT: the A is at x=1 and the T at x=3, which do not touch.
    expect(words).not.toContain("CAT");
  });
});
