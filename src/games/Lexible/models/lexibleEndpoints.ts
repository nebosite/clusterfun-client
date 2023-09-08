import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs";


export type LetterChain = {letter: string, coordinates: Vector2}[]

// ------------------------------------------------------------------------------------------
// Onboard Client
// ------------------------------------------------------------------------------------------

export interface PlayBoard {
    gridWidth: number
    gridHeight: number
    gridData: string
}

export interface LexibleOnboardClientMessage {
    roundNumber: number;
    gameState: string;
    playBoard: PlayBoard;
    teamName: string;
    settings: { startFromTeamArea: boolean }
}


export const LexibleOnboardClientEndpoint: MessageEndpoint<unknown, LexibleOnboardClientMessage> = {
    route: "/games/lexible/lifecycle/onboard-client",
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000
}

//--------------------------------------------------------------------------------------
// Switch Teams
//--------------------------------------------------------------------------------------
export interface LexibleSwitchTeamRequest
{
    desiredTeam: string
}

export interface LexibleSwitchTeamResponse
{
    currentTeam: string
}


export const LexibleSwitchTeamEndpoint: MessageEndpoint<
    LexibleSwitchTeamRequest,
    LexibleSwitchTeamResponse> = {
        route: "/games/lexible/lifecycle/switch-team",
        suggestedRetryIntervalMs: 2000,
        suggestedTotalLifetimeMs: 10000
    }


// ------------------------------------------------------------------------------------------
// Hey Client, these letters have been touched recently
// TODO: Could combine with the other endpoint to make this communication simpler
// ------------------------------------------------------------------------------------------
export interface LexibleRecentlyTouchedLettersMessage
{
    letterCoordinates: Vector2[];
}

export const LexibleServerRecentlyTouchedLettersEndpoint: MessageEndpoint<LexibleRecentlyTouchedLettersMessage, void> = {
    route: "/games/lexible/juice/recently-touched-letters"
}

//--------------------------------------------------------------------------------------
// Hey server, I touched some letters!
//--------------------------------------------------------------------------------------
export interface LexibleTouchLetterRequest
{
    touchPoint: Vector2
}

export const LexibleReportTouchLetterEndpoint: MessageEndpoint<LexibleTouchLetterRequest, void> = {
    route: "/games/lexible/juice/touch-letter"
}

//--------------------------------------------------------------------------------------
// Word hints
//--------------------------------------------------------------------------------------
export interface LexibleWordHintRequest
{
    currentWord: LetterChain
}

export interface LexibleWordHintResponse
{
    wordList: string[]
}

export const LexibleRequestWordHintsEndpoint: MessageEndpoint<LexibleWordHintRequest, LexibleWordHintResponse> = {
    route: "/games/lexible/gameplay/get-word-hints",
    suggestedRetryIntervalMs: 1000,
    suggestedTotalLifetimeMs: 10000
}

//--------------------------------------------------------------------------------------
// Board updates
//--------------------------------------------------------------------------------------
export interface LexibleBoardUpdateNotification
{
    letters: LetterChain
    scoringPlayerId: string,
    scoringTeam: string,
    score: number
}

export const LexibleBoardUpdateEndpoint: MessageEndpoint<LexibleBoardUpdateNotification, unknown> = {
    route: "/games/lexible/gameplay/update-board",
    suggestedRetryIntervalMs: Number.POSITIVE_INFINITY,
    suggestedTotalLifetimeMs: 30000
}

//--------------------------------------------------------------------------------------
// Word Submissions
//--------------------------------------------------------------------------------------
export interface LexibleWordSubmissionRequest
{
    letters: LetterChain
}

export interface LexibleWordSubmissionResponse
{
    success: boolean,
    letters: LetterChain
}


export const LexibleSubmitWordEndpoint: MessageEndpoint<
    LexibleWordSubmissionRequest,
    LexibleWordSubmissionResponse> = {
        route: "/games/lexible/gameplay/submit-word",
        suggestedRetryIntervalMs: 2000,
        suggestedTotalLifetimeMs: 10000
    }

//--------------------------------------------------------------------------------------
// End of round
//--------------------------------------------------------------------------------------
export interface LexibleEndOfRoundMessage
{
    roundNumber: number,
    winningTeam: string
}

export const LexibleEndRoundEndpoint: MessageEndpoint<LexibleEndOfRoundMessage, unknown> = {
    route: "/games/lexible/lifecycle/end-round",
    suggestedRetryIntervalMs: 2000,
    suggestedTotalLifetimeMs: 30000
}