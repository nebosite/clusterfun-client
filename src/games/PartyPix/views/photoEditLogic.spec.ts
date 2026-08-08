import {
  clampCrop,
  moveCrop,
  resizeCrop,
  toCropSpace,
  brushWidthFor,
  containFraction,
  BRUSH_COLORS,
  FULL_CROP,
  MIN_CROP,
} from "./photoEditLogic";

// ==========================================================================================
// Crop and draw geometry, all in normalized image space (0..1 across the ORIGINAL photo).
//
// That choice is the reason this is testable at all: a stroke recorded in screen pixels would
// be wrong the moment the same photo is composited at full resolution instead of the ~350px
// the phone previews it at, and would slide around whenever the crop moved.
// ==========================================================================================

describe("keeping a crop inside the picture", () => {
  it("leaves the whole picture alone", () => {
    expect(clampCrop(FULL_CROP)).toEqual(FULL_CROP);
  });

  it("pushes a rect that hangs off the right edge back inside", () => {
    expect(clampCrop({ x: 0.8, y: 0, width: 0.5, height: 0.5 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  it("refuses a crop smaller than the minimum", () => {
    // A 1% crop is a mis-tap, and it would upload a handful of pixels blown up to full screen.
    const tiny = clampCrop({ x: 0.5, y: 0.5, width: 0.01, height: 0.01 });
    expect(tiny.width).toBe(MIN_CROP);
    expect(tiny.height).toBe(MIN_CROP);
  });

  it("never lets a clamped rect leave the picture", () => {
    for (const r of [
      { x: -1, y: -1, width: 2, height: 2 },
      { x: 1.5, y: 1.5, width: 0.5, height: 0.5 },
      { x: 0.9, y: 0.9, width: 0.9, height: 0.9 },
    ]) {
      const c = clampCrop(r);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.width).toBeLessThanOrEqual(1.0000001);
      expect(c.y + c.height).toBeLessThanOrEqual(1.0000001);
    }
  });
});

describe("moving a crop", () => {
  const half = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it("slides by the delta", () => {
    expect(moveCrop(half, 0.1, -0.1)).toEqual({ x: 0.35, y: 0.15, width: 0.5, height: 0.5 });
  });

  it("stops at the edge instead of shrinking", () => {
    // Dragging a crop off the side should pin it, not resize it - the size is the framing the
    // player already chose.
    const pinned = moveCrop(half, 5, 5);
    expect(pinned).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });
});

describe("dragging a corner", () => {
  const full = FULL_CROP;

  it("anchors the OPPOSITE corner", () => {
    // Pulling the SE corner to (0.6,0.6) leaves the NW corner where it was.
    const r = resizeCrop(full, "se", 0.6, 0.6);
    expect([r.x, r.y]).toEqual([0, 0]);
    expect(r.width).toBeCloseTo(0.6, 6);
    expect(r.height).toBeCloseTo(0.6, 6);
  });

  it("moves the origin when the NW corner is the one dragged", () => {
    const r = resizeCrop(full, "nw", 0.3, 0.2);
    expect(r.x).toBeCloseTo(0.3, 6);
    expect(r.y).toBeCloseTo(0.2, 6);
    expect(r.x + r.width).toBeCloseTo(1, 6);
    expect(r.y + r.height).toBeCloseTo(1, 6);
  });

  it("will not let a corner cross its opposite", () => {
    // Dragging SE past NW would give a negative size, and a negative-size crop composites to
    // a blank image rather than an error.
    const r = resizeCrop({ x: 0.4, y: 0.4, width: 0.4, height: 0.4 }, "se", 0.1, 0.1);
    expect(r.width).toBeGreaterThanOrEqual(MIN_CROP);
    expect(r.height).toBeGreaterThanOrEqual(MIN_CROP);
  });

  it("clamps a drag outside the picture to its edge", () => {
    const r = resizeCrop(full, "se", 5, 5);
    expect(r.width).toBeCloseTo(1, 6);
    expect(r.height).toBeCloseTo(1, 6);
  });
});

describe("placing a stroke relative to the crop", () => {
  it("maps the crop's own corners to 0 and 1", () => {
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.5 };
    expect(toCropSpace({ x: 0.25, y: 0.5 }, crop)).toEqual({ x: 0, y: 0 });
    expect(toCropSpace({ x: 0.75, y: 1 }, crop)).toEqual({ x: 1, y: 1 });
  });

  it("keeps paint on the same part of the picture when the crop moves", () => {
    // A dot on the subject's nose stays on the nose after the framing is adjusted - which is
    // the whole reason strokes are stored against the image and not against the crop.
    const nose = { x: 0.5, y: 0.5 };
    const before = toCropSpace(nose, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    const after = toCropSpace(nose, { x: 0.3, y: 0.25, width: 0.5, height: 0.5 });
    expect(before.x).toBeCloseTo(0.5, 6);
    expect(after.x).toBeCloseTo(0.4, 6); // shifted with the frame, still on the nose
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("reports points outside the crop rather than dropping them", () => {
    // They are clipped by the canvas, so widening the crop again brings the paint back.
    const outside = toCropSpace({ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
    expect(outside.x).toBeLessThan(0);
    expect(outside.y).toBeLessThan(0);
  });
});

describe("the brush", () => {
  it("offers exactly eight distinct colours", () => {
    expect(BRUSH_COLORS).toHaveLength(8);
    expect(new Set(BRUSH_COLORS).size).toBe(8);
  });

  it("scales with the picture, so 'medium' means the same thickness at any size", () => {
    // A flat pixel width would be a bold stroke on the phone preview and a hairline on the
    // full-resolution composite that actually gets uploaded.
    const preview = brushWidthFor(350, 500);
    const full = brushWidthFor(1400, 2000);
    expect(full / preview).toBeCloseTo(4, 0);
  });

  it("never goes below a visible width on a tiny image", () => {
    expect(brushWidthFor(20, 20)).toBeGreaterThanOrEqual(2);
  });
});

// ==========================================================================================
// THE BRUSH DID NOT FOLLOW THE CURSOR.
//
// The editor canvas is `object-fit: contain`, so the bitmap is letterboxed inside the element
// box whenever the two aspect ratios differ - and they nearly always differ, because the
// element is a flex child of a fixed-width column while the photo is whatever shape the camera
// produced. `getBoundingClientRect()` gives the ELEMENT box, so dividing by its width and
// height stretched the whole frame, letterbox bars and all, onto the picture. Paint landed
// further from the cursor the further out it went.
// ==========================================================================================
describe("finding the point on the picture under the cursor", () => {
  // A 400x300 (4:3) bitmap inside a 400x400 box: `contain` scales to 400x300 and centres it
  // vertically, leaving 50px bars top and bottom.
  const box = { left: 0, top: 0, width: 400, height: 400 };

  it("puts the centre of the picture at the centre", () => {
    expect(containFraction(200, 200, box, 400, 300)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("maps the picture's own top edge to 0, not the element's", () => {
    // The element's top is a letterbox bar. The picture starts 50px lower.
    expect(containFraction(200, 50, box, 400, 300).y).toBeCloseTo(0, 6);
    expect(containFraction(200, 350, box, 400, 300).y).toBeCloseTo(1, 6);
  });

  it("is the fix: the naive mapping was wrong by the letterbox", () => {
    // Naive: (200-0)/400 = 0.5 vertically for a click at y=200 - correct only at the centre.
    // A click at y=125 is a quarter down the PICTURE, but only 31% down the element.
    const correct = containFraction(200, 125, box, 400, 300);
    const naive = 125 / 400;
    expect(correct.y).toBeCloseTo(0.25, 6);
    expect(naive).toBeCloseTo(0.3125, 6);
    expect(Math.abs(correct.y - naive)).toBeGreaterThan(0.05);
  });

  it("reports a point on a letterbox bar as outside the picture", () => {
    // The caller can then ignore it rather than clamping a stroke onto the edge.
    expect(containFraction(200, 10, box, 400, 300).y).toBeLessThan(0);
    expect(containFraction(200, 390, box, 400, 300).y).toBeGreaterThan(1);
  });

  it("handles bars on the SIDES when the picture is the taller one", () => {
    // 300x400 portrait in a 400x400 box: scaled to 300x400, 50px bars left and right.
    const b = { left: 0, top: 0, width: 400, height: 400 };
    expect(containFraction(50, 200, b, 300, 400).x).toBeCloseTo(0, 6);
    expect(containFraction(350, 200, b, 300, 400).x).toBeCloseTo(1, 6);
    expect(containFraction(200, 200, b, 300, 400)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("accounts for the element's position on the page", () => {
    // A scrolled page puts the box somewhere other than the origin.
    const offset = { left: 120, top: 80, width: 400, height: 400 };
    expect(containFraction(320, 280, offset, 400, 300)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("returns the origin rather than NaN before layout has happened", () => {
    // First paint can measure a zero-sized box, and NaN coordinates poison a whole stroke.
    expect(containFraction(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 400, 300)).toEqual({
      x: 0,
      y: 0,
    });
    expect(containFraction(10, 10, box, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});
