import ClusterFunMessageHeader from "../message_parts/ClusterFunMessageHeader";
import { ClusterFunMessageConstructor } from "./ClusterFunMessageConstructor";
import { RawMessagePacket } from "../message_parts/RawMessagePacket";
import { JSONParser } from '@streamparser/json';


import { ClusterFunMessageBase } from "../ClusterFunMessage";

/**
 * The maximum length in characters for the header. Larger headers allow longer type names
 * but place more burden on the relay server.
 */
const MAX_HEADER_LENGTH = 128;

/**
 * An interface describing a registry for ClusterFunSerializableConstructor_s.
 * A JavaScript Map() will fulfill this interface as long as it is not accessed
 * outside of it.
 */
interface TypeRegistry {
    has<MTN extends string>(messageTypeName: MTN
        ): boolean;
    get<MTN extends string>(messageTypeName: MTN
        ): (ClusterFunMessageConstructor<unknown, ClusterFunMessageBase> & { messageTypeName: MTN }) | undefined;
    set<MTN extends string, P extends unknown>(
        messageTypeName: MTN, 
        c: (ClusterFunMessageConstructor<P, ClusterFunMessageBase> & { messageTypeName: MTN })
        ): void;
    delete<MTN extends string>(messageTypeName: MTN
        ): boolean;
}

/**
 * Handles serialization and deserialization for ClusterFun messages.
 */
export default class ClusterFunSerializer {
    private typeRegistry: TypeRegistry;

    constructor() {
        this.typeRegistry = new Map() as TypeRegistry;
    }

    /**
     * Register a new constructor for serialized messages
     * @param c The ClusterFunSerializableType constructor to register
     * @throws Error if a different constructor is already registered to the same messageTypeName
     */
    register<MTN extends string,
        P,
        M extends ClusterFunMessageBase
        >(
             c: ClusterFunMessageConstructor<P,M> & { messageTypeName: MTN }
        ): void {
        if (this.typeRegistry.has(c.messageTypeName)) {
            const existingConstructor = this.typeRegistry.get(c.messageTypeName)! as unknown;
            if (c === existingConstructor) {
                // we've already set it, so register is idempotent
                return;
            } else {
                throw new Error("Attempted to replace existing constructor with name " + c.messageTypeName 
                    + " with different constructor");
            }
        }
        this.typeRegistry.set(c.messageTypeName, c);
    }

    /**
     * Unregister a previously registered constructor
     * @param c The constructor to unregister
     * @throws Error if a different constructor is registered to that same name - use unregisterName() if that is acceptable
     */
    unregister<
        MTN extends string,
        P,
        M extends ClusterFunMessageBase
        >(
            c: ClusterFunMessageConstructor<P,M> & { messageTypeName: MTN }
        ): void {
        if (this.typeRegistry.has(c.messageTypeName)) {
            const existingConstructor = this.typeRegistry.get(c.messageTypeName)! as unknown;
            if (c === existingConstructor) {
                // go ahead and remove it
                this.typeRegistry.delete(c.messageTypeName);
            } else {
                throw new Error("Attempted to delete registry for " + c.messageTypeName 
                    + " using different constructor - call unregisterName() if this is acceptable");
            }
        }
    }

    /**
     * Unregister all constructors with the given messageTypeName
     * @param messageTypeName The name to unregister
     */
    unregisterName(messageTypeName: string) {
        this.typeRegistry.delete(messageTypeName);
    }

    /**
     * Serialize the given message into a raw string, ready to send to the relay server
     * @param message The message to serialize
     * @returns A JSON stream string representing the message
     */
    serialize<P extends M, M extends ClusterFunMessageBase>(receiver: string, sender: string, message: M): string {
        return this.serializeParts({
            header: {
                r: receiver,
                s: sender,
                t: ((message.constructor) as ClusterFunMessageConstructor<P, M>).messageTypeName,
                id: message.messageId
            },
            payload: message
        });
    }

