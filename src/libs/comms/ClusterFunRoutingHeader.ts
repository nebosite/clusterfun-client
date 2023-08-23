/**
 * A secondary header for identifying a message to the internal routing system.
 * This header is not read by the relay server.
 */
export interface ClusterFunRoutingHeader {
    requestId: string;
    route: string;
    role: "message" | "request" | "response" | "error";
}