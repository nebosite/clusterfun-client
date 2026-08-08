import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const BIDBOTS_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - a Dutch-auction auto-battler built on ClusterFun 0.5.0.",
      "Auction bots on a falling price, then brawl them last-team-standing for round wins.",
    ],
  },
];
export const BidBotsVersion = currentVersion(BIDBOTS_VERSION_HISTORY);

// ==========================================================================================
// Game-wide tuning constants.  Keep every magic number here so a designer can re-balance
// without hunting through logic files.  See DESIGN.md for the reasoning behind each.
// ==========================================================================================

// --- The auction (Dutch / descending price) ---
export const START_PRICE = 1000; // every bot opens here...
export const DROP_PER_SECOND = 100; // ...and falls this much per second (hits $0 in 10s)
export const PRICE_FLOOR = 0; // price never drops below this
export const SCRAP_GRACE_MS = 1200; // time sitting at the floor with no buyer before SCRAPPED
export const VERIFY_WINDOW_MS = 700; // after the first BUY, how long to collect near-tie taps
export const REVEAL_MS = 1500; // how long the SOLD / SCRAPPED reveal holds before the next bot

// --- Budget ---
export const ROUND_BUDGET = 1000; // added to every player's bank at the start of each round

// --- Round shape ---
export const WINS_TO_WIN = 3; // first player to this many round-wins is champion
export const FIGHTERS_PER_PLAYER = 1.5; // bots auctioned per round scale to the field...
export const MIN_FIGHTERS = 3; // ...clamped to this range
export const MAX_FIGHTERS = 12;

// --- Fighter stat ranges (inclusive) ---
export const HP_MIN = 20;
export const HP_MAX = 60;
export const STR_MIN = 5;
export const STR_MAX = 15;
export const DEF_MIN = 0;
export const DEF_MAX = 8;

// --- Battle playback ---
// The pure sim runs in abstract "steps"; the presenter stretches the whole fight to land
// inside this window so a tiny brawl is not over in a blink and a huge one is not a slog.
export const BATTLE_MIN_MS = 8000;
export const BATTLE_MAX_MS = 15000;
export const PER_EVENT_MS = 220; // nominal ms per blow; total is clamped to the min/max above
export const BATTLE_PUSH_MS = 200; // how often the presenter pushes an HP snapshot to phones
export const BATTLE_RESULT_HOLD_MS = 4000; // round-winner banner hold before the next round
