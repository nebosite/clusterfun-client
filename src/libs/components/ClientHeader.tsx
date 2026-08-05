import React from "react";
import { GameVersionEntry } from "../config/GameVersion";
import { GameVersionTag } from "./GameVersionTag";
import { PlayerAvatar } from "./PlayerAvatar";
import styles from "./ClientHeader.module.css";

// ==========================================================================================
// The strip across the top of every phone.
//
// It was seven different strips before this, one per game, and they had drifted: different
// orders, different spacing, some with the version and some without, one that hid the game's
// name entirely in dev.  A player who plays two games in an evening should not have to find
// the quit button twice.
//
// Left to right, always:
//
//   [ name + version ]  ....gap....  [ team ][ avatar + name ]  ....gap....  [ X ]
//
// The two gaps are flexible and equal, so the row fills the width at any phone size and the
// three groups stay put as the contents change length.  The team slot is ALWAYS rendered,
// even for a game with no teams - otherwise the player's own name jumps sideways depending on
// whether teams exist, and the eye has to find it again.
// ==========================================================================================

export interface ClientHeaderProps {
  /** The game's name, or its wordmark. */
  title: React.ReactNode;
  /** Newest entry first; the version beside the title comes from it. */
  history: GameVersionEntry[];
  /** A team chip, for games that have teams. The slot is reserved either way. */
  team?: React.ReactNode;
  /** Background for the team chip - normally the team's own colour. */
  teamColor?: string;
  avatarId?: number;
  avatarColor?: number;
  avatarSize?: number;
  playerName?: string;
  /** Leave undefined to hide the quit button (its space is still held). */
  onQuit?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ClientHeader(props: ClientHeaderProps) {
  return (
    <div className={[styles.header, props.className].filter(Boolean).join(" ")} style={props.style}>
      <span className={styles.brand}>
        <span className={styles.titleSlot}>{props.title}</span>
      </span>

      <span className={styles.gap} />

      {/* Always present. An empty chip holds the space so the player's own name does not
          shift sideways between a game with teams and a game without. */}
      <span
        className={styles.team}
        style={props.team && props.teamColor ? { background: props.teamColor } : undefined}
      >
        {props.team}
      </span>

      <span className={styles.who}>
        {props.avatarId === undefined ? null : (
          <PlayerAvatar
            avatarId={props.avatarId}
            colorIndex={props.avatarColor}
            size={props.avatarSize ?? 56}
          />
        )}
        <span className={styles.playerName}>{props.playerName}</span>
      </span>

      <span className={styles.gap} />

      {props.onQuit ? (
        <button className={styles.quit} onClick={props.onQuit} aria-label="Quit the game">
          X
        </button>
      ) : (
        <span className={styles.quitPlaceholder} />
      )}

      {/* The version sits in the BOTTOM-RIGHT of the phone, not in this row.
          It is worth having and it is not worth a single pixel of the top strip: at EITtris'
          header font "v0.1.0" cost 178 of the row's 1060, which is a third of the game's
          wordmark. Down here it competes with nothing.

          `fixed` rather than `absolute`: the client is drawn inside UINormalizer's CSS
          transform, and a transform is a containing block for fixed positioning - so this
          lands in the corner of the PHONE's canvas rather than the browser window, which is
          also what keeps four of them apart in the Test Lobby. */}
      <GameVersionTag history={props.history} className={styles.versionCorner} />
    </div>
  );
}
