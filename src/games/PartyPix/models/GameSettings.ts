// PartyPix tuning constants. The economy rules that consume these live in
// partyPixLogic.ts (pure + unit-tested); the image sizes are used by the
// client's imageUtil when downscaling before upload.

export const PartyPixVersion = "0.1.0";

// --- Economy ---
export const START_CREDITS = 3; // photo credits every player begins with
export const UPLOAD_COST = 1; // credits spent per uploaded photo
// Bonus credit granted as a photographer's cumulative upvotes cross each of
// these milestones (so 2 upvotes → +1, 5 → +1 more, 20 → +1 more). No further
// bonus credits past the last milestone.
export const CREDIT_UPVOTE_MILESTONES = [2, 5, 20];
export const CREDIT_CAP = 9; // soft cap so credits can't be hoarded

// --- Slideshow ---
export const SLIDE_INTERVAL_MS = 6000; // dwell time per photo on the big screen

// --- Moderation ---
// A single flag pulls a photo out of rotation (into the presenter's flagged
// holding area). If the presenter "OK"s a flagged photo it returns to rotation
// but then needs this many flags to be pulled again.
export const FLAG_THRESHOLD_DEFAULT = 1;
export const FLAG_THRESHOLD_APPROVED = 3;

// --- Image downscaling (client-side, before base64 over the relay) ---
// The full image keeps a high resolution and trades JPEG quality to land near a
// byte budget: quality starts high and steps down toward TARGET_IMAGE_BYTES, but
// never below JPEG_QUALITY_MIN. Raise MAX_IMAGE_EDGE for even more resolution.
export const MAX_IMAGE_EDGE = 1600; // long edge of the full slideshow image
export const THUMB_IMAGE_EDGE = 256; // long edge of the phone "now showing" thumbnail
export const TARGET_IMAGE_BYTES = 100 * 1024; // aim ~100 KB for the full image
export const JPEG_QUALITY_START = 0.82; // start high...
export const JPEG_QUALITY_MIN = 0.3; // ...but never trade quality below 30%
export const JPEG_QUALITY_STEP = 0.06; // quality decrement per size-check pass
export const THUMB_JPEG_QUALITY = 0.6; // thumbnails are tiny; fixed quality
