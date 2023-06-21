import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs";
import { LexiblePlayer, MapSize } from "./lexibleDataTypes";


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
    responseRequired: true,
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000
}

// ------------------------------------------------------------------------------------------
// Onboard Presenter
// ------------------------------------------------------------------------------------------

export interface LexibleOnboardPresenterMessage {
    roundNumber: number;
    gameState: string;
    playBoard: PlayBoard;
    players: LexiblePlayer[];
    settings: { startFromTeamArea: boolean, mapSize: MapSize };
    roundWinningTeam: string;
    teamPoints: [number, number];
}

export const LexibleOnboardPresenterEndpoint: MessageEndpoint<unknown, LexibleOnboardPresenterMessage> = {
    route: "/games/lexible/lifecycle/onboard-presenter",
    responseRequired: true,
    suggestedRetryIntervalMs: 10000,
    suggestedTotalLifetimeMs: 60000
}

// ------------------------------------------------------------------------------------------
// Presenter Updates
// ------------------------------------------------------------------------------------------

export const LexiblePushFullPresenterUpdateEndpoint: MessageEndpoint<LexibleOnboardPresenterMessage, unknown> = {
    route: "/games/lexible/presenter/full-update",
    responseRequired: false,
}

// TODO: Add more granular updates to reduce churn

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
        responseRequired: true,
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

export const LexibleServerRecentlyTouchedLettersEndpoint: MessageEndpoint<LexibleRecentlyTouchedLettersMessage, unknown> = {
    route: "/games/lexible/juice/recently-touched-letters",
    responseRequired: false
}

//--------------------------------------------------------------------------------------
// Hey server, I touched some letters!
//--------------------------------------------------------------------------------------
export interface LexibleTouchLetterRequest
{
    touchPoint: Vector2
}

export const LexibleReportTouchLetterEndpoint: MessageEndpoint<LexibleTouchLetterRequest, unknown> = {
    route: "/games/lexible/juice/touch-letter",
    responseRequired: false
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
    responseRequired: true,
    suggestedRetryIntervalMs: 1000,
    suggestedTotalLifetimeMs: 10000
}

//--------------------------------------------------------------------------------------
// Board updates
//--------------------------------------------------------------------------------------
export interface LexibleBoardUpdateNotification
{
    letters: LetterChain,
    word: string,
    scoringPlayerId: string,
    scoringTeam: string,
    score: number
}

export const LexibleBoardUpdateEndpoint: MessageEndpoint<LexibleBoardUpdateNotification, unknown> = {
    route: "/games/lexible/gameplay/update-board",
    responseRequired: false,
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
        responseRequired: true,
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
    responseRequired: true,
    suggestedRetryIntervalMs: 2000,
    suggestedTotalLifetimeMs: 30000
}