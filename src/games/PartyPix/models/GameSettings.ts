import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const PARTY_PIX_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.2.0",
    changes: [
      "The presenter always starts on the setup screen now - it used to reconnect a remembered folder and jump straight into the previous party's slideshow.",
      "If a party from the last 24 hours is found, the setup screen offers to continue it; anything older is left alone and you start fresh.",
      "Phones can auto-save the photos they take to the device as well as sending them to the big screen.",
      "'Take a Photo' opens a real camera on a PC instead of a file browser.",
      "The phone screen is three fixed bands - what you have on top, the picture as big as it will go in the middle, whose it is and how you vote at the bottom.",
      "Flagging a photo is confirmed in a dialog over the picture rather than a list at the bottom of the screen.",
    ],
  },
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "Take photos on your phone, vote on everybody else's, and watch the slideshow on the big screen.",
      "Photo credits are earned back as your pictures get upvoted.",
      "Anybody can flag a photo out of rotation; the presenter decides whether it comes back.",
    ],
  },
];
export const PartyPixVersion = currentVersion(PARTY_PIX_VERSION_HISTORY);

// PartyPix tuning constants. The economy rules that consume these live in
// partyPixLogic.ts (pure + unit-tested); the image sizes are used by the
// client's imageUtil when downscaling before upload.

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

/**
 * How long a finished party stays offerable as "continue the last party".
 *
 * The presenter is started fresh for each party, so finding photos in the folder is not on its
 * own a reason to resume - last month's pictures are not this evening's party. Within a day it
 * almost certainly IS the same party (the host closed the tab, the browser crashed, the Pi
 * restarted); past that, starting clean is the safer default. The files are never touched
 * either way.
 */
export const PARTY_RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

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
