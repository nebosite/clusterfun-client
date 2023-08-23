/**
 * A reference object that assists users in setting up request/response endpoints.
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
     * The suggested total lifetime of the request, after which
     * the request is automatically rejected with a timeout error.
     * Defaults to 30 seconds.
     */
    suggestedTotalLifetimeMs?: number;
    /**
     * The suggested retry interval of the request - the message will be
     * resent as needed. 
     * - If the number is infinity (the default), no retries will be sent.
     * - If the number is 0 or less, the message will be retried as often
     *   as possible.
     */
    suggestedRetryIntervalMs?: number;
}