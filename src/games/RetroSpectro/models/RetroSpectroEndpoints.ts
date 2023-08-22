import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs";
import { RetroSpectroGameState } from "./RetroSpectroPresenterModel";

//--------------------------------------------------------------------------------------
// Request/Answer
//--------------------------------------------------------------------------------------
export interface RetroSpectroAnswerMessage
{
    answer: string;
    answerType: string;
}

export const RetroSpectroAnswerEndpoint: MessageEndpoint<
    RetroSpectroAnswerMessage, 
    unknown> = {
    route: "/games/retrospectro/gameplay/answer",
    responseRequired: false
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
