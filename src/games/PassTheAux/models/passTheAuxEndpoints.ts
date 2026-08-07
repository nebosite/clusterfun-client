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
export interface PassTheAuxScoreInfo {
  playerId: string;
  name: string;
  avatarId: number;
  score: number;
}

// A song as shown to voters — deliberately WITHOUT the submitter (kept secret until tally).
export interface PassTheAuxVoteSong {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
}

// A player's own cued-up submission (echoed back so a refreshed phone rebuilds its screen).
export interface PassTheAuxSubmissionInfo {
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
export interface PassTheAuxOnboardResponse {
  gameState: string;
  roundNumber: number;
  prompt: string;
  targetScore: number;
  scores: PassTheAuxScoreInfo[];
  presentCount: number;
  submittedCount: number;
  votedCount: number;
  // Selecting: the caller's current cued song (or null)
  mySubmission: PassTheAuxSubmissionInfo | null;
  // Voting+: the round's songs (no submitters); the caller's own song id (to disable
  // self-vote); and the caller's current ballot (ordered videoIds).
  votingSongs: PassTheAuxVoteSong[];
  myOwnVideoId: string | null;
  myBallot: string[];
}

export const PassTheAuxOnboardClientEndpoint: MessageEndpoint<unknown, PassTheAuxOnboardResponse> =
  {
    route: "/games/pass-the-aux/lifecycle/onboard-client",
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000,
  };

// ------------------------------------------------------------------------------------------
// Submit Song — the player cues up a track for the current round (Selecting only).
// Re-submitting replaces the previous choice.
// ------------------------------------------------------------------------------------------
export interface PassTheAuxSubmitSongRequest {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSec: number;
  startSec: number;
}

export interface PassTheAuxSubmitSongResponse {
  accepted: boolean;
  reason?: string;
  startSec?: number; // authoritative (clamped) start offset
}

export const PassTheAuxSubmitSongEndpoint: MessageEndpoint<
  PassTheAuxSubmitSongRequest,
  PassTheAuxSubmitSongResponse
> = {
  route: "/games/pass-the-aux/actions/submit-song",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 30000,
};

// ------------------------------------------------------------------------------------------
// Submit Ballot — the player ranks their top 3 songs (Voting only).  ranking is an ordered
// list of videoIds (1st, 2nd, 3rd), excluding the player's own song.
// ------------------------------------------------------------------------------------------
export interface PassTheAuxSubmitBallotRequest {
  ranking: string[];
}

export interface PassTheAuxSubmitBallotResponse {
  accepted: boolean;
  reason?: string;
  ranking?: string[]; // authoritative (sanitized) ranking
}

export const PassTheAuxSubmitBallotEndpoint: MessageEndpoint<
  PassTheAuxSubmitBallotRequest,
  PassTheAuxSubmitBallotResponse
> = {
  route: "/games/pass-the-aux/actions/submit-ballot",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 30000,
};
