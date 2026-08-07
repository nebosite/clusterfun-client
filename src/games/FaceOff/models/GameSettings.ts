// Game-wide tuning constants. Keep every magic number here so the game can be
// re-balanced without hunting through the logic files.

export const FaceOffVersion = "0.1.0";

// ---- Flow / rounds ---------------------------------------------------------
export const TOTAL_ROUNDS = 5;
export const MIN_PLAYERS = 4; // need >= 2 matchups so every matchup has an outside voter
export const MAX_PLAYERS = 12;

// ---- Phase timers (ms) -----------------------------------------------------
export const CAPTURE_COUNTDOWN_MS = 6000; // live framing + 3-2-1 before the snap
export const CAPTURE_COLLECT_GRACE_MS = 4000; // wait for uploads to land after the snap
export const VOTE_TIME_MS = 25000; // parallel voting window
export const REVEAL_PER_MATCHUP_MS = 5000; // big-screen dwell per revealed matchup
export const ROUND_SCOREBOARD_MS = 8000; // standings between rounds

// ---- Scoring ---------------------------------------------------------------
export const POINTS_PER_VOTE = 100;
export const WIN_BONUS = 200; // to the winner(s) of a matchup

// ---- Image transport (mirrors PartyPix's imageUtil budget) -----------------
export const MAX_IMAGE_EDGE = 1200; // full image long-edge cap
export const THUMB_IMAGE_EDGE = 256; // phone voting thumbnail
export const TARGET_IMAGE_BYTES = 110000; // ~110 KB byte budget for the full JPEG
export const JPEG_QUALITY_START = 0.72;
export const JPEG_QUALITY_MIN = 0.4;
export const JPEG_QUALITY_STEP = 0.08;
export const THUMB_JPEG_QUALITY = 0.6;
