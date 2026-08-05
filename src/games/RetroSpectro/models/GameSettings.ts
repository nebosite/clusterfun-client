import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const RETROSPECTRO_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "A team retrospective: everyone writes cards on their phone, then the group sorts them together.",
      "Play again now keeps everybody's seat instead of rebuilding the player list.",
    ],
  },
];
export const RetroSpectroVersion = currentVersion(RETROSPECTRO_VERSION_HISTORY);

export const SETTING_ANSWER_CHARACTER_LIMIT = 60;
export const ANSWER_STAGE_TIME_MS = 180000;
