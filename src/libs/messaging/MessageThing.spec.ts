import { LocalMessageThing } from "./MessageThing";

// LocalMessageThing is the in-memory transport that lets the Test Lobby run a
// presenter + clients on one page with no server. It routes a message to the
// recipient named in the message header, simulating a little network latency.

// Wire format the transport understands: {header}^payload, where the header's
// `s` is the sender and `r` is the recipient.
function wire(sender: string, receiver: string, payload = "hi") {
  return `${JSON.stringify({ t: "test", s: sender, r: receiver })}^${payload}`;
}

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("LocalMessageThing", () => {
  it("delivers a message to the recipient's 'message' listeners", async () => {
    const room = new Map<string, LocalMessageThing>();
    const alice = new LocalMessageThing(room, "A", 1, 3);
    const bob = new LocalMessageThing(room, "B", 1, 3);

    const received: string[] = [];
    bob.addEventListener("message", (ev) => received.push(ev.data));

    await alice.send(wire("A", "B", "hello-bob"), () => {});
    await waitMs(20); // let the simulated receive delay fire

    expect(received).toEqual([wire("A", "B", "hello-bob")]);
  });

  it("does not deliver to the sender", async () => {
    const room = new Map<string, LocalMessageThing>();
    const alice = new LocalMessageThing(room, "A", 1, 3);
    new LocalMessageThing(room, "B", 1, 3);

    const aliceReceived: string[] = [];
    alice.addEventListener("message", (ev) => aliceReceived.push(ev.data));

    await alice.send(wire("A", "B"), () => {});
    await waitMs(20);

    expect(aliceReceived).toEqual([]);
  });

  it("rejects when the header's sender does not match the sender's id", async () => {
    const room = new Map<string, LocalMessageThing>();
    const alice = new LocalMessageThing(room, "A", 1, 3);
    new LocalMessageThing(room, "B", 1, 3);

    await expect(alice.send(wire("B", "B"), () => {})).rejects.toThrow(SyntaxError);
  });

  it("rejects when the recipient is not in the room", async () => {
    const room = new Map<string, LocalMessageThing>();
    const alice = new LocalMessageThing(room, "A", 1, 3);

    await expect(alice.send(wire("A", "GHOST"), () => {})).rejects.toMatch(/No recipient/);
  });

  it("stops delivering after a listener is removed", async () => {
    const room = new Map<string, LocalMessageThing>();
    const alice = new LocalMessageThing(room, "A", 1, 3);
    const bob = new LocalMessageThing(room, "B", 1, 3);

    const received: string[] = [];
    const handler = (ev: any) => received.push(ev.data);
    bob.addEventListener("message", handler);
    bob.removeEventListener("message", handler);

    await alice.send(wire("A", "B"), () => {});
    await waitMs(20);

    expect(received).toEqual([]);
  });
});
