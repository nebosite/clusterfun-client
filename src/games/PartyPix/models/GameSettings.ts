// PartyPix tuning constants. The economy rules that consume these live in
// partyPixLogic.ts (pure + unit-tested); the image sizes are used by the
// client's imageUtil when downscaling before upload.

export const PartyPixVersion = "0.1.0";

// --- Economy ---
export const START_CREDITS = 3; // photo credits every player begins with
export const UPLOAD_COST = 1; // credits spent per uploaded photo
export const UPVOTES_PER_CREDIT = 3; // upvotes received per +1 earned credit
export const CREDIT_CAP = 9; // soft cap so credits can't be hoarded

// --- Slideshow ---
export const SLIDE_INTERVAL_MS = 6000; // dwell time per photo on the big screen

// --- Moderation ---
export const BASE_DELETE_THRESHOLD = 3; // min flags to auto-remove a photo
export const DELETE_PLAYER_FRACTION = 0.4; // ...or this fraction of players, whichever is larger

// --- Image downscaling (client-side, before base64 over the relay) ---
export const MAX_IMAGE_EDGE = 1200; // long edge of the full slideshow image
export const THUMB_IMAGE_EDGE = 256; // long edge of the phone "now showing" thumbnail
export const JPEG_QUALITY = 0.7;
