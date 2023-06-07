import MessageEndpoint from "./MessageEndpoint";

/**
 * Endpoint for the VIP to pause the game
 */
export const VipPauseCommandEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/vip/commands/pause",
    responseRequired: false
}

/**
 * Endpoint for the VIP to resume the game
 */
export const VipResumeCommandEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/vip/commands/resume",
    responseRequired: false
}

/**
 * Endpoint for the VIP to end the game
 */
export const VipEndGameCommandEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/vip/commands/end_game",
    responseRequired: false
}