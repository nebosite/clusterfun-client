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
    responseRequired: true,
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
    responseRequired: true,
    suggestedRetryIntervalMs: 2000,
    suggestedTotalLifetimeMs: 30000
}

export const RetroSpectroStatePushEndpoint: MessageEndpoint<
    RetroSpectroStateUpdateResponse, 
    unknown> = {
    route: "/games/retrospectro/gameplay/statepush",
    responseRequired: false
}

//--------------------------------------------------------------------------------------
// Discussion
//--------------------------------------------------------------------------------------
export interface RetroSpectroDiscussionMessage {
    youAreInThis: boolean;
}

export const RetroSpectroDiscussionEndpoint: MessageEndpoint<
    RetroSpectroDiscussionMessage, 
    unknown> = {
    route: "/games/retrospectro/gameplay/discussion",
    responseRequired: false
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
    unknown> = {
    route: "/games/retrospectro/gameplay/playeraction",
    responseRequired: false
}

//--------------------------------------------------------------------------------------
// EndOfRound
//--------------------------------------------------------------------------------------
export interface RetroSpectroEndOfRoundMessage {
    roundNumber: number;
}

export const RetroSpectroEndOfRoundEndpoint: MessageEndpoint<
    RetroSpectroPlayerActionMessage, 
    unknown> = {
    route: "/games/retrospectro/gameplay/endofround",
    responseRequired: false
}
