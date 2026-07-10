import { fitWithin, dataUrlByteLength, scaleImageToJpegUnderSize } from "./imageUtil";

// fitWithin and dataUrlByteLength are the pure parts of imageUtil (the rest is
// canvas/FileReader glue that needs a browser). fitWithin decides the pixel
// budget; dataUrlByteLength drives the quality-vs-size tradeoff for uploads.

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

describe("dataUrlByteLength", () => {
  it("returns the decoded byte length of a base64 data URL", () => {
    // "AAAA" (4 base64 chars, no padding) -> 3 bytes.
    expect(dataUrlByteLength("data:image/jpeg;base64,AAAA")).toBe(3);
  });

  it("accounts for base64 padding", () => {
    // 8 chars, "==" padding -> 6 - 2 = 4 bytes.
    expect(dataUrlByteLength("data:image/jpeg;base64,AAAAAA==")).toBe(4);
    // 8 chars, "=" padding -> 6 - 1 = 5 bytes.
    expect(dataUrlByteLength("data:image/jpeg;base64,AAAAAAA=")).toBe(5);
  });

  it("handles a raw base64 string with no data-URL header", () => {
    expect(dataUrlByteLength("AAAA")).toBe(3);
  });

  it("returns 0 for an empty payload", () => {
    expect(dataUrlByteLength("data:image/jpeg;base64,")).toBe(0);
    expect(dataUrlByteLength("")).toBe(0);
  });

  it("grows roughly linearly with the base64 length", () => {
    const small = dataUrlByteLength("data:image/jpeg;base64," + "A".repeat(400));
    const big = dataUrlByteLength("data:image/jpeg;base64," + "A".repeat(4000));
    expect(big).toBeGreaterThan(small * 9);
  });
});

// -------------------------------------------------------------------
// scaleImageToJpegUnderSize is canvas glue, but its quality-stepping LOOP is
// the pure logic worth guarding (termination, the 0.30 floor, and returning the
// min-quality encoding when the target is unreachable). We stub the two canvas
// methods so the real loop runs, with encoded size a controllable function of
// the requested JPEG quality.
// -------------------------------------------------------------------
describe("scaleImageToJpegUnderSize (loop, canvas stubbed)", () => {
  const TARGET = 100 * 1024;
  const img = { naturalWidth: 2000, naturalHeight: 1500 } as unknown as HTMLImageElement;
  let qualities: number[];
  let bytesForQuality: (q: number) => number;

  beforeEach(() => {
    qualities = [];
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((() => ({ drawImage: () => {} })) as any);
    jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(((
      _type: string,
      q: number,
    ) => {
      qualities.push(q);
      const bytes = bytesForQuality(q);
      // Emit base64 (no padding, length a multiple of 4) that decodes to ~bytes.
      const b64len = Math.ceil((bytes * 4) / 3 / 4) * 4;
      return "data:image/jpeg;base64," + "A".repeat(b64len);
    }) as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it("returns the start-quality encoding when it already fits the target", () => {
    bytesForQuality = () => 50 * 1024; // always under target
    const out = scaleImageToJpegUnderSize(img, 1600, TARGET, 0.82, 0.3, 0.06);
    expect(qualities).toEqual([0.82]); // no stepping needed
    expect(dataUrlByteLength(out)).toBeLessThanOrEqual(TARGET);
  });

  it("steps quality down and stops at the first encoding under the target", () => {
    // Decreasing with quality; first crosses under 100 KB at q = 0.46.
    bytesForQuality = (q) => Math.round(q * 200 * 1024);
    const out = scaleImageToJpegUnderSize(img, 1600, TARGET, 0.82, 0.3, 0.06);
    expect(dataUrlByteLength(out)).toBeLessThanOrEqual(TARGET);
    expect(qualities[0]).toBe(0.82);
    expect(qualities[qualities.length - 1]).toBeCloseTo(0.46, 5);
    expect(Math.min(...qualities)).toBeGreaterThanOrEqual(0.3); // never below floor
  });

  it("stops at the 0.30 floor and returns that encoding when even 0.30 is too big", () => {
    bytesForQuality = () => 500 * 1024; // always over target, any quality
    const out = scaleImageToJpegUnderSize(img, 1600, TARGET, 0.82, 0.3, 0.06);
    // The floor is actually tried (no off-by-one skipping it)...
    expect(qualities).toContain(0.3);
    // ...never goes below it...
    expect(qualities.every((q) => q >= 0.3)).toBe(true);
    // ...returns the min-quality (last) encoding, not a larger higher-quality one...
    expect(qualities[qualities.length - 1]).toBe(0.3);
    // ...and terminates in a bounded number of steps.
    expect(qualities.length).toBeLessThanOrEqual(12);
    expect(dataUrlByteLength(out)).toBeGreaterThan(TARGET); // best effort; still over
  });
});
