import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";

// Endpoints have the form:  [Name]: MessageEndpoint<REQUESTTYPE, RESPONSETYPE>
// The generic types can be "unknown" to signal no data in the request, or no response expected

export interface WrongAnswersStartRoundMessage {
    prompt: string
    minAnswers: number
}

export interface WrongAnswersAnswerUpdateMessage {
    answers: string[]
}

export const WrongAnswersOnboardClientEndpoint: 
    MessageEndpoint<
        unknown, 
        { roundNumber: number, customText: string, state: string }
    > = 
{
    route: "/games/WrongAnswers/lifecycle/onboard",
    suggestedRetryIntervalMs: 5000,
    suggestedTotalLifetimeMs: 30000
}

export const WrongAnswersAnswerUpdate: MessageEndpoint<WrongAnswersAnswerUpdateMessage, void> = {
    route: "/games/WrongAnswers/actions/answerupdate",
}

export const WrongAnswersStartRoundEndpoint: MessageEndpoint<WrongAnswersStartRoundMessage, void> = {
    route: "/games/WrongAnswers/lifecycle/startround",
}

export const WrongAnswersColorChangeActionEndpoint: MessageEndpoint<{ colorStyle: string }, void> = {
    route: "/games/WrongAnswers/actions/color-change",
}

export const WrongAnswersMessageActionEndpoint: MessageEndpoint<{ message: string }, void> = {
    route: "/games/WrongAnswers/actions/message",
}

export const WrongAnswersTapActionEndpoint: MessageEndpoint<{ point: Vector2 }, void> = {
    route: "/games/WrongAnswers/actions/tap",
}