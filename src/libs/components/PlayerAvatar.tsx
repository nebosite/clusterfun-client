import React from "react";

// Grayscale tones for the neutral avatar shapes - a player's accent color
// (when a game supplies one) provides the pop, not the shape.
const AVATAR_TONES = ["#d4d6dd", "#9296a6", "#f2f3f6"];

export const AVATAR_COUNT = 8;

// -------------------------------------------------------------------
// PlayerAvatar - the standard player avatar mark.
//
// Players pick one of these 8 abstract shapes in the lobby when they
// join; the chosen index travels with the Join message and lands on
// ClusterFunPlayer.avatarId, so every game can show who's who.  Render
// this next to player names anywhere players appear (join lists,
// scoreboards, winner screens...).
//
//   <PlayerAvatar avatarId={player.avatarId} size={48} />
//
// `tone` optionally overrides the shape's fill (e.g. a team color);
// `cut` is the punch-out detail color and defaults to a near-black.
// -------------------------------------------------------------------
export function PlayerAvatar(props: {
  avatarId: number;
  size?: number;
  tone?: string;
  cut?: string;
}) {
  const safeId = ((props.avatarId % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT;
  const tone = props.tone ?? AVATAR_TONES[safeId % AVATAR_TONES.length];
  const cut = props.cut ?? "#12121a";
  const size = props.size ?? 40;

  const shape = () => {
    switch (safeId) {
      case 0:
        return (
          <>
            <circle cx="20" cy="20" r="16" fill={tone} />
            <circle cx="20" cy="20" r="6" fill={cut} />
          </>
        );
      case 1:
        return (
          <>
            <rect x="5" y="5" width="30" height="30" rx="8" fill={tone} />
            <circle cx="20" cy="20" r="7" fill={cut} />
          </>
        );
      case 2:
        return (
          <>
            <polygon points="20,4 36,34 4,34" fill={tone} />
            <circle cx="20" cy="25" r="5" fill={cut} />
          </>
        );
      case 3:
        return (
          <>
            <polygon points="20,3 37,20 20,37 3,20" fill={tone} />
            <rect x="14" y="14" width="12" height="12" fill={cut} />
          </>
        );
      case 4:
        return (
          <>
            <circle cx="20" cy="20" r="16" fill={tone} />
            <circle cx="20" cy="20" r="9" fill={cut} />
          </>
        );
      case 5:
        return (
          <>
            <rect x="6" y="8" width="28" height="10" rx="5" fill={tone} />
            <rect x="6" y="22" width="28" height="10" rx="5" fill={tone} />
          </>
        );
      case 6:
        return (
          <>
            <circle cx="13" cy="13" r="8" fill={tone} />
            <circle cx="27" cy="13" r="8" fill={tone} />
            <circle cx="13" cy="27" r="8" fill={tone} />
            <circle cx="27" cy="27" r="8" fill={tone} />
          </>
        );
      default:
        return (
          <>
            <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" fill={tone} />
            <circle cx="20" cy="20" r="6" fill={cut} />
          </>
        );
    }
  };

  return (
    <svg viewBox="0 0 40 40" width={size} height={size} style={{ verticalAlign: "middle" }}>
      {shape()}
    </svg>
  );
}
