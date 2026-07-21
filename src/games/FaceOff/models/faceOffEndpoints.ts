import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { PromptInfo } from "./prompts";

// ==========================================================================================
// The complete wire API between a FaceOff client (phone) and the presenter (big screen).
// Photos travel as base64 data-URL JPEG strings (downscaled on the phone, PartyPix-style).
// The full-resolution image never leaves the presenter — phones only ever receive `thumb`s.
//
//   Route format: /games/faceoff/<category>/<action>
//     lifecycle - onboard / round transitions
//     actions   - player inputs that change game state
//     push      - presenter -> client fire-and-forget
// ==========================================================================================

// One player's slot in a matchup, as shown to voters. Deliberately ANONYMOUS — no
// playerId/name/avatar — so votes are cast on the mimic, not on who took it.
export interface VoteEntryInfo {
  entryId: string; // opaque; vote references this, not a player id
  thumb: string; // small base64 JPEG data URL (empty string if the contestant no-showed)
}

// A matchup a given phone is eligible to vote on (i.e. it is not a contestant in it).
export interface VotableMatchupInfo {
  matchupId: string;
  prompt: PromptInfo; // revealed to voters so they can judge the mimic
  entries: VoteEntryInfo[];
}

export interface StandingInfo {
  playerId: string;
  name: string;
  avatarId: number;
  score: number;
}

export type FaceOffRole = "contestant" | "judge";

// ------------------------------------------------------------------------------------------
// Onboard — the phone's one-stop request for full state. Called on join, on rejoin after a
// refresh, and whenever the presenter broadcasts InvalidateStateEndpoint. Everything the
// phone needs to rebuild its screen goes in the response (clients can miss individual pushes).
// The request carries the device's camera capability so the presenter can assign roles.
// ------------------------------------------------------------------------------------------
export interface FaceOffOnboardRequest {
  hasCamera: boolean;
}

export interface FaceOffOnboardResponse {
  state: string; // presenter gameState
  round: number;
  totalRounds: number;
  role: FaceOffRole; // this player's role THIS round
  roundId: number; // tags a capture so a stale snap can be dropped
  prompt: PromptInfo | null; // this player's secret prompt, if a contestant this round
  submitted: boolean; // has this contestant already submitted this round
  votableMatchups: VotableMatchupInfo[];
  myVotes: { matchupId: string; entryId: string }[]; // restore my current choices
  countdownMsLeft: number; // capture countdown mirror (0 outside Capturing)
  standings: StandingInfo[];
  needCamera: boolean; // room can't form a matchup — needs >= 2 cameras
}

export const FaceOffOnboardEndpoint: MessageEndpoint<
  FaceOffOnboardRequest,
  FaceOffOnboardResponse
> = {
  route: "/games/faceoff/lifecycle/onboard",
  suggestedRetryIntervalMs: 5000,
  suggestedTotalLifetimeMs: 30000,
};

// ------------------------------------------------------------------------------------------
// Submit photo — a contestant sends the frame captured at the snap (or a picked file). Echoes
// acceptance; the full image is kept only on the presenter, the thumb is used for voting.
// ------------------------------------------------------------------------------------------
export interface FaceOffSubmitRequest {
  roundId: number;
  full: string; // base64 JPEG data URL, reveal resolution
  thumb: string; // base64 JPEG data URL, small
}

export interface FaceOffSubmitResponse {
  accepted: boolean;
  error?: string;
}

export const FaceOffSubmitPhotoEndpoint: MessageEndpoint<
  FaceOffSubmitRequest,
  FaceOffSubmitResponse
> = {
  route: "/games/faceoff/actions/submit-photo",
  suggestedRetryIntervalMs: 4000,
  suggestedTotalLifetimeMs: 20000,
};

// ------------------------------------------------------------------------------------------
// Vote — a judge picks the better entry in a matchup (by opaque entryId). One vote per
// matchup; re-voting switches the choice while voting is open; can't vote your own matchup.
// ------------------------------------------------------------------------------------------
export interface FaceOffVoteRequest {
  matchupId: string;
  entryId: string;
}

export interface FaceOffVoteResponse {
  accepted: boolean;
  error?: string;
}

export const FaceOffVoteEndpoint: MessageEndpoint<FaceOffVoteRequest, FaceOffVoteResponse> = {
  route: "/games/faceoff/actions/vote",
  suggestedRetryIntervalMs: 3000,
  suggestedTotalLifetimeMs: 12000,
};

// ------------------------------------------------------------------------------------------
// Snap now — presenter -> contestants at countdown zero. Each contestant phone grabs the
// current live-camera frame and uploads it via SubmitPhoto. Fire-and-forget.
// ------------------------------------------------------------------------------------------
export interface FaceOffSnapNowMessage {
  roundId: number;
}

export const FaceOffSnapNowEndpoint: MessageEndpoint<FaceOffSnapNowMessage, void> = {
  route: "/games/faceoff/push/snap-now",
};
