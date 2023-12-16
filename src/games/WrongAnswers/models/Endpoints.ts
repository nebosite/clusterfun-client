import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";

export const WrongAnswersOnboardClientEndpoint: MessageEndpoint<unknown, { roundNumber: number, customText: string, state: string }> = {
    route: "/games/WrongAnswers/lifecycle/onboard",
    suggestedRetryIntervalMs: 5000,
    suggestedTotalLifetimeMs: 30000
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