// Game-wide tuning constants.  Keep every magic number here so a game designer can
// re-balance Mixtape without hunting through logic files.
export const MixtapeVersion = "0.1.0";

// Scoring / win condition
export const DEFAULT_TARGET_SCORE = 5;
export const MIN_TARGET_SCORE = 1;
export const MAX_TARGET_SCORE = 15;

// Playback timeline (presenter jukebox)
export const SONG_PLAY_MS = 30000; // play 30s of each song
// Reveal the title/artist this long AFTER audio actually starts (not stage start - buffering
// would otherwise eat into the mystery).  The reveal timer is armed on the real playback-start
// event (YouTube "PLAYING"), so a slow buffer no longer shortens the hidden window.
export const METADATA_REVEAL_MS = 8000;
// The metadata cross-fade duration.  On song advance the OLD metadata fades out fully over
// this window before the display swaps to the next track, so the next track's title never
// flashes mid-fade.  Matches the CSS `.meta` opacity transition.
export const METADATA_FADE_MS = 1000;
// 1s audio fade-in on playback start and fade-out at the end of each song's window.
export const AUDIO_FADE_MS = 1000;
// Client fine-tune preview: when a player scrubs their start time, play this much of the
// track from that offset so they can hear where it begins.
export const CLIENT_PREVIEW_MS = 5000;

// Voting
export const MAX_BALLOT = 3; // rank your top 3

// Tally animation pacing (one IRV elimination step per interval)
export const TALLY_STEP_MS = 2400;
export const TALLY_TAIL_MS = 3000; // linger on the winner before the scoreboard

// Search (client-side)
export const MAX_SEARCH_RESULTS = 12;
export const MAX_QUERY_LEN = 120;
