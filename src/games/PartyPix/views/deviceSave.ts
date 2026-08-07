// -------------------------------------------------------------------
// deviceSave
//
// Keeping a copy of a photo on the phone that took it.
//
// A web page CANNOT write to the device's photo gallery. There is no API for it, on any
// browser, by design. The two things a page can do:
//
//   1. `navigator.share({ files })` - hands the image to the OS share sheet, which on iOS and
//      Android includes "Save Image" / "Save to Photos". This is the one route that actually
//      reaches the gallery, and it needs a user gesture.
//   2. A download link - lands in Downloads on Android and in Files on iOS. Always available,
//      never reaches Photos on its own.
//
// So: share when the platform can, download when it cannot, and say so honestly in the UI.
// Anything that promised "saves to your gallery" unconditionally would be a lie on desktop and
// on every browser without the share target.
// -------------------------------------------------------------------

/** Decoded bytes of a base64 data URL, as a Blob of its declared type. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** True when the OS share sheet will accept an image file - the only path to the gallery. */
export function canShareToGallery(): boolean {
  try {
    if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
    const probe = new File([new Uint8Array([0])], "probe.jpg", { type: "image/jpeg" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export type DeviceSaveResult = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Keep a copy of `dataUrl` on this device.
 *
 * MUST be called from within a user gesture - the share sheet will refuse otherwise, and an
 * await before this point is enough to lose that. The caller does it on the button press,
 * before the upload is awaited.
 */
export async function savePhotoToDevice(
  dataUrl: string,
  fileName: string,
): Promise<DeviceSaveResult> {
  let blob: Blob;
  try {
    blob = dataUrlToBlob(dataUrl);
  } catch {
    return "failed";
  }

  if (canShareToGallery()) {
    try {
      await navigator.share({ files: [new File([blob], fileName, { type: blob.type })] });
      return "shared";
    } catch (err) {
      // Dismissing the sheet throws AbortError. That is the player saying no, not a failure,
      // and falling through to a silent download would be doing it anyway behind their back.
      if ((err as { name?: string })?.name === "AbortError") return "cancelled";
      // Anything else: the sheet was unavailable after all, so fall through to the download.
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a later turn: revoking immediately races the download starting in some
    // browsers and produces a zero-byte file.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

/** `partypix-2026-08-07-1930.jpg` - sorts chronologically in a gallery or a Downloads folder. */
export function deviceFileName(when: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `partypix-${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}-${p(
    when.getHours(),
  )}${p(when.getMinutes())}${p(when.getSeconds())}.jpg`;
}
