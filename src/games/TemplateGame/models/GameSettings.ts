import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const TEMPLATE_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "The starting point for a new game. Copy this folder and rename everything in it.",
    ],
  },
];
export const TemplateVersion = currentVersion(TEMPLATE_VERSION_HISTORY);

// Game-wide tuning constants.  Keep every magic number here so a game designer can
// re-balance the game without hunting through logic files.
export const PLAYTIME_MS = 90000;
