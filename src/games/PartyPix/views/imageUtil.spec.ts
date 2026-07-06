import { fitWithin } from "./imageUtil";

// fitWithin is the only pure part of imageUtil (the rest is canvas/FileReader
// glue that needs a browser). It decides the on-the-wire pixel budget for
// every uploaded photo, so its scaling + guard behavior is worth pinning down.

describe("fitWithin", () => {
  it("does not upscale when the image already fits", () => {
    expect(fitWithin(100, 50, 200)).toEqual({ width: 100, height: 50 });
    expect(fitWithin(50, 100, 200)).toEqual({ width: 50, height: 100 });
  });

  it("leaves an image exactly at the max edge unchanged", () => {
    expect(fitWithin(200, 100, 200)).toEqual({ width: 200, height: 100 });
    expect(fitWithin(200, 200, 200)).toEqual({ width: 200, height: 200 });
  });

  it("scales a landscape image so the long (width) edge hits maxEdge", () => {
    expect(fitWithin(2400, 1200, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(1000, 500, 500)).toEqual({ width: 500, height: 250 });
  });

  it("scales a portrait image so the long (height) edge hits maxEdge", () => {
    expect(fitWithin(1200, 2400, 1200)).toEqual({ width: 600, height: 1200 });
  });

  it("preserves aspect ratio for a square image", () => {
    expect(fitWithin(2000, 2000, 1000)).toEqual({ width: 1000, height: 1000 });
  });

  it("rounds the scaled short edge to a whole pixel", () => {
    // 333 * (500/1000) = 166.5 -> rounds to 167
    expect(fitWithin(1000, 333, 500)).toEqual({ width: 500, height: 167 });
  });

  it("returns a zeroed box for degenerate / zero / negative dimensions", () => {
    expect(fitWithin(0, 100, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 0, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(0, 0, 200)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 100, 200)).toEqual({ width: 0, height: 0 });
  });
});
