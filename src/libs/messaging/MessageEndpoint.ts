/**
 * A reference object that assists users in setting up endpoints.
 * Each game should declare a module containing the endpoints
 * they want to support.
 */
export default interface MessageEndpoint<REQUEST, RESPONSE> {
    /**
     * A string identifying the message route.
     * This string should be unique among all endpoints used in a given game.
     */
    route: string;
    /**
     * Whether or not a response message is expected.
     * - If a response is expected, a warning will be emitted if a sender
     *   calls `forget()` on the request, or if a receiver provides
     *   an undefined response (in which case no return message is sent).
     */
    responseRequired: boolean;
    /**
     * The suggested total lifetime of the response, after which
     * the request is automatically rejected with a timeout error.
     * Defaults to 30 seconds.
     */
    suggestedTotalLifetimeMs?: number;
    /**
     * The suggested retry interval of the response - the message will be
     * resent as needed. 
     * - If the number is infinity (the default), no retries will be sent.
     * - If the number is 0 or less, the message will be retried as often
     *   as possible.
     */
    suggestedRetryIntervalMs?: number;
}