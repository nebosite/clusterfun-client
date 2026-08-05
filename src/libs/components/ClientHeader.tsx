import React from "react";
import { GameVersionEntry } from "../config/GameVersion";
import { GameVersionTag } from "./GameVersionTag";
import { PlayerAvatar } from "./PlayerAvatar";
import styles from "./ClientHeader.module.css";

// ==========================================================================================
// The strip across the top of every phone.
//
// It was seven different strips before this, and they had drifted: different orders,
// different spacing, some with the version and some without, one that hid the game's name
// entirely in dev. A player who plays two games in an evening should not have to find the
// quit button twice.
//
// The layout is a FIXED GEOMETRY, 120px tall:
//
//   |<-- 360 -->|<--------- the rest --------->|<-- 120 -->|
//   |   title   |  avatar + name  (+ team)     |   quit    |
//
// Fixed regions rather than a flex negotiation, because the negotiating version could not be
// made to stop failing: cap the title and it clips, uncap it and the quit button falls off
// the end, put a floor under the name and it stops ellipsizing and gets cut mid-glyph. Three
// regions that cannot move cannot do any of that.
//
// The middle splits in two ONLY when the game has teams: avatar and name on top, team below.
// See ClientHeader.module.css for the padding each region keeps.
// ==========================================================================================

export interface ClientHeaderProps {
  /** The game's name, or its wordmark. Scaled to fit the 360px title region. */
  title: React.ReactNode;
  /** Newest entry first; the version in the phone's bottom corner comes from it. */
  history: GameVersionEntry[];
  /** A team chip, for games that have teams. Its presence splits the middle region. */
  team?: React.ReactNode;
  /** Background for the team chip - normally the team's own colour. */
  teamColor?: string;
  avatarId?: number;
  avatarColor?: number;
  playerName?: string;
  /** Leave undefined to hide the quit button (its region is still held). */
  onQuit?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Avatar sizes match the region heights in the stylesheet - see .middleSolo / .middleStacked. */
const AVATAR_SOLO = 80;
const AVATAR_STACKED = 48;

export function ClientHeader(props: ClientHeaderProps) {
  const hasTeam = !!props.team;

  const who = (
    <span className={styles.who}>
      {props.avatarId === undefined ? null : (
        <span className={styles.avatarSlot}>
          <PlayerAvatar
            avatarId={props.avatarId}
            colorIndex={props.avatarColor}
            size={hasTeam ? AVATAR_STACKED : AVATAR_SOLO}
          />
        </span>
      )}
      <span className={styles.playerName}>{props.playerName}</span>
    </span>
  );

  return (
    <div className={[styles.header, props.className].filter(Boolean).join(" ")} style={props.style}>
      <span className={styles.brand}>
        <span className={styles.titleSlot}>{props.title}</span>
      </span>

      <span
        className={[styles.middle, hasTeam ? styles.middleStacked : styles.middleSolo].join(" ")}
      >
        {who}
        {hasTeam ? (
          <span className={styles.team}>
            <span
              className={styles.teamChip}
              style={props.teamColor ? { background: props.teamColor } : undefined}
            >
              {props.team}
            </span>
          </span>
        ) : null}
      </span>

      <span className={styles.quitFrame}>
        {props.onQuit ? (
          <button className={styles.quit} onClick={props.onQuit} aria-label="Quit the game">
            X
          </button>
        ) : null}
      </span>

      <GameVersionTag history={props.history} className={styles.versionCorner} />
    </div>
  );
}
