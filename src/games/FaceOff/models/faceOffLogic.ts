// ==========================================================================================
// PURE, framework-free game rules. No MobX, no session, no DOM — just data in, data out.
//
// All of FaceOff's decision-making lives here so the models stay thin (they hold observable
// state and delegate every rule to these functions) and the rules are trivially unit-tested.
// Mirrors PartyPix's partyPixLogic.ts and CollageBoard's collageBoardLogic.ts.
// ==========================================================================================

// ------------------------------------------------------------------------------------------
// Fisher-Yates shuffle. Pure given an injected random source (0..1), so tests can pin the
// ordering. Returns a new array; does not mutate the input.
// ------------------------------------------------------------------------------------------
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const k = j > i ? i : j; // guard a rand() that returns exactly 1
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Pair contestants into head-to-head matchups. Groups of 2, with ONE group of 3 when the
// count is odd (so nobody is left prompt-less). Fewer than 2 contestants → no matchups.
// Caller shuffles the ids first for random pairings; pairing itself is deterministic.
// ------------------------------------------------------------------------------------------
export function pairContestants(ids: string[]): string[][] {
  if (ids.length < 2) return [];
  const groups: string[][] = [];
  let i = 0;
  const n = ids.length;
  while (i < n) {
    const remaining = n - i;
    if (remaining === 3) {
      groups.push([ids[i], ids[i + 1], ids[i + 2]]);
      i += 3;
    } else {
      groups.push([ids[i], ids[i + 1]]);
      i += 2;
    }
  }
  return groups;
}

// ------------------------------------------------------------------------------------------
// Choose `count` distinct prompt ids, preferring ones not yet used this game. When the bank
// of unused prompts runs dry mid-game the history resets and cycling begins again. Caller
// shuffles `pool` first for randomness; selection preserves pool order (deterministic).
// Returns the chosen ids and the updated "used" history to store back on the model.
// ------------------------------------------------------------------------------------------
export function selectPrompts(
  pool: string[],
  used: string[],
  count: number,
): { chosen: string[]; nextUsed: string[] } {
  const usedSet = new Set(used);
  const chosen: string[] = [];
  const chosenSet = new Set<string>();

  // First pass: prefer prompts that have not been used yet this game.
  for (const id of pool) {
    if (chosen.length >= count) break;
    if (!usedSet.has(id) && !chosenSet.has(id)) {
      chosen.push(id);
      chosenSet.add(id);
    }
  }

  // Not enough unused prompts left: the bank is exhausted, so reset the history and fill the
  // remainder from anything in the pool (still no duplicates within this selection).
  if (chosen.length < count) {
    for (const id of pool) {
      if (chosen.length >= count) break;
      if (!chosenSet.has(id)) {
        chosen.push(id);
        chosenSet.add(id);
      }
    }
    return { chosen, nextUsed: [...chosen] };
  }

  return { chosen, nextUsed: [...used, ...chosen] };
}

// ------------------------------------------------------------------------------------------
// The winning entry (or entries, on a tie) of a matchup: those with the most votes. A matchup
// with zero total votes has no winner (nobody gets the win bonus).
// ------------------------------------------------------------------------------------------
export function matchupWinners(entries: { entryId: string; votes: number }[]): string[] {
  const max = entries.reduce((m, e) => Math.max(m, e.votes), 0);
  if (max <= 0) return [];
  return entries.filter((e) => e.votes === max).map((e) => e.entryId);
}

// ------------------------------------------------------------------------------------------
// Points an entry earns in a matchup: one lot per vote received, plus a bonus if it won.
// ------------------------------------------------------------------------------------------
export function scoreForEntry(
  votes: number,
  isWinner: boolean,
  pointsPerVote: number,
  winBonus: number,
): number {
  return votes * pointsPerVote + (isWinner ? winBonus : 0);
}

// ------------------------------------------------------------------------------------------
// The overall winning player(s): the highest total score, ties allowed. Works on a minimal
// shape so it needs no knowledge of the player class.
// ------------------------------------------------------------------------------------------
export function findWinners<T extends { score: number }>(players: T[]): T[] {
  if (players.length === 0) return [];
  const best = Math.max(...players.map((p) => p.score));
  return players.filter((p) => p.score === best);
}
