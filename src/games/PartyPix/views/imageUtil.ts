// -------------------------------------------------------------------
// imageUtil
//
// Client-side photo downscaling. A captured camera file is huge; before it
// travels over the relay as base64 we shrink it to a bounded JPEG. Two sizes
// are produced per upload: a "full" for the slideshow and a small "thumb" for
// the phone's now-showing strip. `fitWithin` and `dataUrlByteLength` are pure
// and unit-tested; the canvas encoding is browser glue.
//
// The full image targets a byte budget (~100 KB) by keeping the resolution high
// and stepping JPEG quality DOWN toward the target — never below a floor — so
// we trade quality, not sharpness, to hit the size.
// -------------------------------------------------------------------

// New (width,height) that fits inside a maxEdge box, preserving aspect ratio.
// Never upscales.
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Decoded byte length of a base64 data URL (the actual JPEG size, ignoring the
// data-URL header). Used to steer quality toward the size budget.
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (b64.length === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

function drawScaled(img: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context available");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

// Downscale an already-decoded image to a bounded-edge JPEG data URL at a fixed
// quality (used for the tiny thumbnail).
export function scaleImageToJpeg(img: HTMLImageElement, maxEdge: number, quality: number): string {
  return drawScaled(img, maxEdge).toDataURL("image/jpeg", quality);
}

// Downscale to a bounded edge, then step JPEG quality down from `startQuality`
// toward `targetBytes`, never below `minQuality`. Resolution is fixed at maxEdge
// — only quality flexes. Returns the first encoding at or under the target, or
// the minQuality encoding if even that is larger (best effort, high resolution).
export function scaleImageToJpegUnderSize(
  img: HTMLImageElement,
  maxEdge: number,
  targetBytes: number,
  startQuality: number,
  minQuality: number,
  qualityStep: number,
): string {
  const canvas = drawScaled(img, maxEdge);
  let quality = startQuality;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlByteLength(out) > targetBytes && quality > minQuality + 1e-9) {
    quality = Math.max(minQuality, Math.round((quality - qualityStep) * 100) / 100);
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export interface UploadImageOptions {
  fullEdge: number;
  thumbEdge: number;
  targetBytes: number;
  startQuality: number;
  minQuality: number;
  qualityStep: number;
  thumbQuality: number;
}

// Turn a captured file into { full, thumb } base64 JPEG data URLs. The full
// image trades quality (down to a floor) to approach the byte budget; the thumb
// is tiny at a fixed quality.
export async function fileToUploadPair(
  file: File,
  opts: UploadImageOptions,
): Promise<{ full: string; thumb: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  return {
    full: scaleImageToJpegUnderSize(
      img,
      opts.fullEdge,
      opts.targetBytes,
      opts.startQuality,
      opts.minQuality,
      opts.qualityStep,
    ),
    thumb: scaleImageToJpeg(img, opts.thumbEdge, opts.thumbQuality),
  };
}