    /**
     * Deserialize the given message string
     * @param input The message to deserialize
     * @returns A new ClusterFunSerializableType representing the message
     * @throws SyntaxError if the message format is invalid
     * Error if the message does not have a registered type
     */
    deserialize<_P, M extends ClusterFunMessageBase>(input: string): M {
        // TODO: If we want to do React.PropTypes payload validation,
        // this is where it would go
        if(!this.validationWarningCount++) {
            // console.warn("Payload validation has not been implemented");
        }
        return this.deserializeAssumingValidPayload(input);
    }
    validationWarningCount = 0;

    /**
     * Deserialize the given message string, assuming that the payload is valid.
     * Only do this if you trust the original client sending the message
     * or are willing to accept the consequences of a malformed message.
     * @param input The message to deserialize
     * @returns A new ClusterFunSerializableType representing the message
     * @throws SyntaxError if the message format is invalid
     * Error if the message does not have a registered type
     */
    deserializeAssumingValidPayload<P, M extends ClusterFunMessageBase>(input: string): M {
        const parts = this.deserializeParts(input) as RawMessagePacket<P>;
        const messageTypeName = parts.header.t;
        const c = this.fetchConstructor(messageTypeName) as unknown as ClusterFunMessageConstructor<P, M>;
        return new c(parts.payload);
    }

    /**
     * Deserialize only the header of the given message string, ignoring the payload.
     * @param input The message to deserialize
     * @returns The ClusterFunMessageHeader of the message
     */
    deserializeHeaderOnly(input: string): ClusterFunMessageHeader {
        return this.deserializePartsInternal(input.substring(0, MAX_HEADER_LENGTH), false).header;
    }

    /**
     * Fetch the constructor registered to the given messageTypeName
     * @param messageTypeName The name to get the constructor for
     * @returns The registered constructor
     */
    fetchConstructor<MTN extends string>(messageTypeName: MTN): ClusterFunMessageConstructor<unknown, ClusterFunMessageBase> {
        if (!this.typeRegistry.has(messageTypeName)) {
            throw new Error("No constructor registered for " + messageTypeName);
        }
        return this.typeRegistry.get(messageTypeName)!;
    }

    private serializeParts<P>(input: RawMessagePacket<P>): string {
        const headerString = JSON.stringify(input.header);
        if (headerString.length > MAX_HEADER_LENGTH) {
            throw new SyntaxError(`Header too long: actual length ${headerString.length}, expected maximum ${MAX_HEADER_LENGTH}`);
        }
        const payloadString = JSON.stringify(input.payload);
        return headerString + payloadString;
    }

    private deserializeParts(input: string): RawMessagePacket<unknown> {
        return this.deserializePartsInternal(input, true);
    }

    private deserializePartsInternal(input: string, includePayload: boolean): RawMessagePacket<unknown>{
        // Use @streamparser/json to parse our concatenated JSON message.

        // The library is stream/calllback oriented, accepting data in chunks
        // and allowing multiple intermediate values to be returned,
        // but is not asynchronous. As such, we can use it synchronously here
        // to return both raw message parts.

        const parser = new JSONParser({ stringBufferSize: undefined, separator: "", paths: ['$'] });
        let header: ClusterFunMessageHeader | undefined;
        let payload: unknown | undefined = undefined;

        parser.onValue = (value: any) => {
            if (header === undefined) header = value;
            else if (payload === undefined) payload = value;
            else throw new Error("Too many parts encountered");
        }

        try {
            parser.write(input);
        } catch (e) {
            // Ignore parser errors - these come up when we provide partial strings for
            // header-only deserialization. Our inability to get the header and payload
            // should catch these later.
            if (!(e instanceof Error) || !(e.message.match(/Unexpected "." at position/))) {
                throw e;
            }
        }

        if (!header) {
            throw new SyntaxError("Header not provided, or header too long");
        } else {
            if (!("r" in header)
                || !("s" in header)
                || !("t" in header)) {
                    throw new SyntaxError("Header not specified correctly")
                }
        }
        if (!includePayload) {
            payload = null;
        }
        if (payload === undefined) {
            throw new SyntaxError("Payload not provided");
        }
        return {
            header,
            payload
        }
    }
}