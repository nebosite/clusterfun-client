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
    rotate: () => calls.push({ name: "rotate", args: [] }),
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

describe("EITtris GestureTracker - a swipe down does not steer", () => {
  it("keeps the column while the finger goes down and wobbles across", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    // Straight down, with the sideways wobble a thumb always has.  Three quarters of a
    // cell each way, which is what it takes to move the piece a column - a smaller wobble
    // would round away and prove nothing.
    drag(tracker, [
      [10, 60],
      [-30, 140],
      [32, 220],
      [-28, 300],
    ]);

    const columns = calls.filter((c) => c.name === "dragTo").map((c) => c.args[0]);
    expect(columns.length).toBeGreaterThan(0);
    expect(new Set(columns).size).toBe(1);
    expect(columns[0]).toBe(5); // where the piece started
  });

  it("still walks the piece down as it goes", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [
      [10, 60],
      [-30, 200],
    ]);

    const rows = calls.filter((c) => c.name === "dragTo").map((c) => c.args[1]);
    expect(rows[rows.length - 1]).toBeGreaterThan(rows[0]);
  });

  it("does not lock a gesture that is mostly sideways", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [
      [60, 4],
      [120, 10],
    ]);

    const columns = calls.filter((c) => c.name === "dragTo").map((c) => c.args[0]);
    expect(columns[columns.length - 1]).toBeGreaterThan(5);
  });

  it("leaves a genuinely diagonal drag alone", () => {
    // Down AND across in equal measure is somebody steering, not dropping
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [
      [40, 40],
      [90, 90],
    ]);

    const last = calls.filter((c) => c.name === "dragTo").pop()!;
    expect(last.args[0]).toBeGreaterThan(5); // moved across
    expect(last.args[1]).toBeGreaterThan(3); // and down
  });

  it("holds the column it had reached when the drop began", () => {
    // Steer two columns right, then swipe down: it drops from there, not from the start.
    // The swipe has to be decisively downward - measured from where the finger went down,
    // so a gesture that has already travelled sideways needs to travel further to count.
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    tracker.down(pointer(200, 200), rect);
    tracker.move(pointer(200 + 2 * CELL, 200));
    tracker.move(pointer(200 + 2 * CELL + 30, 200 + 260));
    tracker.move(pointer(200 + 2 * CELL - 28, 200 + 380));

    const columns = calls.filter((c) => c.name === "dragTo").map((c) => c.args[0]);
    expect(columns[0]).toBe(7);
    expect(new Set(columns).size).toBe(1);
  });

  it("sends nothing at all until the finger has actually moved", () => {
    const { model, calls } = fakeModel();
    const tracker = new GestureTracker(model);
    drag(tracker, [[1, DRAG_ACTIVATION_PX - 3]]);
    expect(calls.length).toBe(0);
  });
});
