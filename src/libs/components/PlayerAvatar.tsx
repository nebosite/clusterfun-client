import React from "react";
import avatarSheet from "./assets/avatars.png";

// The palette players pick from in the lobby.  The chosen INDEX travels with
// the Join message (ClusterFunPlayer.avatarColor), so every game can draw a
// player's mark in their own color.
export const AVATAR_COLORS = [
  "#ff4d6d",
  "#22e0ff",
  "#ffd21a",
  "#7c5cff",
  "#ff7a1a",
  "#2ee6c8",
  "#ff3ea5",
  "#b6ff3a",
  "#4d8bff",
  "#ff5cc8",
  "#ffb020",
  "#12b8ff",
];

export function avatarColorFor(colorIndex: number | undefined): string {
  const count = AVATAR_COLORS.length;
  if (colorIndex === undefined) return AVATAR_COLORS[0];
  return AVATAR_COLORS[((colorIndex % count) + count) % count];
}

// The avatar sprite sheet: 6 columns x 5 rows of icon silhouettes
// (apple, key, bicycle, ... beach ball).  White art on transparency, so it
// reads on any chip color.
const SHEET_COLS = 6;
const SHEET_ROWS = 5;
export const AVATAR_COUNT = SHEET_COLS * SHEET_ROWS;

// -------------------------------------------------------------------
// PlayerAvatar - the standard player mark.
//
// Players pick a shape AND a color in the lobby; both travel with the
// Join message and land on ClusterFunPlayer (avatarId / avatarColor), so
// every game can show who's who.  Render it next to player names anywhere
// players appear (join lists, scoreboards, winner screens...).
//
//   <PlayerAvatar avatarId={player.avatarId} colorIndex={player.avatarColor} size={48} />
//
// The sprite is used as a MASK, so the icon itself is painted in the
// player's color - no chip, no background.  `tone` overrides that color
// outright (e.g. a team color).
// -------------------------------------------------------------------
export function PlayerAvatar(props: {
  avatarId: number;
  colorIndex?: number;
  size?: number;
  tone?: string;
}) {
  const safeId = ((props.avatarId % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  const color = props.tone ?? avatarColorFor(props.colorIndex);
  const size = props.size ?? 40;

  const col = safeId % SHEET_COLS;
  const row = Math.floor(safeId / SHEET_COLS);
  // Percentage positioning handles the sheet's non-integer cell width
  const maskSize = `${SHEET_COLS * 100}% ${SHEET_ROWS * 100}%`;
  const maskPosition = `${(col / (SHEET_COLS - 1)) * 100}% ${(row / (SHEET_ROWS - 1)) * 100}%`;

  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        backgroundColor: color,
        // -webkit- prefixes matter here: iOS Safari is a primary target
        WebkitMaskImage: `url(${avatarSheet})`,
        maskImage: `url(${avatarSheet})`,
        WebkitMaskSize: maskSize,
        maskSize: maskSize,
        WebkitMaskPosition: maskPosition,
        maskPosition: maskPosition,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    />
  );
}
