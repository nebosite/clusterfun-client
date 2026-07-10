// -------------------------------------------------------------------
// partyPixLogic
//
// The PartyPix economy + slideshow rules as pure, side-effect-free
// functions so they can be unit-tested without the game framework,
// networking, or MobX. The presenter model (PresenterModel.ts) holds the
// observable state and delegates the decisions here.
// -------------------------------------------------------------------
import {
  UPLOAD_COST,
  CREDIT_UPVOTE_MILESTONES,
  CREDIT_CAP,
  FLAG_THRESHOLD_DEFAULT,
  FLAG_THRESHOLD_APPROVED,
} from "./GameSettings";

export type VoteKind = "up" | "down";

// Per-photo vote bookkeeping. Voter IDs are stored (not just counts) so we
// can enforce one-vote-per-player and let a player change their mind.
// `creditedVoters` remembers who has already moved this photo's author toward
// a credit, so toggling an upvote can't farm credits (see applyVote).
export interface VoteSets {
  upVoters: Set<string>;
  downVoters: Set<string>;
  deleteVoters: Set<string>;
  creditedVoters: Set<string>;
}

export function makeVoteSets(): VoteSets {
  return {
    upVoters: new Set<string>(),
    downVoters: new Set<string>(),
    deleteVoters: new Set<string>(),
    creditedVoters: new Set<string>(),
  };
}

// A player can upload only if they can afford it.
export function canUpload(credits: number): boolean {
  return credits >= UPLOAD_COST;
}

// -------------------------------------------------------------------
// applyVote
//
// Record an up/down vote by `voterId` on a photo authored by `authorId`.
// Rules: no self-voting; one vote per player; up/down are mutually
// exclusive; tapping the same direction again toggles it off. Mutates the
// passed sets. Returns:
//   - `upvoteAdded`: this call transitioned the voter into the upvote state.
//   - `countsForCredit`: this is the FIRST time this voter has ever upvoted
//     this photo, so it may move the author toward a credit. Once true for a
//     voter it is never true again for the same photo — a voter can toggle
//     their upvote endlessly but only ever contributes one credit-step, which
//     keeps the "3 upvotes = 1 credit" rule about breadth of approval and
//     blocks single-accomplice credit farming.
// -------------------------------------------------------------------
export function applyVote(
  sets: VoteSets,
  voterId: string,
  authorId: string,
  kind: VoteKind,
): { ok: boolean; upvoteAdded: boolean; countsForCredit: boolean } {
  if (voterId === authorId) return { ok: false, upvoteAdded: false, countsForCredit: false };

  const hadUp = sets.upVoters.has(voterId);
  const hadDown = sets.downVoters.has(voterId);

  sets.upVoters.delete(voterId);
  sets.downVoters.delete(voterId);

  // Re-tapping the same direction toggles the vote off.
  if (kind === "up" && !hadUp) sets.upVoters.add(voterId);
  if (kind === "down" && !hadDown) sets.downVoters.add(voterId);

  const hasUp = sets.upVoters.has(voterId);
  const upvoteAdded = hasUp && !hadUp;

  let countsForCredit = false;
  if (upvoteAdded && !sets.creditedVoters.has(voterId)) {
    sets.creditedVoters.add(voterId);
    countsForCredit = true;
  }

  return { ok: true, upvoteAdded, countsForCredit };
}

// Record a flag/delete request. One per player. Returns whether it was newly
// added (so the caller only re-checks the threshold when something changed).
export function applyDeleteRequest(
  sets: VoteSets,
  voterId: string,
): { ok: boolean; added: boolean } {
  if (sets.deleteVoters.has(voterId)) return { ok: true, added: false };
  sets.deleteVoters.add(voterId);
  return { ok: true, added: true };
}

// How many flags pull a photo out of rotation: 1 by default, or 3 once the
// presenter has "OK"d it.
export function flagThreshold(approved: boolean): number {
  return approved ? FLAG_THRESHOLD_APPROVED : FLAG_THRESHOLD_DEFAULT;
}

export function shouldPullFromRotation(flagCount: number, approved: boolean): boolean {
  return flagCount >= flagThreshold(approved);
}

// How many bonus credits are earned when a player's lifetime upvote count moves
// from `prevTotalUp` to `newTotalUp` — one for each CREDIT_UPVOTE_MILESTONES
// value crossed. Always >= 0 since totalUp only ever increases.
export function creditsForUpvoteCount(prevTotalUp: number, newTotalUp: number): number {
  return CREDIT_UPVOTE_MILESTONES.filter((m) => m > prevTotalUp && m <= newTotalUp).length;
}

// Add earned credits without exceeding the soft cap.
export function grantCredits(currentCredits: number, earned: number): number {
  return Math.min(CREDIT_CAP, currentCredits + earned);
}

// Upvotes still needed before the next credit milestone (for the phone's
// "next credit in N upvotes" hint). Returns 0 once every milestone is reached.
export function upvotesUntilNextCredit(totalUp: number): number {
  const next = CREDIT_UPVOTE_MILESTONES.find((m) => m > totalUp);
  return next === undefined ? 0 : next - totalUp;
}

// A cheap, stable content fingerprint (djb2 + length) used to block re-uploading
// a photo the presenter permanently removed. Not cryptographic — just enough to
// recognize the exact same bytes coming back.
export function imageHash(data: string): string {
  let h = 5381;
  for (let i = 0; i < data.length; i++) {
    h = (Math.imul(h, 33) + data.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + "-" + data.length.toString(36);
}

// Index of the next slide in a rotating slideshow. Returns 0 for an empty set.
export function nextSlideIndex(currentIndex: number, count: number): number {
  if (count <= 0) return 0;
  return (currentIndex + 1) % count;
}

// Keep a slideshow index valid after photos are added/removed.
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}
