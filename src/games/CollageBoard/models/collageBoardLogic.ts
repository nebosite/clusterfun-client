// -------------------------------------------------------------------
// collageBoardLogic
//
// PURE, framework-free rules for CollageBoard: zone geometry (area, bounds,
// simplification, validation), player-color assignment, claim expiry, and the
// cover-crop math used when a camera frame fills a zone's bounding box.
// Everything here is unit-tested in collageBoardLogic.spec.ts.
//
// All coordinates are normalized board units: 0..1 in x and y over a 16:9
// surface.  Nothing in this file touches the DOM, MobX, or the framework.
// -------------------------------------------------------------------

export interface ZonePoint {
  x: number;
  y: number;
}

export interface ZoneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// -------------------------------------------------------------------
// clampPoint - keep a point on the board
// -------------------------------------------------------------------
export function clampPoint(p: ZonePoint): ZonePoint {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(p.x), y: clamp(p.y) };
}

// -------------------------------------------------------------------
// polygonArea - shoelace formula, in normalized board units
// -------------------------------------------------------------------
export function polygonArea(points: ZonePoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

// -------------------------------------------------------------------
// polygonBounds - axis-aligned bounding box of an outline
// -------------------------------------------------------------------
export function polygonBounds(points: ZonePoint[]): ZoneBounds {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// -------------------------------------------------------------------
// Perpendicular distance from a point to the segment a-b (degenerate
// segments fall back to point distance).
// -------------------------------------------------------------------
function pointToSegmentDistance(p: ZonePoint, a: ZonePoint, b: ZonePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// -------------------------------------------------------------------
// simplifyPath - Ramer-Douglas-Peucker.  Keeps endpoints; drops points
// closer than epsilon to the chord.
// -------------------------------------------------------------------
export function simplifyPath(points: ZonePoint[], epsilon: number): ZonePoint[] {
  if (points.length < 3) return points.slice();

  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIndex = i;
    }
  }

  if (maxDist <= epsilon) return [first, last];
  const left = simplifyPath(points.slice(0, maxIndex + 1), epsilon);
  const right = simplifyPath(points.slice(maxIndex), epsilon);
  return left.slice(0, -1).concat(right);
}

// -------------------------------------------------------------------
// prepareZonePoints - turn a raw freehand path into a wire-ready outline:
// clamp to the board, drop consecutive duplicates, then simplify with a
// growing epsilon until the point count fits under maxPoints.
// -------------------------------------------------------------------
export function prepareZonePoints(
  raw: ZonePoint[],
  epsilon: number,
  maxPoints: number,
): ZonePoint[] {
  const clamped: ZonePoint[] = [];
  for (const p of raw) {
    const c = clampPoint(p);
    const prev = clamped[clamped.length - 1];
    if (!prev || prev.x !== c.x || prev.y !== c.y) clamped.push(c);
  }

  let eps = epsilon;
  let result = simplifyPath(clamped, eps);
  while (result.length > maxPoints) {
    eps *= 2;
    result = simplifyPath(result, eps);
  }
  // Round to 4 decimals so outlines stay compact on the wire
  return result.map((p) => ({
    x: Math.round(p.x * 10000) / 10000,
    y: Math.round(p.y * 10000) / 10000,
  }));
}

// -------------------------------------------------------------------
// validateZone - is this outline claimable?
// -------------------------------------------------------------------
export function validateZone(
  points: ZonePoint[],
  minPoints: number,
  maxPoints: number,
  minArea: number,
): { ok: boolean; reason?: string } {
  if (points.length < minPoints) return { ok: false, reason: "Draw a bigger outline" };
  if (points.length > maxPoints) return { ok: false, reason: "Outline is too detailed" };
  for (const p of points) {
    if (
      typeof p.x !== "number" ||
      typeof p.y !== "number" ||
      !isFinite(p.x) ||
      !isFinite(p.y) ||
      p.x < 0 ||
      p.x > 1 ||
      p.y < 0 ||
      p.y > 1
    ) {
      return { ok: false, reason: "Outline is off the board" };
    }
  }
  if (polygonArea(points) < minArea) return { ok: false, reason: "Zone is too small" };
  return { ok: true };
}

// -------------------------------------------------------------------
// pickPlayerColor - least-used color from the palette (first palette
// entry wins ties, so assignment order is stable and predictable).
// -------------------------------------------------------------------
export function pickPlayerColor(usedColors: string[], palette: string[]): string {
  let best = palette[0];
  let bestCount = Infinity;
  for (const color of palette) {
    const count = usedColors.filter((c) => c === color).length;
    if (count < bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}

// -------------------------------------------------------------------
// expiredZoneIds - which claims have outlived the zone lifetime
// -------------------------------------------------------------------
export function expiredZoneIds(
  zones: { zoneId: string; claimedAt: number }[],
  now_ms: number,
  lifetime_ms: number,
): string[] {
  return zones.filter((z) => now_ms - z.claimedAt > lifetime_ms).map((z) => z.zoneId);
}

// -------------------------------------------------------------------
// polygonToCssClipPath - a CSS clip-path polygon() string with vertices
// expressed as percentages of the zone's bounding box.  Used to clip the
// live camera video (and the frozen confirm frame) to the outline.
// -------------------------------------------------------------------
export function polygonToCssClipPath(points: ZonePoint[], bounds: ZoneBounds): string {
  const w = bounds.width || 1;
  const h = bounds.height || 1;
  const verts = points
    .map((p) => {
      const px = ((p.x - bounds.x) / w) * 100;
      const py = ((p.y - bounds.y) / h) * 100;
      return `${px.toFixed(2)}% ${py.toFixed(2)}%`;
    })
    .join(", ");
  return `polygon(${verts})`;
}

// -------------------------------------------------------------------
// coverSourceRect - the source crop rectangle that makes a srcW x srcH
// image fill a dstW x dstH target like CSS object-fit: cover (centered,
// no letterboxing, overflow cropped).
// -------------------------------------------------------------------
export function coverSourceRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (srcAspect > dstAspect) {
    // source is wider - crop left/right
    const sw = srcH * dstAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  // source is taller - crop top/bottom
  const sh = srcW / dstAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

// -------------------------------------------------------------------
// patchOutputSize - pixel dimensions for a committed patch image.  The
// bounding box is normalized board units on a 16:9 surface, so convert to
// the surface's physical aspect, target ~full-HD board resolution, and cap
// the long edge.
// -------------------------------------------------------------------
export function patchOutputSize(
  bounds: ZoneBounds,
  boardPixelWidth: number,
  boardPixelHeight: number,
  maxEdge: number,
): { width: number; height: number } {
  let w = Math.max(1, Math.round(bounds.width * boardPixelWidth));
  let h = Math.max(1, Math.round(bounds.height * boardPixelHeight));
  const longest = Math.max(w, h);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
  }
  return { width: w, height: h };
}
