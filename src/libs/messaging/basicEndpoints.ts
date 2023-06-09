import { GameRole } from "libs/config";
import MessageEndpoint from "./MessageEndpoint";

/**
 * Endpoint for joining a game from the client
 */
export const JoinClientEndpoint: MessageEndpoint<
    { playerName: string }, 
    { isRejoin: boolean, didJoin: boolean, joinError?: string }
    > = {
    route: "/basic/handshake/join-client",
    responseRequired: true,
    suggestedRetryIntervalMs: 1000,
    suggestedTotalLifetimeMs: 10000
}

/**
 * Endpoint for joining a game as a presenter
 */
export const JoinPresenterEndpoint: MessageEndpoint<unknown, { isRejoin: boolean, didJoin: boolean, joinError?: string }> = {
    route: "/basic/handshake/join-presenter",
    responseRequired: true,
    suggestedRetryIntervalMs: 1000,
    suggestedTotalLifetimeMs: 10000
}

/**
 * Endpoint for informing the host that a client
 * has quit
 */
export const QuitClientEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/handshake/quit-client",
    responseRequired: false
}

/**
 * Endpoint for informing the host that a presenter
 * has quit
 */
export const QuitPresenterEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/handshake/quit-presenter",
    responseRequired: false
}

/**
 * Endpoint for any participant to ping another participant
 */
export const PingEndpoint: MessageEndpoint<
    { pingTime: number }, 
    { pingTime: number, localTime: number }
    > = {
    route: "/basic/ping",
    responseRequired: true,
    suggestedRetryIntervalMs: Number.POSITIVE_INFINITY,
    suggestedTotalLifetimeMs: 5000
}

/**
 * Endpoint for the host to inform a client that their
 * current state is invalid. The client will respond to this
 * message by invoking the game-specific endpoint to fully
 * resync state.
 */
export const InvalidateStateEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/invalidate",
    responseRequired: false
}

/**
 * Endpoint for the host to inform the clients that a game has ended
 */
export const GameOverEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/gameover",
    responseRequired: true
}

/**
 * Endpoint for the host to force-terminate a client
 */
export const TerminateGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/terminate",
    responseRequired: true
}

/**
 * Endpoint for the host to pause all clients
 */
export const PauseGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/pause",
    responseRequired: true
}

/**
 * Endpoint for the host to resume all clients
 */
 export const ResumeGameEndpoint: MessageEndpoint<unknown, unknown> = {
    route: "/basic/lifecycle/resume",
    responseRequired: true
}