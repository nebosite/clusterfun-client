import { GestureTracker } from "./Client";
import { EittrisClientModel } from "../models/ClientModel";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../models/eittrisLogic";
import { DRAG_ACTIVATION_PX } from "../models/GameSettings";

// -------------------------------------------------------------------
// The phone's whole control scheme is this class.  It is worth testing directly: a
// misclassified gesture is not a visual glitch, it is the piece going somewhere the player
// did not put it, and that only shows up with a finger on a real screen.
// -------------------------------------------------------------------

const CELL = 40; // on-screen pixels per cell for these tests

function fakeModel() {
  const calls: { name: string; args: any[] }[] = [];
  const model = {
    piece: { type: 0, rot: 0, x: 5, y: 3 },
    pieceSeq: 1,
    dragTo: (column: number, row: number) => calls.push({ name: "dragTo", args: [column, row] }),
    release: () => calls.push({ name: "release", args: [] }),
    hardDrop: () => calls.push({ name: "hardDrop", args: [] }),
    slamLeft: () => calls.push({ name: "slamLeft", args: [] }),
    slamRight: () => calls.push({ name: "slamRight", args: [] }),
    snapTo: (column: number, row: number) => calls.push({ name: "snapTo", args: [column, row] }),
    rotate: () => calls.push({ name: "rotate", args: [] }),
    rotateLeft: () => calls.push({ name: "rotateLeft", args: [] }),
  } as unknown as EittrisClientModel;
  return { model, calls };
}

const rect = { width: BOARD_WIDTH * CELL, height: BOARD_HEIGHT * CELL } as DOMRect;

function pointer(x: number, y: number) {
  return { pointerId: 1, clientX: x, clientY: y, buttons: 1 } as any;
}

/** Drag from (0,0) through the given offsets, one move each. */
function drag(tracker: GestureTracker, offsets: [number, number][]) {
  tracker.down(pointer(200, 200), rect);
  for (const [dx, dy] of offsets) tracker.move(pointer(200 + dx, 200 + dy));
}

/** A flick: far enough and fast enough that `up` treats it as one. */
function flick(tracker: GestureTracker, steps: [number, number][]) {
  tracker.down(pointer(200, 200), rect);
  for (const [dx, dy] of steps) tracker.move(pointer(200 + dx, 200 + dy));
  const [lastX, lastY] = steps[steps.length - 1];
  tracker.up({ pointerId: 1, clientX: 200 + lastX, clientY: 200 + lastY, buttons: 0 } as any);
}

describe("EITtris GestureTracker - a swipe rewinds before it acts", () => {
  // A swipe is one motion to the player.  To the browser it is a drag that happens to be
  // fast, and the drag part of it - a thumb wandering on its way down - must not decide
  // where the piece lands.
  it("follows the finger while the gesture is still just a drag", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [
      [10, 60],
      [-30, 140],
      [32, 220],
    ]);

    const columns = calls.filter((c) => c.name === "dragTo").map((c) => c.args[0]);
    expect(new Set(columns).size).toBeGreaterThan(1); // it really did steer
  });

  it("puts the piece back where the finger went down, then drops it", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    // Down fast, wandering three quarters of a cell each way on the way
    flick(tracker, [
      [10, 60],
      [-30, 140],
      [32, 260],
    ]);

    const names = calls.map((c) => c.name);
    expect(names).toContain("snapTo");
    expect(names.indexOf("snapTo")).toBeLessThan(names.indexOf("hardDrop"));
    const snap = calls.find((c) => c.name === "snapTo")!;
    expect(snap.args).toEqual([5, 3]); // exactly where the piece was at pointer-down
  });

  it("rewinds a sideways flick too", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    flick(tracker, [
      [-40, 10],
      [-120, 26],
    ]);

    const names = calls.map((c) => c.name);
    expect(names.indexOf("snapTo")).toBeLessThan(names.indexOf("slamLeft"));
  });

  it("does not rewind a slow drag - that is a placement, not a swipe", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    tracker.down(pointer(200, 200), rect);
    tracker.move(pointer(230, 260));
    tracker.move(pointer(250, 340));
    // Slower than a flick: pointer-up long after the press began
    const realNow = performance.now;
    performance.now = () => realNow.call(performance) + 5000;
    tracker.up({ pointerId: 1, clientX: 250, clientY: 340, buttons: 0 } as any);
    performance.now = realNow;

    const names = calls.map((c) => c.name);
    expect(names).not.toContain("snapTo");
    expect(names).toContain("release");
  });

  it("sends nothing at all until the finger has actually moved", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [[1, DRAG_ACTIVATION_PX - 3]]);
    expect(calls.length).toBe(0);
  });

  it("has nothing to rewind when the finger never moved the piece", () => {
    // A flick from a standing start sends no drag at all, so there is nothing to undo
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    tracker.down(pointer(200, 200), rect);
    tracker.up({ pointerId: 1, clientX: 200, clientY: 300, buttons: 0 } as any);

    expect(calls.map((c) => c.name)).not.toContain("snapTo");
  });
});

describe("EITtris GestureTracker - a tap turns the piece towards it", () => {
  // The board's left edge is at x=100 in these tests, and the piece sits around column 5.
  const boardRect = {
    width: BOARD_WIDTH * CELL,
    height: BOARD_HEIGHT * CELL,
    left: 100,
  } as DOMRect;

  function tapAt(x: number) {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    tracker.down({ pointerId: 1, clientX: x, clientY: 400, buttons: 1 } as any, boardRect);
    tracker.up({ pointerId: 1, clientX: x, clientY: 400, buttons: 0 } as any);
    return calls.map((c) => c.name);
  }

  it("rotates clockwise when tapped to the right of the piece", () => {
    // A T with its box at x=5 covers columns 5..7, so its middle is at 100 + 6.5 * CELL
    expect(tapAt(100 + 9 * CELL)).toEqual(["rotate"]);
  });

  it("rotates back when tapped to the left of the piece", () => {
    expect(tapAt(100 + 1 * CELL)).toEqual(["rotateLeft"]);
  });

  it("splits at the middle of the piece, not at the corner of its box", () => {
    // The box starts at column 5; the cells run 5..7, so the halfway line is 6.5 cells.
    // A tap between the two would go the wrong way if the box corner were used.
    expect(tapAt(100 + 6.2 * CELL)).toEqual(["rotateLeft"]);
    expect(tapAt(100 + 6.8 * CELL)).toEqual(["rotate"]);
  });

  it("does nothing when there is no piece to turn", () => {
    const { model, calls } = fakeModel();
    (model as any).piece = null;
    const tracker = new GestureTracker(model);
    tracker.down({ pointerId: 1, clientX: 500, clientY: 400, buttons: 1 } as any, boardRect);
    tracker.up({ pointerId: 1, clientX: 500, clientY: 400, buttons: 0 } as any);
    expect(calls).toEqual([]);
  });
});
