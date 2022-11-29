import MessageEndpoint from "./MessageEndpoint";

/**
 * Endpoint for joining a game from the client
 */
export const JoinEndpoint: MessageEndpoint<
    { name: string }, 
    { isRejoin: boolean, didJoin: boolean, joinError?: string }
    > = {
    route: "/basic/handshake/join",
    responseRequired: true
}

/**
 * Endpoint for informing the presenter that a client
 * has quit
 */
export const QuitEndpoint: MessageEndpoint<any, any> = {
    route: "/basic/handshake/quit",
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
    responseRequired: true
}

/**
 * Endpoint for the presenter to force-terminate a client
 */
export const TerminateGameEndpoint: MessageEndpoint<any, any> = {
    route: "/basic/lifecycle/terminate",
    responseRequired: false
}

/**
 * Endpoint for the presenter to pause all clients
 */
export const PauseGameEndpoint: MessageEndpoint<any, any> = {
    route: "/basic/lifecycle/pause",
    responseRequired: false
}

/**
 * Endpoint for the presenter to resume all clients
 */
 export const ResumeGameEndpoint: MessageEndpoint<any, any> = {
    route: "/basic/lifecycle/resume",
    responseRequired: false
}