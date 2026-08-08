// -------------------------------------------------------------------
// photoEditLogic
//
// The geometry behind cropping and drawing on a photo before it is uploaded. Pure and
// framework-free, so the fiddly parts - clamping a crop to the picture, keeping a stroke
// pointing at the same pixels after the crop moves - are unit-tested rather than eyeballed on
// a phone.
//
// EVERYTHING HERE IS IN NORMALIZED IMAGE SPACE: x and y run 0..1 across the ORIGINAL photo,
// never in screen pixels. That is what lets a stroke drawn on a 350px-wide phone preview come
// out in the right place when the same photo is composited at 1600px, and what lets a crop be
// adjusted after the drawing without dragging the paint around with it.
// -------------------------------------------------------------------

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropCorner = "nw" | "ne" | "sw" | "se";

/** The whole picture - the crop everything starts at. */
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** A crop smaller than this is a mis-drag, not an intention. */
export const MIN_CROP = 0.1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Force a rect inside the picture and no smaller than MIN_CROP, without moving its anchor. */
export function clampCrop(rect: CropRect): CropRect {
  const width = Math.min(1, Math.max(MIN_CROP, rect.width));
  const height = Math.min(1, Math.max(MIN_CROP, rect.height));
  return {
    x: clamp01(Math.min(rect.x, 1 - width)),
    y: clamp01(Math.min(rect.y, 1 - height)),
    width,
    height,
  };
}

/** Slide the crop by a delta, stopping at the edges rather than shrinking. */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return {
    x: clamp01(Math.min(rect.x + dx, 1 - rect.width)),
    y: clamp01(Math.min(rect.y + dy, 1 - rect.height)),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Drag one corner to (px, py). The opposite corner is the anchor and does not move, which is
 * what makes a corner handle feel like a corner handle.
 */
export function resizeCrop(rect: CropRect, corner: CropCorner, px: number, py: number): CropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = clamp01(px);
  const y = clamp01(py);

  let nx = left;
  let ny = top;
  let nw = rect.width;
  let nh = rect.height;

  if (corner === "nw" || corner === "sw") {
    nx = Math.min(x, right - MIN_CROP);
    nw = right - nx;
  } else {
    nw = Math.max(MIN_CROP, x - left);
    nw = Math.min(nw, 1 - left);
  }
  if (corner === "nw" || corner === "ne") {
    ny = Math.min(y, bottom - MIN_CROP);
    nh = bottom - ny;
  } else {
    nh = Math.max(MIN_CROP, y - top);
    nh = Math.min(nh, 1 - top);
  }
  return clampCrop({ x: nx, y: ny, width: nw, height: nh });
}

/**
 * A point in original-image space expressed relative to the crop, so a stroke lands on the
 * same part of the picture after the crop is adjusted. Values outside 0..1 are points that
 * fall outside the crop; the caller lets the canvas clip them rather than dropping them, so
 * re-widening the crop brings the paint back.
 */
export function toCropSpace(point: { x: number; y: number }, crop: CropRect) {
  return {
    x: (point.x - crop.x) / crop.width,
    y: (point.y - crop.y) / crop.height,
  };
}

/** The eight brush colours. Bright enough to read over a photograph, and visibly distinct. */
export const BRUSH_COLORS = [
  "#ff3b30", // red
  "#ff9500", // orange
  "#ffd21a", // yellow
  "#b6ff3a", // lime
  "#22e0ff", // cyan
  "#3a7bff", // blue
  "#ff3ea5", // magenta
  "#ffffff", // white
] as const;

/**
 * Brush width in pixels for an image of this size. One medium brush, but "medium" has to mean
 * the same THICKNESS RELATIVE TO THE PICTURE at every resolution - a flat 8px is a bold stroke
 * on a preview and a hairline on the full-size composite.
 */
export const BRUSH_FRACTION = 0.012;

export function brushWidthFor(imageWidth: number, imageHeight: number): number {
  return Math.max(2, Math.round(Math.min(imageWidth, imageHeight) * BRUSH_FRACTION));
}

// -------------------------------------------------------------------
// Where a pointer actually landed on the picture
//
// The editor canvas is laid out with `object-fit: contain`, so the BITMAP is letterboxed
// inside the ELEMENT box whenever their aspect ratios differ - which is almost always, since
// the element is a flex child of a fixed-width column and the photo is whatever shape the
// camera produced.
//
// `getBoundingClientRect()` returns the ELEMENT box. Dividing by its width and height treats
// the whole frame, letterbox bars included, as if it were the picture - so the brush and the
// crop handles drift further from the cursor the further it gets from the centre. That was the
// bug: "the mouse coordinates of the entire picture frame are squashed to fit the picture".
// -------------------------------------------------------------------

export interface ElementBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A client-space point as a 0..1 fraction of the BITMAP drawn inside an `object-fit: contain`
 * element. Values outside 0..1 mean the point is on a letterbox bar rather than the picture.
 */
export function containFraction(
  clientX: number,
  clientY: number,
  box: ElementBox,
  bitmapWidth: number,
  bitmapHeight: number,
): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0 || bitmapWidth <= 0 || bitmapHeight <= 0) {
    return { x: 0, y: 0 };
  }
  // `contain` picks the scale that makes the bitmap fit BOTH dimensions, then centres it.
  const scale = Math.min(box.width / bitmapWidth, box.height / bitmapHeight);
  const drawnWidth = bitmapWidth * scale;
  const drawnHeight = bitmapHeight * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  const offsetY = (box.height - drawnHeight) / 2;
  return {
    x: (clientX - box.left - offsetX) / drawnWidth,
    y: (clientY - box.top - offsetY) / drawnHeight,
  };
}
