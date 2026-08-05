import { GameVersionEntry, currentVersion } from "libs";

// Version + change history. The version IS the newest entry here, so the two cannot drift
// and no version can be bumped without saying what changed - see libs/config/GameVersion.ts.
export const LEXIBLE_VERSION_HISTORY: GameVersionEntry[] = [
  {
    version: "0.1.0",
    changes: [
      "First tracked version - the numbering starts over here, on top of ClusterFun 0.5.0.",
      "Both teams now start in the left-hand column and race to the same edge, so the board is fair.",
      "Drag across letters to spell; dragging back along the word un-picks them.",
      "Tile colour shows how hard a tile is to take, and a team-coloured outline shows the chain that is actually joined to your side.",
      "Winning is a flood fill from your own edge tiles - it replaced a path search that painted a ten-second white wave across the board.",
      "Stealing a tile from the other team sets off a firework and an explosion.",
      "Pick how words are read out - the browser's voice or wah-wah - on the start screen.",
      "The how-to-play pages animate a real board instead of showing pictures.",
    ],
  },
];
export const LexibleVersion = currentVersion(LEXIBLE_VERSION_HISTORY);

export const PLAYTIME_MS = 900000000;
