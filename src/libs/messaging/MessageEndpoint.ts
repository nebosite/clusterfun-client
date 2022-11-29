/**
 * A reference object that assists users in setting up endpoints.
 * Each game should declare a module containing the endpoints
 * they want to support.
 */
export default interface MessageEndpoint<REQUEST, RESPONSE> {
    route: string;
    responseRequired: boolean;
}