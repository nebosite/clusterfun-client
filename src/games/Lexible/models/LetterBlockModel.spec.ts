import { CAPTURE_SPARK_MS, LetterBlockModel } from "./LetterBlockModel";

// The capture burst is decoration, but it is decoration on a tile that a party is watching,
// and the two ways it can go wrong are both visible: a burst that never plays, and a burst
// that never stops.

describe("capture sparks", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("is off until the tile changes hands", () => {
    expect(new LetterBlockModel("Q").captureSeq).toBe(0);
  });

  it("turns on when the tile is captured", () => {
    const block = new LetterBlockModel("Q");
    block.capture();
    expect(block.captureSeq).toBeGreaterThan(0);
  });

  it("turns itself off again, so a tile is not left sparkling", () => {
    const block = new LetterBlockModel("Q");
    block.capture();
    jest.advanceTimersByTime(CAPTURE_SPARK_MS + 10);
    expect(block.captureSeq).toBe(0);
  });

  it("changes value on a re-capture, so the animation replays", () => {
    // The view keys the element on this number.  A boolean would already be true here and
    // the second burst would never be seen.
    const block = new LetterBlockModel("Q");
    block.capture();
    const first = block.captureSeq;
    block.capture();
    expect(block.captureSeq).not.toBe(first);
  });

  it("does not let an earlier burst's timer cut a later one short", () => {
    const block = new LetterBlockModel("Q");
    block.capture();
    jest.advanceTimersByTime(CAPTURE_SPARK_MS - 50);
    block.capture(); // re-taken just before the first one expires
    jest.advanceTimersByTime(60); // the FIRST timer fires here
    expect(block.captureSeq).toBeGreaterThan(0);
    jest.advanceTimersByTime(CAPTURE_SPARK_MS);
    expect(block.captureSeq).toBe(0);
  });
});
