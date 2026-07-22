import MessageEndpoint from "libs/messaging/MessageEndpoint";

// ==========================================================================================
// The complete wire API between the client (player's phone) and the presenter (shared
// screen).  Every message crossing the relay is a MessageEndpoint<REQUEST, RESPONSE>.
//
// NOTE: YouTube search is NOT a relay message.  The phone talks to the MusicProvider
// (YouTube Data API, or the mock catalog in dev) directly, so search never touches the
// server.  Only two game-specific messages cross the relay: submit-song and submit-ballot,
// plus the standard onboard + InvalidateState pattern.  Payloads stay tiny (ids + short
// strings + a start offset) — thumbnails are URLs, never base64.
// ==========================================================================================

// ------------------------------------------------------------------------------------------
// Shared shapes used inside the onboard response.
// ------------------------------------------------------------------------------------------
export interface MixtapeScoreInfo {
  playerId: string;
  name: string;
  avatarId: number;
  score: number;
}

// A song as shown to voters — deliberately WITHOUT the submitter (kept secret until tally).
export interface MixtapeVoteSong {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
}

// A player's own cued-up submission (echoed back so a refreshed phone rebuilds its screen).
export interface MixtapeSubmissionInfo {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSec: number;
  startSec: number;
}

// ------------------------------------------------------------------------------------------
// Onboard Client — the client's one-stop request for full game state.  Called on join,
// on rejoin after a refresh, and whenever the presenter broadcasts InvalidateStateEndpoint.
// The client FULLY rebuilds its screen from this (it can miss individual pushes).
// ------------------------------------------------------------------------------------------
export interface MixtapeOnboardResponse {
  gameState: string;
  roundNumber: number;
  prompt: string;
  targetScore: number;
  scores: MixtapeScoreInfo[];
  presentCount: number;
  submittedCount: number;
  votedCount: number;
  // Selecting: the caller's current cued song (or null)
  mySubmission: MixtapeSubmissionInfo | null;
  // Voting+: the round's songs (no submitters); the caller's own song id (to disable
  // self-vote); and the caller's current ballot (ordered videoIds).
  votingSongs: MixtapeVoteSong[];
  myOwnVideoId: string | null;
  myBallot: string[];
}

export const MixtapeOnboardClientEndpoint: MessageEndpoint<unknown, MixtapeOnboardResponse> = {
  route: "/games/mixtape/lifecycle/onboard-client",
  suggestedRetryIntervalMs: 10000,
  suggestedTotalLifetimeMs: 60000,
};

// ------------------------------------------------------------------------------------------
// Submit Song — the player cues up a track for the current round (Selecting only).
// Re-submitting replaces the previous choice.
// ------------------------------------------------------------------------------------------
export interface MixtapeSubmitSongRequest {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSec: number;
  startSec: number;
}

export interface MixtapeSubmitSongResponse {
  accepted: boolean;
  reason?: string;
  startSec?: number; // authoritative (clamped) start offset
}

export const MixtapeSubmitSongEndpoint: MessageEndpoint<
  MixtapeSubmitSongRequest,
  MixtapeSubmitSongResponse
> = {
  route: "/games/mixtape/actions/submit-song",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 30000,
};

// ------------------------------------------------------------------------------------------
// Submit Ballot — the player ranks their top 3 songs (Voting only).  ranking is an ordered
// list of videoIds (1st, 2nd, 3rd), excluding the player's own song.
// ------------------------------------------------------------------------------------------
export interface MixtapeSubmitBallotRequest {
  ranking: string[];
}

export interface MixtapeSubmitBallotResponse {
  accepted: boolean;
  reason?: string;
  ranking?: string[]; // authoritative (sanitized) ranking
}

export const MixtapeSubmitBallotEndpoint: MessageEndpoint<
  MixtapeSubmitBallotRequest,
  MixtapeSubmitBallotResponse
> = {
  route: "/games/mixtape/actions/submit-ballot",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 30000,
};
