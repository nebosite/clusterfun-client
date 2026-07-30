import { ActionRepeater } from "./ActionRepeater";
import {
  actionForCode,
  codesForAction,
  describeCode,
  repeatsWhileHeld,
  InputBindings,
  PAD_BUTTON,
} from "./InputActions";
import { axisPushed, isTypingTarget } from "./GameInputController";

// Hold-to-repeat is pure game FEEL, which is exactly the kind of thing that
// gets broken by accident and noticed only by playing.  Driving it with an
// explicit clock means the cadence is pinned instead of eyeballed.

const settings = { actions: ["moveLeft", "moveRight"], delayMs: 170, intervalMs: 50 };

describe("ActionRepeater", () => {
  it("fires once on press and reports the action as held", () => {
    const r = new ActionRepeater(settings);
    expect(r.press("moveLeft")).toBe(true);
    expect(r.isHeld("moveLeft")).toBe(true);
  });

  it("ignores a repeated press of an already-held action", () => {
    // The OS sends its own auto-repeat keydowns; ours must not double up.
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    expect(r.press("moveLeft")).toBe(false);
  });

  it("waits out the delay before the first repeat", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    expect(r.tick(169)).toEqual([]); // still inside the delay
    expect(r.tick(1)).toEqual(["moveLeft"]); // 170ms: the first repeat
  });

  it("then repeats on the interval", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    r.tick(170);
    expect(r.tick(49)).toEqual([]);
    expect(r.tick(1)).toEqual(["moveLeft"]);
    expect(r.tick(50)).toEqual(["moveLeft"]);
  });

  it("catches up rather than swallowing movement when a frame runs long", () => {
    // A stutter should not silently lose input - the piece still travels.
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    const fired = r.tick(170 + 50 * 3);
    expect(fired.length).toBe(4); // the first repeat plus three intervals
    expect(new Set(fired)).toEqual(new Set(["moveLeft"]));
  });

  it("never repeats an action the game did not ask to repeat", () => {
    // Leaning on rotate must not spin the piece like a top.
    const r = new ActionRepeater(settings);
    r.press("rotateCW");
    expect(r.tick(5000)).toEqual([]);
    expect(r.isHeld("rotateCW")).toBe(true);
  });

  it("stops repeating once released", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    r.tick(200);
    r.release("moveLeft");
    expect(r.tick(500)).toEqual([]);
    expect(r.isHeld("moveLeft")).toBe(false);
  });

  it("repeats two held actions independently", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    r.tick(100);
    r.press("moveRight");
    const fired = r.tick(100); // left is past its delay, right is not
    expect(fired).toEqual(["moveLeft"]);
  });

  it("releaseAll drops everything - what a focus loss needs", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    r.press("moveRight");
    r.releaseAll();
    expect(r.heldActions).toEqual([]);
    expect(r.tick(1000)).toEqual([]);
  });

  it("does not bank repeats across a zero-length frame", () => {
    const r = new ActionRepeater(settings);
    r.press("moveLeft");
    expect(r.tick(0)).toEqual([]);
    expect(r.tick(0)).toEqual([]);
  });

  it("works with no repeat settings at all", () => {
    const r = new ActionRepeater();
    expect(r.press("moveLeft")).toBe(true);
    expect(r.tick(9999)).toEqual([]);
  });
});

// -------------------------------------------------------------------
// Binding lookups
// -------------------------------------------------------------------
const bindings: InputBindings = {
  keys: [
    { action: "moveLeft", codes: ["ArrowLeft", "KeyA", "KeyJ", "Numpad4"] },
    { action: "rotateCW", codes: ["ArrowUp", "KeyW"] },
  ],
  pad: [
    { action: "moveLeft", buttons: [PAD_BUTTON.DPadLeft], axes: [{ index: 0, direction: -1 }] },
  ],
  repeat: settings,
};

describe("binding lookups", () => {
  it("maps every key in a group to its action", () => {
    for (const code of ["ArrowLeft", "KeyA", "KeyJ", "Numpad4"]) {
      expect(actionForCode(bindings, code)).toBe("moveLeft");
    }
    expect(actionForCode(bindings, "KeyW")).toBe("rotateCW");
  });

  it("returns null for an unbound key rather than guessing", () => {
    expect(actionForCode(bindings, "KeyZ")).toBeNull();
  });

  it("lists an action's keys, for showing the player their controls", () => {
    expect(codesForAction(bindings, "moveLeft")).toEqual(["ArrowLeft", "KeyA", "KeyJ", "Numpad4"]);
  });

  it("knows which actions repeat", () => {
    expect(repeatsWhileHeld(bindings, "moveLeft")).toBe(true);
    expect(repeatsWhileHeld(bindings, "rotateCW")).toBe(false);
  });

  it("describes keys the way a player would recognise them", () => {
    expect(describeCode("ArrowLeft")).toBe("←");
    expect(describeCode("KeyA")).toBe("A");
    expect(describeCode("Numpad4")).toBe("Num 4");
    expect(describeCode("Space")).toBe("Space");
    expect(describeCode("Digit3")).toBe("3");
  });
});

describe("axisPushed", () => {
  it("ignores a stick resting or merely drifting", () => {
    expect(axisPushed(0, -1)).toBe(false);
    expect(axisPushed(-0.2, -1)).toBe(false); // drift, not intent
    expect(axisPushed(undefined, -1)).toBe(false);
  });

  it("registers a real push, in the right direction only", () => {
    expect(axisPushed(-0.8, -1)).toBe(true);
    expect(axisPushed(0.8, 1)).toBe(true);
    expect(axisPushed(-0.8, 1)).toBe(false);
    expect(axisPushed(0.8, -1)).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("keeps out of the way of text fields", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
  });

  it("lets game keys through everywhere else", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
