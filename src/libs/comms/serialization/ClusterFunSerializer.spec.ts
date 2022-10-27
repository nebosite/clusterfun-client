import { expect } from "chai";
import { ClusterFunMessageBase } from "../ClusterFunMessage";
import { ClusterFunMessageHeader } from "../message_parts/ClusterFunMessageHeader";
import { ClusterFunSerializer } from "./ClusterFunSerializer";

/**
 * A test receiver ID - 12 characters to match the IDs we generate
 */
const TEST_RECEIVER_ID = "test-rcvr-id";
/**
 * A test sender ID - 12 characters to match the IDs we generate
 */
const TEST_SENDER_ID = "test-sndr-id";
/**
 * A test message ID - as long as a GUID
 */
const TEST_MESSAGE_ID = 1234567890;

describe("ClusterFunSerializer", function () {
    // Test serializable types
    class SimpleTestType extends ClusterFunMessageBase {
        static readonly messageTypeName = "simple";
    }

    class ConflictingSimpleTestType extends ClusterFunMessageBase {
        static readonly messageTypeName = SimpleTestType.messageTypeName;
    }

    class DifferentlyNamedSimpleTestType extends ClusterFunMessageBase {
        static readonly messageTypeName = "differently-named";
    }

    class TestTypeWithData extends ClusterFunMessageBase {
        static readonly messageTypeName = "has-data";

        readonly a: number;
        readonly b: string;

        constructor(payload: TestTypeWithData) {
            super(payload);
            this.a = payload.a;
            this.b = payload.b;
        }
    }

    describe("Basic tests", function () {
        it("Doesn't summon Cuthulu", function () {
            const _serializer = new ClusterFunSerializer();
            expect(_serializer).to.not.be.null;
        });
    })

    describe("Registration tests", function () {
        it("Allows registration and fetching of constructor", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const c = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c).to.equal(SimpleTestType);
        })
    
        it("Allows multiple registrations under different names", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
            serializer.register(DifferentlyNamedSimpleTestType);
    
            const c1 = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c1).to.equal(SimpleTestType);
            const c2 = serializer.fetchConstructor(DifferentlyNamedSimpleTestType.messageTypeName);
            expect(c2).to.equal(DifferentlyNamedSimpleTestType);
        })
    
        it("Allows deregistration", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const c = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c).to.equal(SimpleTestType);
    
            serializer.unregister(SimpleTestType);
    
            expect(() => serializer.fetchConstructor(SimpleTestType.messageTypeName)).throws();
        })
    
        it("Allows deregistration by name", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const c = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c).to.equal(SimpleTestType);
    
            serializer.unregisterName(SimpleTestType.messageTypeName);
    
            expect(() => serializer.fetchConstructor(SimpleTestType.messageTypeName)).throws();
        })
    
        it("Makes registration of the same constructor idempotent", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
            serializer.register(SimpleTestType);
    
            const c = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c).to.equal(SimpleTestType);
    
            serializer.unregister(SimpleTestType);
    
            expect(() => serializer.fetchConstructor(SimpleTestType.messageTypeName)).throws();
        })
    
        it("Makes deregistration of the same constructor idempotent", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const c = serializer.fetchConstructor(SimpleTestType.messageTypeName);
            expect(c).to.equal(SimpleTestType);
    
            serializer.unregister(SimpleTestType);
            serializer.unregister(SimpleTestType);
    
            expect(() => serializer.fetchConstructor(SimpleTestType.messageTypeName)).throws();
        })
    
        it("Throws when registering a different constructor to the same name", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
            expect(() => serializer.register(ConflictingSimpleTestType)).throws();
        })
    
        it("Throws when deregistering a different constructor from the same name", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
            expect(() => serializer.unregister(ConflictingSimpleTestType)).throws();
        })
    })

    describe("Serialization tests", function () {
        it("Performs simple serialization and deserialization", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const inputMessage = new SimpleTestType({ sender: TEST_SENDER_ID, messageId: TEST_MESSAGE_ID });
    
            const serializedString = serializer.serialize(TEST_RECEIVER_ID, TEST_SENDER_ID, inputMessage);
            const deserializedMessage = serializer.deserialize(serializedString);
    
            expect(inputMessage).to.deep.equal(deserializedMessage);
        })
    
        it("Performs serialization and deserialization with data", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(TestTypeWithData);
    
            const inputMessage = new TestTypeWithData({ sender: TEST_SENDER_ID, messageId: TEST_MESSAGE_ID, a: 10, b: "20" });
    
            const serializedString = serializer.serialize(TEST_RECEIVER_ID, TEST_SENDER_ID, inputMessage);
            const deserializedMessage = serializer.deserialize(serializedString);
    
            expect(inputMessage).to.deep.equal(deserializedMessage);
        })
    
        it("Does not read past the header delimiter if only deserializing the header", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const header: ClusterFunMessageHeader = {
                t: SimpleTestType.messageTypeName,
                r: TEST_RECEIVER_ID,
                s: TEST_SENDER_ID,
                id: TEST_MESSAGE_ID
            };
            const serializedString = JSON.stringify(header) + "^{abject gibberish";
            const deserializedHeader = serializer.deserializeHeaderOnly(serializedString);
    
            expect(deserializedHeader).to.deep.equal(header);
        })
    
        it("Throws when serializing too long of a header", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            let veryLongRecipientId = "";
            for (let i = 0; i < 1024; i++) {
                veryLongRecipientId += "a";
            }
    
            const inputMessage = new SimpleTestType({ sender: TEST_SENDER_ID, messageId: TEST_MESSAGE_ID });
            expect(() => serializer.serialize(veryLongRecipientId, TEST_SENDER_ID, inputMessage)).throws(/Header too long/);
        })
    
        it("Throws on no header", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const malformedString = "";
    
            expect(() => serializer.deserialize(malformedString)).throws(/Could not find header split/);
        })
    
        it("Throws on malformed header", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const malformedString = "{ \"message\": \"This is totally not a valid header\" }^{}";
    
            expect(() => serializer.deserialize(malformedString)).throws(/Message header missing/);
        })
    
        it("Throws on malformed payload when reading full message", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const header: ClusterFunMessageHeader = {
                t: SimpleTestType.messageTypeName,
                r: TEST_RECEIVER_ID,
                s: TEST_SENDER_ID,
                id: TEST_MESSAGE_ID
            };
            const serializedString = JSON.stringify(header) + "^{";
    
            expect(() => serializer.deserialize(serializedString)).throws(/Unexpected end of JSON input/);
        })
    
        it("Throws on too many parts", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const inputMessage = new SimpleTestType({ sender: TEST_SENDER_ID, messageId: TEST_MESSAGE_ID });
    
            const serializedString = serializer.serialize(TEST_RECEIVER_ID, TEST_SENDER_ID, inputMessage) + "^{ \"message\": \"I am an extra part\" }";
            expect(() => serializer.deserialize(serializedString)).throws(/Unexpected token/);
        })
    })

    describe("Registration + serialization tests", function () {
        it("Throws on unrecognized message type name", function () {
            const serializer = new ClusterFunSerializer();
            serializer.register(SimpleTestType);
    
            const inputMessage = new DifferentlyNamedSimpleTestType({ sender: TEST_SENDER_ID, messageId: TEST_MESSAGE_ID });
    
            const serializedString = serializer.serialize(TEST_RECEIVER_ID, TEST_SENDER_ID, inputMessage);
            expect(() => serializer.deserialize(serializedString)).throws(/No constructor registered for/);
        })
    })
})
