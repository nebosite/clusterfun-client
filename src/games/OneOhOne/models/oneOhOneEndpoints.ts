import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { PieceMove } from "./oneOhOneLogic";

// ==========================================================================================
// The wire API between phones and the presenter for 101.  See DESIGN.md for the
// message table and TemplateGame/models/templateEndpoints.ts for conventions.
// ==========================================================================================

export enum OneOhOneRoundPhase {
  Collecting = "Collecting", // players are picking numbers
  Reveal = "Reveal", // showing the round's results
}

// A client-side view of one piece the player controls
export interface PieceSnapshot {
  pieceId: string;
  name: string;
  avatarId: number;
  position: number;
  guess: number | null; // this round's pick (null = not picked yet)
  confirmed: boolean; // pick is locked in for this round
  lastMove: PieceMove | null; // what happened to it last round
}

// A move with enough context for any screen to display it (all pieces, not
// just the receiving player's)
export interface OneOhOneMoveSummary extends PieceMove {
  name: string;
  avatarId: number;
}

// ------------------------------------------------------------------------------------------
// Onboard Client - full state rebuild on join/rejoin/invalidate
// ------------------------------------------------------------------------------------------
export interface OneOhOneOnboardClientMessage {
  gameState: string;
  roundNumber: number;
  phase: OneOhOneRoundPhase;
  secondsLeft: number;
  myPieces: PieceSnapshot[];
  lastResults: OneOhOneMoveSummary[];
  winnerIds: string[];
  winnerNames: string[];
}

export const OneOhOneOnboardClientEndpoint: MessageEndpoint<unknown, OneOhOneOnboardClientMessage> =
  {
    route: "/games/oneohone/lifecycle/onboard-client",
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000,
  };

// ------------------------------------------------------------------------------------------
// Set Guess - a player picks (or changes) a number for one of their pieces.
// confirmed=true locks the pick in; the round resolves once every human piece
// is confirmed (or the timer expires - unconfirmed picks still count then).
// ------------------------------------------------------------------------------------------
export interface OneOhOneSetGuessRequest {
  pieceId: string;
  guess: number;
  confirmed: boolean;
}

export interface OneOhOneSetGuessResponse {
  accepted: boolean;
  reason?: string;
}

export const OneOhOneSetGuessEndpoint: MessageEndpoint<
  OneOhOneSetGuessRequest,
  OneOhOneSetGuessResponse
> = {
  route: "/games/oneohone/actions/set-guess",
  suggestedRetryIntervalMs: 2000,
  suggestedTotalLifetimeMs: 10000,
};

// ------------------------------------------------------------------------------------------
// Round Start - presenter announces a new collecting phase
// ------------------------------------------------------------------------------------------
export interface OneOhOneRoundStartMessage {
  roundNumber: number;
  secondsAllowed: number;
}

export const OneOhOneRoundStartEndpoint: MessageEndpoint<OneOhOneRoundStartMessage, void> = {
  route: "/games/oneohone/lifecycle/round-start",
};

// ------------------------------------------------------------------------------------------
// Round Result - presenter announces how the round resolved (all pieces, with
// names, so phones can show everyone's moves).  Winners present means the game
// is over once the reveal finishes.
// ------------------------------------------------------------------------------------------
export interface OneOhOneRoundResultMessage {
  roundNumber: number;
  results: OneOhOneMoveSummary[];
  winnerIds: string[];
  winnerNames: string[];
}

export const OneOhOneRoundResultEndpoint: MessageEndpoint<OneOhOneRoundResultMessage, void> = {
  route: "/games/oneohone/lifecycle/round-result",
};
