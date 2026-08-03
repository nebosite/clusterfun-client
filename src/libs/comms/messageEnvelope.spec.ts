import { parseEnvelope, parsePayload, parseMessage, stringifyMessage } from "./messageParsing";

// ==========================================================================================
// Route first, payload second.
//
// Every listener and every in-flight request attaches its own "message" handler to the same
// socket, so each of them sees each message.  They used to run a full parse - JSON.parse over
// the whole payload - and only THEN check the route to find out the message was for somebody
// else.  A PartyPix presenter with ten listeners parsed a 133KB photo upload ten times.
// ==========================================================================================

const header = { s: "sender", r: "receiver", id: "msg-1" };
const routing = { route: "/games/test/thing", role: "message" as const, requestId: "req-1" };

describe("parseEnvelope", () => {
  it("reads the header and routing without touching the payload", () => {
    const data = stringifyMessage(header, routing, { hello: "world" });
    const envelope = parseEnvelope(data);

    expect(envelope.header.s).toBe("sender");
    expect(envelope.routing.route).toBe("/games/test/thing");
    // The payload comes back as TEXT - not parsed, which is the entire point.
    expect(typeof envelope.payloadText).toBe("string");
    expect(envelope.payloadText).toBe('{"hello":"world"}');
  });

  it("agrees with parseMessage once the payload is read", () => {
    const payload = { a: 1, b: [2, 3], c: { d: "four" } };
    const data = stringifyMessage(header, routing, payload);

    const whole = parseMessage(data);
    const envelope = parseEnvelope(data);

    expect(envelope.header).toEqual(whole.header);
    expect(envelope.routing).toEqual(whole.routing);
    expect(parsePayload(envelope.payloadText)).toEqual(whole.payload);
  });

  it("rejects a malformed message the same way parseMessage does", () => {
    expect(() => parseEnvelope("not a message")).toThrow(SyntaxError);
  });

  it("does not choke on a payload containing a caret", () => {
    const data = stringifyMessage(header, routing, { text: "a^b^c" });
    expect(parsePayload(parseEnvelope(data).payloadText)).toEqual({ text: "a^b^c" });
  });
});

describe("parsePayload", () => {
  it("treats an empty payload as undefined", () => {
    expect(parsePayload("")).toBeUndefined();
    expect(parsePayload("undefined")).toBeUndefined();
  });

  it("round-trips the shapes games actually send", () => {
    for (const value of [null, 0, "", false, [], {}, { nested: { deep: [1, 2] } }]) {
      expect(parsePayload(JSON.stringify(value))).toEqual(value);
    }
  });
});

describe("the cost of a message that is not ours", () => {
  it("is a fraction of parsing it", () => {
    // A PartyPix-sized upload: a ~130KB base64 string.
    const big = { full: "d".repeat(130 * 1024) };
    const data = stringifyMessage(header, { ...routing, route: "/somebody/elses/route" }, big);

    const REPS = 40;

    const wholeStart = performance.now();
    for (let i = 0; i < REPS; i++) parseMessage(data);
    const wholeMs = performance.now() - wholeStart;

    const envelopeStart = performance.now();
    for (let i = 0; i < REPS; i++) parseEnvelope(data);
    const envelopeMs = performance.now() - envelopeStart;

    // Deliberately a loose bound.  The point is the shape of the difference,
    // not a number that will make this test flaky on a busy machine.
    expect(envelopeMs).toBeLessThan(wholeMs);
    // eslint-disable-next-line no-console
    console.log(
      `discarding a 130KB message x${REPS}: full parse ${wholeMs.toFixed(1)}ms, ` +
        `envelope only ${envelopeMs.toFixed(1)}ms`,
    );
  });
});
