import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";
import { TestatoPlayer } from "./TestatoPlayer";

export const TestatoOnboardClientEndpoint: MessageEndpoint<unknown, { roundNumber: number, customText: string, state: string }> = {
    route: "/games/testato/lifecycle/onboard-client",
    responseRequired: true,
    suggestedRetryIntervalMs: 5000,
    suggestedTotalLifetimeMs: 30000
}

export const TestatoOnboardPresenterEndpoint: MessageEndpoint<unknown, { roundNumber: number, state: string, players: TestatoPlayer[] }> = {
    route: "/games/testato/lifecycle/onboard-presenter",
    responseRequired: true,
    suggestedRetryIntervalMs: 5000,
    suggestedTotalLifetimeMs: 30000
}

export const TestatoColorChangeActionEndpoint: MessageEndpoint<{ colorStyle: string }, unknown> = {
    route: "/games/testato/actions/color-change",
    responseRequired: false
}

export const TestatoMessageActionEndpoint: MessageEndpoint<{ message: string }, unknown> = {
    route: "/games/testato/actions/message",
    responseRequired: false
}

export const TestatoTapActionEndpoint: MessageEndpoint<{ point: Vector2 }, unknown> = {
    route: "/games/testato/actions/tap",
    responseRequired: false
}