import MessageEndpoint from "./MessageEndpoint";

/**
 * Endpoint for joining a game from the client
 */
export const JoinEndpoint: MessageEndpoint<
    { playerName: string }, 
    { isRejoin: boolean, didJoin: boolean, joinError?: string }
    > = {
    route: "/basic/handshake/join",
    suggestedRetryIntervalMs: 1000,
    suggestedTotalLifetimeMs: 10000
}

/**
 * Endpoint for informing the presenter that a client
 * has quit
 */
export const QuitEndpoint: MessageEndpoint<unknown, void> = {
    route: "/basic/handshake/quit",
}

/**
 * Endpoint for any participant to ping another participant
 */
export const PingEndpoint: MessageEndpoint<
    { pingTime: number }, 
    { pingTime: number, localTime: number }
    > = {
    route: "/basic/ping",
    suggestedRetryIntervalMs: Number.POSITIVE_INFINITY,
    suggestedTotalLifetimeMs: 5000
}

/**
 * Endpoint for the presenter to inform a client that their
 * current state is invalid. The client will respond to this
 * message by invoking the game-specific endpoint to fully
 * resync state.
 */
export const InvalidateStateEndpoint: MessageEndpoint<unknown, void> = {
    route: "/basic/invalidate",
}

/**
 * Endpoint for the presenter to inform the clients that a game has ended
 */
export const GameOverEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/gameover",
}

/**
 * Endpoint for the presenter to force-terminate a client
 */
export const TerminateGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/terminate",
}

/**
 * Endpoint for the presenter to pause all clients
 */
export const PauseGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/pause",
}

/**
 * Endpoint for the presenter to resume all clients
 */
 export const ResumeGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/resume",
}