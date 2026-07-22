// Game-wide tuning constants.  Keep every magic number here so a game designer can
// re-balance Mixtape without hunting through logic files.
export const MixtapeVersion = "0.1.0";

// Scoring / win condition
export const DEFAULT_TARGET_SCORE = 5;
export const MIN_TARGET_SCORE = 1;
export const MAX_TARGET_SCORE = 15;

// Playback timeline (presenter jukebox)
export const SONG_PLAY_MS = 30000; // play 30s of each song
export const METADATA_REVEAL_MS = 5000; // hide title/artist/art for the first 5s

// Voting
export const MAX_BALLOT = 3; // rank your top 3

// Tally animation pacing (one IRV elimination step per interval)
export const TALLY_STEP_MS = 2400;
export const TALLY_TAIL_MS = 3000; // linger on the winner before the scoreboard

// Search (client-side)
export const MAX_SEARCH_RESULTS = 12;
export const MAX_QUERY_LEN = 120;
