import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs";
import { RetroSpectroGameState } from "./PresenterModel";

//--------------------------------------------------------------------------------------
// Request/Answer
//--------------------------------------------------------------------------------------
export interface RetroSpectroAnswerMessage
{
    answer: string;
    answerType: string;
}

export interface RetroSpectroAnswerResponse
{
    success: boolean;
    answer: string;
    answerType: string;
}

export const RetroSpectroAnswerEndpoint: MessageEndpoint<
    RetroSpectroAnswerMessage, 
    RetroSpectroAnswerResponse> = {
    route: "/games/retrospectro/gameplay/answer",
    suggestedRetryIntervalMs: 2000,
    suggestedTotalLifetimeMs: 10000
}

//--------------------------------------------------------------------------------------
// State Update
//--------------------------------------------------------------------------------------
export interface RetroSpectroStateUpdateRequest
{
}

export interface RetroSpectroStateUpdateResponse
{
    currentStage: RetroSpectroGameState;
}

export const RetroSpectroStateUpdateEndPoint: MessageEndpoint<
    RetroSpectroStateUpdateRequest, 
    RetroSpectroStateUpdateResponse> = {
    route: "/games/retrospectro/gameplay/staterequest",
    suggestedRetryIntervalMs: 2000,
    suggestedTotalLifetimeMs: 30000
}

export const RetroSpectroStatePushEndpoint: MessageEndpoint<
    RetroSpectroStateUpdateResponse, 
    void> = {
    route: "/games/retrospectro/gameplay/statepush"
}

//--------------------------------------------------------------------------------------
// Discussion
//--------------------------------------------------------------------------------------
export interface RetroSpectroDiscussionMessage {
    youAreInThis: boolean;
}

export const RetroSpectroDiscussionEndpoint: MessageEndpoint<
    RetroSpectroDiscussionMessage, 
    void> = {
    route: "/games/retrospectro/gameplay/discussion"
}

//--------------------------------------------------------------------------------------
// PlayerAction
//--------------------------------------------------------------------------------------
export interface RetroSpectroPlayerActionMessage {
    roundNumber: number;
    action: string;
    actionData: any;
}

export const RetroSpectroPlayerActionEndpoint: MessageEndpoint<
    RetroSpectroPlayerActionMessage, 
    void> = {
    route: "/games/retrospectro/gameplay/playeraction"
}

//--------------------------------------------------------------------------------------
// EndOfRound
//--------------------------------------------------------------------------------------
export interface RetroSpectroEndOfRoundMessage {
    roundNumber: number;
}

export const RetroSpectroEndOfRoundEndpoint: MessageEndpoint<
    RetroSpectroPlayerActionMessage, 
    void> = {
    route: "/games/retrospectro/gameplay/endofround"
}
