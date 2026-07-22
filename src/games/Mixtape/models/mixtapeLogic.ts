// ==========================================================================================
// PURE, framework-free game rules.  No MobX, no session, no DOM - just data in, data out.
//
// All of Mixtape's real decision-making lives here so it is trivially unit-testable
// (see mixtapeLogic.spec.ts) and the models stay thin: they hold observable state and
// delegate every rule to these functions.  Mirrors PartyPix's partyPixLogic.ts and
// CollageBoard's collageBoardLogic.ts.
// ==========================================================================================

import { SONG_PLAY_MS, MAX_BALLOT } from "./GameSettings";

// ------------------------------------------------------------------------------------------
// Start-offset clamping.  A player picks where their 30s snippet begins.  If we know the
// track duration we keep the whole 30s window inside the track; if not (YouTube search does
// not return durations), we only guard against negatives.
// ------------------------------------------------------------------------------------------
export function clampStartSec(startSec: number, durationSec: number): number {
  const play = SONG_PLAY_MS / 1000;
  let s = Number.isFinite(startSec) ? Math.floor(startSec) : 0;
  if (s < 0) s = 0;
  if (durationSec && durationSec > 0) {
    const max = Math.max(0, Math.floor(durationSec) - play);
    if (s > max) s = max;
  }
  return s;
}

// ------------------------------------------------------------------------------------------
// Ballot sanitizing.  Turn a raw ranking into a clean, ordered list of at most MAX_BALLOT
// distinct videoIds that (a) are real songs this round and (b) are not the voter's own song.
// Order is preserved (1st choice first).  Duplicates and unknown/own ids are dropped.
// ------------------------------------------------------------------------------------------
export function sanitizeRanking(
  ranking: string[],
  validVideoIds: Iterable<string>,
  ownVideoId?: string | null,
  maxLen: number = MAX_BALLOT,
): string[] {
  const valid = validVideoIds instanceof Set ? validVideoIds : new Set(validVideoIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranking ?? []) {
    if (typeof id !== "string") continue;
    if (!valid.has(id)) continue;
    if (ownVideoId && id === ownVideoId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= maxLen) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Instant-runoff voting.
// ------------------------------------------------------------------------------------------
export interface Ballot {
  voterId: string;
  ranking: string[]; // ordered videoIds, 1st choice first
}

// One elimination round, recorded so the presenter can animate the tally suspensefully.
export interface IRVStep {
  counts: Record<string, number>; // first-choice count per still-standing song (before this step's elimination)
  activeBallots: number; // ballots not yet exhausted
  exhausted: number; // ballots with no remaining choice
  eliminated: string[]; // song(s) removed at the END of this step ([] on the final/winning step)
}

export interface IRVOutcome {
  steps: IRVStep[];
  winners: string[]; // the winning videoId(s); [] if no ballots were cast
}

// Count first-choice support for the still-standing songs, given the eliminated set.
function tally(
  songIds: string[],
  ballots: Ballot[],
  eliminated: Set<string>,
  songSet: Set<string>,
): { counts: Record<string, number>; active: number } {
  const counts: Record<string, number> = {};
  for (const id of songIds) if (!eliminated.has(id)) counts[id] = 0;
  let active = 0;
  for (const b of ballots) {
    const top = b.ranking.find((id) => songSet.has(id) && !eliminated.has(id));
    if (top !== undefined) {
      counts[top]++;
      active++;
    }
  }
  return { counts, active };
}

// Run instant-runoff.  `submissionOrder` (earliest-submitted first) makes every tie-break
// deterministic, so the animation replays identically after a mid-tally refresh.
//   - A song with a strict majority of active (non-exhausted) ballots wins immediately.
//   - Otherwise the single lowest song is eliminated and its ballots transfer to their next
//     surviving choice.  Elimination ties break by fewest total mentions, then latest
//     submission (keep the earlier-submitted song).
//   - Repeat until one song remains or wins.  No ballots at all -> no winner.
export function runInstantRunoff(
  songIds: string[],
  ballots: Ballot[],
  submissionOrder: string[],
): IRVOutcome {
  const songSet = new Set(songIds);
  const orderIndex = new Map<string, number>();
  submissionOrder.forEach((id, i) => orderIndex.set(id, i));
  const eliminated = new Set<string>();
  const steps: IRVStep[] = [];

  const mentions = (id: string) =>
    ballots.reduce((n, b) => n + (b.ranking.includes(id) ? 1 : 0), 0);

  // Guard against pathological input (a stuck loop can never outlast the song count).
  for (let guard = 0; guard <= songIds.length + 1; guard++) {
    const remaining = songIds.filter((id) => !eliminated.has(id));
    const { counts, active } = tally(songIds, ballots, eliminated, songSet);
    const exhausted = ballots.length - active;

    if (remaining.length === 0 || active === 0) {
      steps.push({ counts, activeBallots: active, exhausted, eliminated: [] });
      return { steps, winners: [] };
    }

    const maxCount = Math.max(...remaining.map((id) => counts[id]));
    const majority = maxCount * 2 > active;
    if (remaining.length === 1 || majority) {
      // Winner: highest count, ties broken by earliest submission.
      const winner = remaining.reduce((best, id) => {
        if (counts[id] > counts[best]) return id;
        if (
          counts[id] === counts[best] &&
          (orderIndex.get(id) ?? 0) < (orderIndex.get(best) ?? 0)
        ) {
          return id;
        }
        return best;
      }, remaining[0]);
      steps.push({ counts, activeBallots: active, exhausted, eliminated: [] });
      return { steps, winners: [winner] };
    }

    // Eliminate exactly one loser.
    const minCount = Math.min(...remaining.map((id) => counts[id]));
    let losers = remaining.filter((id) => counts[id] === minCount);
    if (losers.length > 1) {
      const minMentions = Math.min(...losers.map(mentions));
      losers = losers.filter((id) => mentions(id) === minMentions);
      // Latest-submitted loses the tie (keep the earlier song alive).
      losers.sort((a, b) => (orderIndex.get(b) ?? 0) - (orderIndex.get(a) ?? 0));
    }
    const loser = losers[0];
    eliminated.add(loser);
    steps.push({ counts, activeBallots: active, exhausted, eliminated: [loser] });
  }

  return { steps, winners: [] };
}

// ------------------------------------------------------------------------------------------
// Scoring helpers.
// ------------------------------------------------------------------------------------------

// The winning player(s) so far - highest score, ties allowed.  Minimal shape so it needs no
// knowledge of the player class.
export function findWinnersByScore<T extends { score: number }>(players: T[]): T[] {
  if (players.length === 0) return [];
  const best = Math.max(...players.map((p) => p.score));
  return players.filter((p) => p.score === best);
}

// Has anyone reached the target score (game-ending condition)?
export function hasReachedTarget<T extends { score: number }>(
  players: T[],
  targetScore: number,
): boolean {
  return players.some((p) => p.score >= targetScore);
}

// ------------------------------------------------------------------------------------------
// Fisher-Yates shuffle into a NEW array, using an injectable [0,1) random source so tests
// can make it deterministic.  Used for the prompt deck and the per-round playback order.
// ------------------------------------------------------------------------------------------
export function shuffled<T>(items: T[], rand: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
