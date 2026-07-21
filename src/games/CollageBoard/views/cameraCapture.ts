// -------------------------------------------------------------------
// cameraCapture
//
// Browser glue for the client's camera screen: start/stop a getUserMedia
// stream, cover-crop a video frame (or a picked file, the desktop/dev
// fallback) into the zone bounding box's aspect, and encode it as a JPEG
// under a byte budget.  The pure math (cover crop, output sizing) lives in
// collageBoardLogic; the byte-budget stepping mirrors PartyPix's imageUtil.
// -------------------------------------------------------------------
import { coverSourceRect } from "../models/collageBoardLogic";

// Decoded byte length of a base64 data URL (ignores the header).
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (b64.length === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// -------------------------------------------------------------------
// startCamera - open the rear camera.  Throws if unavailable/denied;
// callers fall back to a file picker.
// -------------------------------------------------------------------
export async function startCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera API not available");
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

// -------------------------------------------------------------------
// captureCover - draw a source (video frame or image) into an offscreen
// canvas of outW x outH, cover-cropped (centered, overflow trimmed).
// -------------------------------------------------------------------
export function captureCover(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context available");
  const { sx, sy, sw, sh } = coverSourceRect(srcW, srcH, outW, outH);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas;
}

// -------------------------------------------------------------------
// canvasToJpegUnderSize - step JPEG quality down from startQuality toward
// targetBytes, never below minQuality (trade quality, not resolution).
// -------------------------------------------------------------------
export function canvasToJpegUnderSize(
  canvas: HTMLCanvasElement,
  targetBytes: number,
  startQuality: number,
  minQuality: number,
  qualityStep: number,
): string {
  let quality = startQuality;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (dataUrlByteLength(out) > targetBytes && quality > minQuality + 1e-9) {
    quality = Math.max(minQuality, Math.round((quality - qualityStep) * 100) / 100);
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

// -------------------------------------------------------------------
// loadImageFromFile - the desktop/dev fallback path: a picked file
// decoded into an image element for captureCover.
// -------------------------------------------------------------------
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
