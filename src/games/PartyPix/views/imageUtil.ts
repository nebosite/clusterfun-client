// -------------------------------------------------------------------
// imageUtil
//
// Client-side photo downscaling. A captured camera file is huge; before it
// travels over the relay as base64 we shrink it to a bounded JPEG. Two sizes
// are produced per upload: a "full" for the slideshow and a small "thumb" for
// the phone's now-showing strip. `fitWithin` is pure and unit-tested; the rest
// is browser (canvas) glue.
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

// Downscale an already-decoded image to a bounded-edge JPEG data URL.
export function scaleImageToJpeg(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context available");
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Turn a captured file into { full, thumb } base64 JPEG data URLs.
export async function fileToUploadPair(
  file: File,
  fullEdge: number,
  thumbEdge: number,
  quality: number,
): Promise<{ full: string; thumb: string }> {
  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  return {
    full: scaleImageToJpeg(img, fullEdge, quality),
    thumb: scaleImageToJpeg(img, thumbEdge, quality),
  };
}
