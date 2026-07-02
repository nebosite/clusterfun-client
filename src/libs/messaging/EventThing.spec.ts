import { EventThing } from "./EventThing";

// EventThing is the tiny pub/sub used throughout the game models (ticks,
// state-change notifications). Subscribers are keyed by name.

describe("EventThing", () => {

    it("invokes a subscriber with the published value", () => {
        const event = new EventThing<number>("test");
        let received: number | undefined;
        event.subscribe("a", (v) => { received = v; });
        event.invoke(7);
        expect(received).toBe(7);
    });

    it("invokes every subscriber", () => {
        const event = new EventThing<string>("test");
        const seen: string[] = [];
        event.subscribe("a", (v) => seen.push("a:" + v));
        event.subscribe("b", (v) => seen.push("b:" + v));
        event.invoke("go");
        expect(seen).toEqual(["a:go", "b:go"]);
    });

    it("stops notifying an unsubscribed listener", () => {
        const event = new EventThing<number>("test");
        let count = 0;
        event.subscribe("a", () => { count++; });
        event.invoke(1);
        event.unsubscribe("a");
        event.invoke(2);
        expect(count).toBe(1);
    });

    it("replaces a subscriber that reuses an existing name", () => {
        const event = new EventThing<number>("test");
        let first = 0;
        let second = 0;
        event.subscribe("same", () => { first++; });
        event.subscribe("same", () => { second++; });
        event.invoke(1);
        expect(first).toBe(0);
        expect(second).toBe(1);
    });

    it("passes multiple arguments through to subscribers", () => {
        const event = new EventThing<number>("test");
        let args: number[] = [];
        event.subscribe("a", ((...values: number[]) => { args = values; }) as any);
        event.invoke(1, 2, 3);
        expect(args).toEqual([1, 2, 3]);
    });
});
