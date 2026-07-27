import ClusterfunRequest from "./ClusterfunRequest";
import { IMessageThing } from "./MessageThing";
import { stringifyMessage } from "libs/comms";
import MessageEndpoint from "./MessageEndpoint";

// A minimal message thing that records sends and lets tests deliver
// responses/errors to the request's listener.
class StubMessageThing implements IMessageThing {
  personalId = "me";
  personalSecret = "secret";
  isOpen = true;
  isClosed = false;
  closeCode = 0;
  sent: string[] = [];
  private handlers: ((event?: any) => void)[] = [];

  addEventListener(eventName: string, handler: (event?: any) => void) {
    if (eventName === "message") this.handlers.push(handler);
  }
  removeEventListener(eventName: string, handler: (event?: any) => void) {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }
  send(payload: string, onFailure: () => void): Promise<void> {
    this.sent.push(payload);
    return Promise.resolve();
  }

  deliver(role: "response" | "error", route: string, requestId: string, payload: any) {
    const data = stringifyMessage(
      { r: "me", s: "them", id: `${requestId}-reply` },
      { requestId, route, role },
      payload,
    );
    this.handlers.forEach((h) => h({ data }));
  }
}

const TestEndpoint: MessageEndpoint<{ ask: string }, { answer: string }> = {
  route: "/test/request",
  suggestedRetryIntervalMs: 100000,
  suggestedTotalLifetimeMs: 200000,
};

const makeRequest = (thing: StubMessageThing) =>
  new ClusterfunRequest(TestEndpoint, { ask: "hi" }, "me", "them", "req1", thing);

describe("ClusterfunRequest promise semantics", () => {
  it("resolves through then when a response arrives", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    const promise = request.then((r) => r.answer);
    thing.deliver("response", TestEndpoint.route, "req1", { answer: "yo" });
    await expect(promise).resolves.toBe("yo");
  });

  it("resolves through then when already settled", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    thing.deliver("response", TestEndpoint.route, "req1", { answer: "yo" });
    await expect(request.then((r) => r.answer)).resolves.toBe("yo");
  });

  it("a rejection handler RECOVERS the derived promise (catch semantics)", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    const promise = request.then(undefined, (err) => "recovered");
    thing.deliver("error", TestEndpoint.route, "req1", "boom");
    await expect(promise).resolves.toBe("recovered");
  });

  it("a rejection handler returning nothing resolves undefined (no unhandled rejection)", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    const promise = request.then(undefined, (err) => {
      // handler that just logs and returns nothing - the common call-site shape
    });
    thing.deliver("error", TestEndpoint.route, "req1", "boom");
    await expect(promise).resolves.toBeUndefined();
  });

  it("a missing rejection handler propagates the error", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    const promise = request.then((r) => r.answer);
    thing.deliver("error", TestEndpoint.route, "req1", "boom");
    await expect(promise).rejects.toThrow("boom");
  });

  it("propagates errors from an already-rejected request", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    thing.deliver("error", TestEndpoint.route, "req1", "boom");
    await expect(request.then((r) => r.answer)).rejects.toThrow("boom");
  });

  it("recovers from an already-rejected request via handler", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    thing.deliver("error", TestEndpoint.route, "req1", "boom");
    await expect(request.then(undefined, () => "late recovery")).resolves.toBe("late recovery");
  });

  it("a throwing fulfillment handler rejects the derived promise", async () => {
    const thing = new StubMessageThing();
    const request = makeRequest(thing);
    const promise = request.then(() => {
      throw new Error("handler blew up");
    });
    thing.deliver("response", TestEndpoint.route, "req1", { answer: "yo" });
    await expect(promise).rejects.toThrow("handler blew up");
  });
});
