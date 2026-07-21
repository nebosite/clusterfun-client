import {
  ZonePoint,
  clampPoint,
  polygonArea,
  polygonBounds,
  simplifyPath,
  prepareZonePoints,
  validateZone,
  pickPlayerColor,
  expiredZoneIds,
  polygonToCssClipPath,
  contextBounds,
  coverSourceRect,
  patchOutputSize,
  ImageTransform,
  coverScale,
  initialImageTransform,
  panTransform,
  pinchTransform,
} from "./collageBoardLogic";

// Forward-map a source-centered point through a transform, for asserting
// the pan/zoom/tilt invariants without a canvas.
const mapPoint = (t: ImageTransform, sx: number, sy: number) => {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return {
    x: t.cx + t.scale * (sx * cos - sy * sin),
    y: t.cy + t.scale * (sx * sin + sy * cos),
  };
};

// Inverse-map an output point back to source-centered coords.
const unmapPoint = (t: ImageTransform, ox: number, oy: number) => {
  const cos = Math.cos(-t.rotation);
  const sin = Math.sin(-t.rotation);
  const vx = (ox - t.cx) / t.scale;
  const vy = (oy - t.cy) / t.scale;
  return { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
};

const square = (): ZonePoint[] => [
  { x: 0.2, y: 0.2 },
  { x: 0.6, y: 0.2 },
  { x: 0.6, y: 0.6 },
  { x: 0.2, y: 0.6 },
];

describe("clampPoint", () => {
  it("clamps out-of-board coordinates to 0..1", () => {
    expect(clampPoint({ x: -0.5, y: 1.5 })).toEqual({ x: 0, y: 1 });
    expect(clampPoint({ x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 });
  });
});

describe("polygonArea", () => {
  it("computes the shoelace area of a square", () => {
    expect(polygonArea(square())).toBeCloseTo(0.16, 6);
  });

  it("is orientation-independent", () => {
    expect(polygonArea(square().reverse())).toBeCloseTo(0.16, 6);
  });

  it("returns 0 for degenerate polygons", () => {
    expect(polygonArea([])).toBe(0);
    expect(
      polygonArea([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(0);
  });
});

describe("polygonBounds", () => {
  it("finds the axis-aligned bounding box", () => {
    const b = polygonBounds(square());
    expect(b.x).toBeCloseTo(0.2, 6);
    expect(b.y).toBeCloseTo(0.2, 6);
    expect(b.width).toBeCloseTo(0.4, 6);
    expect(b.height).toBeCloseTo(0.4, 6);
  });

  it("handles an empty outline", () => {
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("simplifyPath", () => {
  it("drops collinear points", () => {
    const path: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.0001 },
      { x: 0.5, y: 0 },
      { x: 0.75, y: 0.0001 },
      { x: 1, y: 0 },
    ];
    expect(simplifyPath(path, 0.01)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("keeps significant corners", () => {
    const path: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0 },
    ];
    expect(simplifyPath(path, 0.01)).toHaveLength(3);
  });
});

describe("prepareZonePoints", () => {
  it("clamps, dedupes, and rounds", () => {
    const prepared = prepareZonePoints(
      [
        { x: -0.1, y: 0.123456 },
        { x: -0.1, y: 0.123456 }, // duplicate after clamping
        { x: 0.5, y: 0.9 },
        { x: 1.2, y: 0.2 },
      ],
      0.001,
      48,
    );
    expect(prepared[0]).toEqual({ x: 0, y: 0.1235 });
    expect(prepared[prepared.length - 1]).toEqual({ x: 1, y: 0.2 });
    expect(prepared.length).toBe(3);
  });

  it("grows epsilon until the outline fits under maxPoints", () => {
    // A noisy 200-point circle must come back with at most 10 points
    const noisy: ZonePoint[] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      noisy.push({ x: 0.5 + 0.3 * Math.cos(a), y: 0.5 + 0.3 * Math.sin(a) });
    }
    const prepared = prepareZonePoints(noisy, 0.0001, 10);
    expect(prepared.length).toBeLessThanOrEqual(10);
    expect(prepared.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateZone", () => {
  it("accepts a reasonable outline", () => {
    expect(validateZone(square(), 3, 48, 0.0005).ok).toBe(true);
  });

  it("rejects too few points", () => {
    const res = validateZone(square().slice(0, 2), 3, 48, 0.0005);
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
  });

  it("rejects too many points", () => {
    const many = Array.from({ length: 49 }, (_, i) => ({ x: i / 100, y: (i % 7) / 10 }));
    expect(validateZone(many, 3, 48, 0.0005).ok).toBe(false);
  });

  it("rejects a zone below the minimum area", () => {
    const sliver: ZonePoint[] = [
      { x: 0.5, y: 0.5 },
      { x: 0.501, y: 0.5 },
      { x: 0.501, y: 0.501 },
    ];
    expect(validateZone(sliver, 3, 48, 0.0005).ok).toBe(false);
  });

  it("rejects off-board or non-finite coordinates", () => {
    const bad = square();
    bad[1] = { x: 1.5, y: 0.2 };
    expect(validateZone(bad, 3, 48, 0.0005).ok).toBe(false);

    const nan = square();
    nan[2] = { x: NaN, y: 0.6 };
    expect(validateZone(nan, 3, 48, 0.0005).ok).toBe(false);
  });
});

describe("pickPlayerColor", () => {
  const palette = ["red", "green", "blue"];

  it("assigns palette colors in order while unused", () => {
    expect(pickPlayerColor([], palette)).toBe("red");
    expect(pickPlayerColor(["red"], palette)).toBe("green");
    expect(pickPlayerColor(["red", "green"], palette)).toBe("blue");
  });

  it("wraps to least-used when the palette is exhausted", () => {
    expect(pickPlayerColor(["red", "green", "blue", "red"], palette)).toBe("green");
  });
});

describe("expiredZoneIds", () => {
  it("returns only zones past their lifetime", () => {
    const zones = [
      { zoneId: "a", claimedAt: 0 },
      { zoneId: "b", claimedAt: 5000 },
    ];
    expect(expiredZoneIds(zones, 6001, 6000)).toEqual(["a"]);
    expect(expiredZoneIds(zones, 20000, 6000)).toEqual(["a", "b"]);
    expect(expiredZoneIds(zones, 1000, 6000)).toEqual([]);
  });
});

describe("polygonToCssClipPath", () => {
  it("expresses vertices as percentages of the bounding box", () => {
    const points = square();
    const clip = polygonToCssClipPath(points, polygonBounds(points));
    expect(clip).toBe("polygon(0.00% 0.00%, 100.00% 0.00%, 100.00% 100.00%, 0.00% 100.00%)");
  });
});

describe("contextBounds", () => {
  const ASPECT = 16 / 9;

  it("pads a mid-board zone symmetrically and stays within [0,1]", () => {
    const bounds = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const ctx = contextBounds(bounds, ASPECT, 0.6, 0.05);
    // Centered the same as the zone
    expect(ctx.x + ctx.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 6);
    expect(ctx.y + ctx.height / 2).toBeCloseTo(bounds.y + bounds.height / 2, 6);
    expect(ctx.width).toBeGreaterThan(bounds.width);
    expect(ctx.height).toBeGreaterThan(bounds.height);
    expect(ctx.x).toBeGreaterThanOrEqual(0);
    expect(ctx.y).toBeGreaterThanOrEqual(0);
    expect(ctx.x + ctx.width).toBeLessThanOrEqual(1);
    expect(ctx.y + ctx.height).toBeLessThanOrEqual(1);
  });

  it("floors tiny zones at minMargin instead of a near-zero pad", () => {
    const bounds = { x: 0.5, y: 0.5, width: 0.01, height: 0.01 };
    const ctx = contextBounds(bounds, ASPECT, 0.6, 0.05);
    // minMargin (0.05) dominates factor*size (~0.01*0.6), in both axes
    expect(ctx.height).toBeCloseTo(bounds.height + 0.05 * 2, 6);
    expect(ctx.width).toBeCloseTo(bounds.width + (0.05 / ASPECT) * 2, 6);
  });

  it("slides rather than shrinks near a board edge", () => {
    const bounds = { x: 0, y: 0, width: 0.1, height: 0.1 };
    const ctx = contextBounds(bounds, ASPECT, 0.6, 0.05);
    expect(ctx.x).toBe(0);
    expect(ctx.y).toBe(0);
    // Still gets its full margin width/height, just pushed inward
    expect(ctx.x + ctx.width).toBeLessThanOrEqual(1);
    expect(ctx.y + ctx.height).toBeLessThanOrEqual(1);
    expect(ctx.width).toBeGreaterThan(bounds.width);
  });

  it("clamps to the whole board for a zone that already covers it", () => {
    const bounds = { x: 0, y: 0, width: 1, height: 1 };
    const ctx = contextBounds(bounds, ASPECT, 0.6, 0.05);
    expect(ctx).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("coverSourceRect", () => {
  it("crops left/right when the source is wider than the target", () => {
    // 200x100 source into a square target -> crop to the middle 100x100
    expect(coverSourceRect(200, 100, 50, 50)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 });
  });

  it("crops top/bottom when the source is taller than the target", () => {
    expect(coverSourceRect(100, 200, 50, 50)).toEqual({ sx: 0, sy: 50, sw: 100, sh: 100 });
  });

  it("passes through a matching aspect", () => {
    expect(coverSourceRect(160, 90, 16, 9)).toEqual({ sx: 0, sy: 0, sw: 160, sh: 90 });
  });
});

describe("patchOutputSize", () => {
  it("scales the bbox to board pixels", () => {
    const size = patchOutputSize({ x: 0, y: 0, width: 0.5, height: 0.5 }, 1920, 1080, 1280);
    expect(size).toEqual({ width: 960, height: 540 });
  });

  it("caps the long edge", () => {
    const size = patchOutputSize({ x: 0, y: 0, width: 1, height: 1 }, 1920, 1080, 1280);
    expect(size.width).toBe(1280);
    expect(size.height).toBe(720);
  });

  it("never returns zero dimensions", () => {
    const size = patchOutputSize({ x: 0, y: 0, width: 0.0001, height: 0.0001 }, 1920, 1080, 1280);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe("coverScale", () => {
  it("uses the larger ratio so the image covers the output", () => {
    // Wide source into a square output: height is the tight edge (200/100).
    expect(coverScale(400, 100, 100, 100)).toBe(1);
    expect(coverScale(100, 100, 200, 100)).toBe(2);
  });

  it("falls back to 1 on degenerate sizes", () => {
    expect(coverScale(0, 100, 100, 100)).toBe(1);
    expect(coverScale(100, 100, 0, 100)).toBe(1);
  });
});

describe("initialImageTransform", () => {
  it("centers the image, cover-scaled, with no tilt", () => {
    const t = initialImageTransform(100, 100, 200, 100);
    expect(t).toEqual({ scale: 2, rotation: 0, cx: 100, cy: 50 });
  });
});

describe("panTransform", () => {
  it("shifts the center and leaves scale/rotation alone", () => {
    const t = { scale: 3, rotation: 0.5, cx: 10, cy: 20 };
    expect(panTransform(t, 5, -8)).toEqual({ scale: 3, rotation: 0.5, cx: 15, cy: 12 });
  });
});

describe("pinchTransform", () => {
  const base: ImageTransform = { scale: 2, rotation: 0, cx: 100, cy: 100 };

  it("zooms and tilts by the requested amounts", () => {
    const t = pinchTransform(base, 100, 100, 1.5, 0.3, 0.1, 100);
    expect(t.scale).toBeCloseTo(3, 10);
    expect(t.rotation).toBeCloseTo(0.3, 10);
  });

  it("holds the source point under the pivot fixed", () => {
    const pivot = { x: 160, y: 40 };
    const srcBefore = unmapPoint(base, pivot.x, pivot.y);
    const t = pinchTransform(base, pivot.x, pivot.y, 1.7, -0.4, 0.1, 100);
    const after = mapPoint(t, srcBefore.x, srcBefore.y);
    expect(after.x).toBeCloseTo(pivot.x, 8);
    expect(after.y).toBeCloseTo(pivot.y, 8);
  });

  it("clamps scale but still holds the pivot fixed at the limit", () => {
    const pivot = { x: 130, y: 70 };
    const srcBefore = unmapPoint(base, pivot.x, pivot.y);
    // Ask for 10x from scale 2 -> would be 20, clamp caps at 5.
    const t = pinchTransform(base, pivot.x, pivot.y, 10, 0, 0.1, 5);
    expect(t.scale).toBe(5);
    const after = mapPoint(t, srcBefore.x, srcBefore.y);
    expect(after.x).toBeCloseTo(pivot.x, 8);
    expect(after.y).toBeCloseTo(pivot.y, 8);
  });
});
