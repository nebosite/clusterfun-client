import { IStorage } from "../storage/StorageHelper";

// ==========================================================================================
// A stable, anonymous per-browser id.
//
// GA4 keeps its own client id, but we cannot read it back, and the Test Lobby runs five
// participants in ONE browser - so we need an id of our own to tell "one device joined
// twice" apart from "two devices joined once each".
//
// Deliberately random and meaningless: no name, no ip, nothing derived from the user.  It
// is a coin flip we remember, and clearing site data resets it.
// ==========================================================================================

export const DEVICE_ID_KEY = "clusterfun_device_id";

function randomId(): string {
  const globalCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  if (globalCrypto?.getRandomValues) {
    const bytes = globalCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last resort (old browsers, some test environments)
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e12).toString(36)}`;
}

// Read the device id, minting one the first time.  Storage failures (private mode, a full
// quota) must never take the app down, so a throwing storage just yields a fresh id that
// lasts for this page load.
export function getDeviceId(storage: IStorage): string {
  try {
    const existing = storage.get(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = randomId();
    storage.set(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}
