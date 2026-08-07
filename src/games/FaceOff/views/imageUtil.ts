// -------------------------------------------------------------------
// imageUtil — client-side photo downscaling for FaceOff.
//
// A captured frame (live camera or picked file) is huge; before it travels over the relay as
// base64 it is shrunk to a bounded JPEG. Two sizes per submission: a "full" for the big-screen
// reveal and a small "thumb" for the phone voting pairs. `fitWithin`/`dataUrlByteLength` are
// pure and unit-tested; the canvas/camera parts are browser glue.
//
// The full image targets a byte budget by keeping resolution high and stepping JPEG quality
// DOWN toward the target (never below a floor) — trading quality, not sharpness, to hit size.
// Copied from PartyPix's imageUtil, plus `videoFrameToUploadPair` for the live-camera path.
// -------------------------------------------------------------------

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

// Decoded byte length of a base64 data URL (the actual JPEG size, ignoring the header).
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

// Downscale a source (already-sized) canvas-drawable of natural width/height to a bounded box.
function drawScaled(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  maxEdge: number,
): HTMLCanvasElement {
  const { width, height } = fitWithin(naturalWidth, naturalHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context available");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL("image/jpeg", quality);
}

function canvasToJpegUnderSize(
  canvas: HTMLCanvasElement,
  targetBytes: number,
  startQuality: number,
  minQuality: number,
  qualityStep: number,
): string {
  let quality = startQuality;
  let out = canvasToJpeg(canvas, quality);
  while (dataUrlByteLength(out) > targetBytes && quality > minQuality + 1e-9) {
    quality = Math.max(minQuality, Math.round((quality - qualityStep) * 100) / 100);
    out = canvasToJpeg(canvas, quality);
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

function pairFrom(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  opts: UploadImageOptions,
): { full: string; thumb: string } {
  const fullCanvas = drawScaled(source, naturalWidth, naturalHeight, opts.fullEdge);
  const thumbCanvas = drawScaled(source, naturalWidth, naturalHeight, opts.thumbEdge);
  return {
    full: canvasToJpegUnderSize(
      fullCanvas,
      opts.targetBytes,
      opts.startQuality,
      opts.minQuality,
      opts.qualityStep,
    ),
    thumb: canvasToJpeg(thumbCanvas, opts.thumbQuality),
  };
}

// Turn a picked file into { full, thumb } base64 JPEG data URLs (desktop / no-camera path).
export async function fileToUploadPair(
  file: File,
  opts: UploadImageOptions,
): Promise<{ full: string; thumb: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  return pairFrom(img, img.naturalWidth, img.naturalHeight, opts);
}

// Grab the current frame from a live <video> element into { full, thumb } (the SnapNow path).
export function videoFrameToUploadPair(
  video: HTMLVideoElement,
  opts: UploadImageOptions,
): { full: string; thumb: string } {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera has no frame yet");
  return pairFrom(video, w, h, opts);
}
