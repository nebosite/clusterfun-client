/**
 * Represents the portion of the ClusterFun message that the server understands
 */
export interface ClusterFunMessageHeader {
    /**
     * The receiver of the message - either a player ID
     * or "@everyone" to mean everyone but the sender
     */
    r: string,
    /**
     * The original sender of the message
     */
    s: string,
    /**
     * A unique ID attached the message
     */
    id?: string
}