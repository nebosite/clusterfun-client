// ==========================================================================================
// What a drag across the board should do to the word being spelled.
//
// Tapping letters one at a time works, but spelling a six-letter word meant six separate
// taps on a phone while the board is also a scrolling surface - and a tap that lands at the
// end of a pan gets thrown away, so long words were genuinely fiddly.
//
// Dragging spells instead: put a finger on a letter you are allowed to start from and pull
// through the letters you want.  Pulling BACK the way you came takes letters off again, which
// is the natural way to fix a wrong turn without lifting off and starting over.
//
// If the letter under the finger is not one you may start from, the drag is a scroll instead
// - exactly as it was before.  That is the whole rule, and it is decided once, on touch-down.
//
// Kept pure and coordinate-only so the rule can be tested without a grid, a model or a phone.
// ==========================================================================================

export interface Cell {
  x: number;
  y: number;
}

export type ChainAction =
  /** Nothing to do - the letter is not reachable from here, or is already used. */
  | { kind: "none" }
  /** Begin a new word on this letter. */
  | { kind: "start" }
  /** Add this letter to the end of the word. */
  | { kind: "extend" }
  /** Pull back: drop the last letter, because the finger retraced onto the one before it. */
  | { kind: "retract" };

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/**
 * Letters are adjacent if they touch at all, including diagonally - the same rule the word
 * search uses, so anything you can spell you can also drag.
 */
export function isAdjacent(a: Cell, b: Cell): boolean {
  if (same(a, b)) return false;
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/**
 * What dragging onto `target` should do, given the word so far.
 *
 * `canStart` is the game's own rule about which letters may begin a word (with
 * "words must start from team territory" on, that means one of your own tiles).
 */
export function chainActionFor(chain: Cell[], target: Cell, canStart: boolean): ChainAction {
  if (chain.length === 0) {
    return canStart ? { kind: "start" } : { kind: "none" };
  }

  // Retracing onto the previous letter takes the last one off.  Checked BEFORE
  // the already-in-chain test below, which would otherwise swallow it.
  if (chain.length >= 2 && same(target, chain[chain.length - 2])) {
    return { kind: "retract" };
  }

  // Still on the letter we are already at, or somewhere else in the word: leave
  // it alone.  Re-adding a letter already in the chain would make a word that
  // cannot be spelled on the board.
  if (chain.some((cell) => same(cell, target))) {
    return { kind: "none" };
  }

  if (isAdjacent(chain[chain.length - 1], target)) {
    return { kind: "extend" };
  }

  // The finger has jumped somewhere unreachable - most likely it left the board
  // and came back.  Wait until it returns to the end of the word.
  return { kind: "none" };
}
