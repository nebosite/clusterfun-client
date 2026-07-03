import { ClusterFunMessageHeader } from "./ClusterFunMessageHeader";
import { ClusterFunRoutingHeader } from "./ClusterFunRoutingHeader";
import { parseMessage, parseHeaderOnly, stringifyMessage } from "./messageParsing";

// Every message on the wire is `{header}^{routing}^{payload}`. The relay reads
// only the header; the client relies on this exact encoding round-tripping.

const header: ClusterFunMessageHeader = { r: "receiver-id", s: "sender-id", id: "42" };
const routing: ClusterFunRoutingHeader = {
  requestId: "42",
  route: "/games/test/action",
  role: "request",
};

describe("messageParsing", () => {
  it("round-trips header, routing, and payload", () => {
    const payload = { hello: "world", nested: { count: 3 }, list: [1, 2, 3] };
    const wire = stringifyMessage(header, routing, payload);
    const parsed = parseMessage(wire);

    expect(parsed.header).toEqual(header);
    expect(parsed.routing).toEqual(routing);
    expect(parsed.payload).toEqual(payload);
  });

  it("parses just the header when that is all that is needed", () => {
    const wire = stringifyMessage(header, routing, { anything: true });
    expect(parseHeaderOnly(wire)).toEqual(header);
  });

  it("treats an undefined payload as undefined after a round-trip", () => {
    const wire = stringifyMessage(header, routing, undefined);
    expect(parseMessage(wire).payload).toBeUndefined();
  });

  it("preserves a payload that is a plain string", () => {
    const wire = stringifyMessage(header, routing, "just a string");
    expect(parseMessage(wire).payload).toBe("just a string");
  });

  it("throws on a message that is not properly formatted", () => {
    expect(() => parseMessage("this is not a message")).toThrow(SyntaxError);
  });

  it("throws when parsing a header out of malformed data", () => {
    expect(() => parseHeaderOnly("no-caret-here")).toThrow(SyntaxError);
  });
});
