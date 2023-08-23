import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";

export const TestatoOnboardClientEndpoint: MessageEndpoint<unknown, { roundNumber: number, customText: string, state: string }> = {
    route: "/games/testato/lifecycle/onboard",
    suggestedRetryIntervalMs: 5000,
    suggestedTotalLifetimeMs: 30000
}

export const TestatoColorChangeActionEndpoint: MessageEndpoint<{ colorStyle: string }, void> = {
    route: "/games/testato/actions/color-change",
}

export const TestatoMessageActionEndpoint: MessageEndpoint<{ message: string }, void> = {
    route: "/games/testato/actions/message",
}

export const TestatoTapActionEndpoint: MessageEndpoint<{ point: Vector2 }, void> = {
    route: "/games/testato/actions/tap",
}