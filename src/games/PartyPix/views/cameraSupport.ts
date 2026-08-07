// -------------------------------------------------------------------
// cameraSupport
//
// Which of the two "Take a Photo" paths to use, and how to walk between cameras
// when a machine has more than one. Pure, so the decision can be pinned by a
// test - it is the kind of branch that silently regresses into "always the file
// picker" and looks fine on the machine of whoever changed it.
// -------------------------------------------------------------------

/**
 * True when the shutter should open an IN-APP camera (getUserMedia + a live preview)
 * rather than a file input.
 *
 * A phone keeps the file input: `capture="environment"` hands over to the real camera
 * app, which beats anything we can draw - better optics handling, orientation, and no
 * second permission prompt.
 *
 * A PC does NOT. `capture` is simply ignored on desktop, so "Take a Photo" opened a
 * file browser - which is the other button. Two buttons, one behaviour.
 */
export function shouldUseInAppCamera(isMobile: boolean, hasGetUserMedia: boolean): boolean {
  if (!hasGetUserMedia) return false; // no API (or an insecure origin): nothing to open
  return !isMobile;
}

/**
 * The next camera to try, cycling. Returns 0 for an empty or single list so a caller
 * can call this without guarding first.
 */
export function nextDeviceIndex(current: number, count: number): number {
  if (count <= 1) return 0;
  const safe = Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0;
  return (safe + 1) % count;
}
