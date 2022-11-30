import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { Vector2 } from "libs/types";

export const TestatoOnboardClientEndpoint: MessageEndpoint<unknown, { roundNumber: number, customText: string, state: string }> = {
    route: "/games/testato/lifecycle/onboard",
    responseRequired: true
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