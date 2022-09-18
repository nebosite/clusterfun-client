/**
 * Represents the portion of the ClusterFun message that the server understands
 */
export default interface ClusterFunMessageHeader {
    /**
     * The message's type, used to inform the recipient which constructor
     * to use to deserialize the data
     */
    t: string
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
    id?: string | number
}