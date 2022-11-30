import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs";

export interface PlayBoard {
    gridWidth: number
    gridHeight: number
    gridData: string
}

// ------------------------------------------------------------------------------------------
// LexiblePlayRequestMessage
// ------------------------------------------------------------------------------------------
export interface LexibleOnboardClientMessage {
    roundNumber: number;
    playBoard: PlayBoard;
    teamName: string;
    settings: { startFromTeamArea: boolean }
}

export type LetterChain = {letter: string, coordinates: Vector2}[]

export const LexibleOnboardClientEndpoint: MessageEndpoint<unknown, LexibleOnboardClientMessage> = {
    route: "/games/lexible/lifecycle/onboard-client",
    responseRequired: true
}

// ------------------------------------------------------------------------------------------
// LexibleRecentlyTouchedLettersMessage
// ------------------------------------------------------------------------------------------
export interface LexibleRecentlyTouchedLettersMessage
{
    letterCoordinates: Vector2[];
}

export const LexibleShowRecentlyTouchedLettersEndpoint: MessageEndpoint<LexibleRecentlyTouchedLettersMessage, unknown> = {
    route: "/games/lexible/juice/recently-touched-letters",
    responseRequired: false
}

export interface LexibleTouchLetterRequest
{
    touchPoint: Vector2
}

export const LexibleRequestTouchLetterEndpoint: MessageEndpoint<LexibleTouchLetterRequest, unknown> = {
    route: "/games/lexible/juice/touch-letter",
    responseRequired: false
}

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
    responseRequired: true
}

export interface LexibleBoardUpdateNotification
{
    letters: LetterChain
    scoringPlayerId: string,
    scoringTeam: string,
    score: number
}

export const LexibleBoardUpdateEndpoint: MessageEndpoint<LexibleBoardUpdateNotification, unknown> = {
    route: "/games/lexible/gameplay/update-board",
    responseRequired: false
}

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
        responseRequired: true
    }

export interface LexibleEndOfRoundMessage
{
    roundNumber: number,
    winningTeam: string
}

export const LexibleEndRoundEndpoint: MessageEndpoint<LexibleEndOfRoundMessage, unknown> = {
    route: "/games/lexible/lifecycle/end-round",
    responseRequired: true
}