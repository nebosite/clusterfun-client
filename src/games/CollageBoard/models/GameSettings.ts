// Game-wide tuning constants.  Keep every magic number here so a game designer can
// re-balance the game without hunting through logic files.
import { GameVersionEntry, currentVersion } from "libs";

// The version IS the newest entry here - see libs/config/GameVersion.ts.  Newest FIRST.
export const COLLAGE_BOARD_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First release: claim an outline on the shared board and fill it with a photo.",
      "Photos are clipped to the outline's polygon and composited into one growing collage.",
      "Framing editor on the phone with pan, zoom and tilt before the shot is committed.",
    ],
  },
];
export const CollageBoardVersion = currentVersion(COLLAGE_BOARD_VERSION_HISTORY);

// The shared canvas is a 16:9 surface addressed in normalized 0..1 x 0..1 coordinates.
export const CANVAS_ASPECT = 16 / 9;

// Zone outlines (all in normalized board units)
export const MIN_ZONE_POINTS = 3;
export const MAX_ZONE_POINTS = 48;
export const MIN_ZONE_AREA = 0.0005; // 0.05% of the board
export const SIMPLIFY_EPSILON = 0.003;
export const ZONE_LIFETIME_MS = 120_000; // abandoned claims expire after 2 minutes

// Committed patch images (JPEG of the zone's bounding box)
export const PATCH_MAX_EDGE = 1280;
export const PATCH_TARGET_BYTES = 120_000;
export const JPEG_QUALITY_START = 0.85;
export const JPEG_QUALITY_MIN = 0.3;
export const JPEG_QUALITY_STEP = 0.1;
// Reject grossly oversized commit payloads outright (base64 chars, ~600 KB decoded)
export const MAX_COMMIT_IMAGE_CHARS = 900_000;
// Soft cap on stored patches; oldest (long since painted over) fall off first
export const MAX_PATCHES = 400;

// The downscaled composite pushed to phones for navigation
export const PREVIEW_WIDTH = 960;
export const PREVIEW_HEIGHT = 540;
export const PREVIEW_QUALITY = 0.55;
export const PREVIEW_PUSH_MIN_INTERVAL_MS = 1500;

// Max zoom on the phone's board view
export const MAX_VIEW_ZOOM = 8;

// Camera/edit screen "context" framing: pad the zone's bounding box out so
// the view also shows some of the surrounding collage, to line a new shot
// up against what's already there. Margin is boardAspect*height-fraction
// units (see contextBounds); factor is relative to the zone's own size,
// minMargin is a floor so tiny zones still get real context.
export const CONTEXT_MARGIN_FACTOR = 0.6;
export const CONTEXT_MIN_MARGIN = 0.05;

// Identity colors, assigned least-used-first on join.  maxPlayers equals the
// palette size so every player in a room gets a unique color.
export const PLAYER_COLORS = [
  "#FF5252", // red
  "#FFB300", // amber
  "#FFEE33", // yellow
  "#66DD44", // green
  "#22CCBB", // teal
  "#33AAFF", // sky
  "#7766FF", // violet
  "#CC66FF", // purple
  "#FF66CC", // pink
  "#FF8844", // orange
  "#99EE99", // mint
  "#FFFFFF", // white
];
