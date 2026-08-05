import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const ONE_OH_ONE_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "Round-based racing game: everyone picks in secret, then the whole board is revealed at once.",
      "Computer players fill in for anybody who has dropped, so a round never stalls.",
    ],
  },
];
export const OneOhOneVersion = currentVersion(ONE_OH_ONE_VERSION_HISTORY);

// Game-wide tuning constants.  Track/rule constants live in oneOhOneLogic.ts.
export const ROUND_TIME_MS = 30000; // how long players get to pick each round
export const STEP_ANIMATION_MS = 90; // per-step reveal animation (one click per step)
export const PIECE_GAP_MS = 400; // pause between pieces during the reveal
export const COLLISION_PAUSE_MS = 300; // crash-sound beat before a backward slide
export const REVEAL_BUFFER_MS = 2000; // extra reveal time after the animation ends
