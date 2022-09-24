import ClusterFunMessageHeader from "../message_parts/ClusterFunMessageHeader";
import { ClusterFunMessageConstructor } from "./ClusterFunMessageConstructor";
import { ClusterFunMessageBase } from "../ClusterFunMessage";
/**
 * Handles serialization and deserialization for ClusterFun messages.
 */
export class ClusterFunSerializer {
    private typeRegistry;
    constructor();
    /**
     * Register a new constructor for serialized messages
     * @param c The ClusterFunSerializableType constructor to register
     * @throws Error if a different constructor is already registered to the same messageTypeName
     */
    register<MTN extends string, P, M extends ClusterFunMessageBase>(c: ClusterFunMessageConstructor<P, M> & {
        messageTypeName: MTN;
    }): void;
    /**
     * Unregister a previously registered constructor
     * @param c The constructor to unregister
     * @throws Error if a different constructor is registered to that same name - use unregisterName() if that is acceptable
     */
    unregister<MTN extends string, P, M extends ClusterFunMessageBase>(c: ClusterFunMessageConstructor<P, M> & {
        messageTypeName: MTN;
    }): void;
    /**
     * Unregister all constructors with the given messageTypeName
     * @param messageTypeName The name to unregister
     */
    unregisterName(messageTypeName: string): void;
    /**
     * Serialize the given message into a raw string, ready to send to the relay server
     * @param message The message to serialize
     * @returns A JSON stream string representing the message
     */
    serialize<P extends M, M extends ClusterFunMessageBase>(receiver: string, sender: string, message: M): string;
    /**
     * Deserialize the given message string
     * @param input The message to deserialize
     * @returns A new ClusterFunSerializableType representing the message
     * @throws SyntaxError if the message format is invalid
     * Error if the message does not have a registered type
     */
    deserialize<_P, M extends ClusterFunMessageBase>(input: string): M;
    validationWarningCount: number;
    /**
     * Deserialize the given message string, assuming that the payload is valid.
     * Only do this if you trust the original client sending the message
     * or are willing to accept the consequences of a malformed message.
     * @param input The message to deserialize
     * @returns A new ClusterFunSerializableType representing the message
     * @throws SyntaxError if the message format is invalid
     * Error if the message does not have a registered type
     */
    deserializeAssumingValidPayload<P, M extends ClusterFunMessageBase>(input: string): M;
    /**
     * Deserialize only the header of the given message string, ignoring the payload.
     * @param input The message to deserialize
     * @returns The ClusterFunMessageHeader of the message
     */
    deserializeHeaderOnly(input: string): ClusterFunMessageHeader;
    /**
     * Fetch the constructor registered to the given messageTypeName
     * @param messageTypeName The name to get the constructor for
     * @returns The registered constructor
     */
    fetchConstructor<MTN extends string>(messageTypeName: MTN): ClusterFunMessageConstructor<unknown, ClusterFunMessageBase>;
    private serializeParts;
    private deserializeParts;
    private deserializePartsInternal;
}
