import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const STRESSATO_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "A load test for the relay, not a game: it measures how much traffic a room can carry.",
    ],
  },
];
export const StressatoVersion = currentVersion(STRESSATO_VERSION_HISTORY);

export const PLAYTIME_MS = 90000;
