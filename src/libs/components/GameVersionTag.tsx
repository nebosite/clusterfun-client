import React from "react";
import { GameVersionEntry, currentVersion } from "../config/GameVersion";
import styles from "./GameVersionTag.module.css";

// ==========================================================================================
// The game's name with its version beside it, small and out of the way.
//
// Every game shows this in the same shape - on the shared screen and on every phone - so
// "which version were you playing?" has one answer in one place rather than seven.
//
// On the PRESENTER it is clickable and opens the change list.  On a phone it is not: the
// person holding it is playing, and a modal over their controls mid-round is a bug, not a
// feature.  That is the whole reason `showChanges` exists.
// ==========================================================================================

export interface GameVersionTagProps {
  /**
   * The game's name, as players call it.  A NODE rather than a string, so a game with a
   * wordmark can pass that instead of spelling its name in the surrounding font - EITtris
   * does.  OPTIONAL: some phone headers already say something more useful in that spot -
   * Lexible's says which team you are on - and a second copy of the game's name would just
   * be taking up a thumb's width. Omit it and only the version renders, still to the right
   * of whatever title is already there.
   */
  title?: React.ReactNode;
  /** Newest entry first. The version shown is the newest entry's. */
  history: GameVersionEntry[];
  /** Presenter only: clicking the tag opens the change list. */
  showChanges?: boolean;
  className?: string;
}

export function GameVersionTag(props: GameVersionTagProps) {
  const [open, setOpen] = React.useState(false);
  const version = currentVersion(props.history);

  const toggle = () => {
    if (props.showChanges) setOpen((was) => !was);
  };

  return (
    <span className={[styles.tag, props.className].filter(Boolean).join(" ")}>
      <span
        className={[styles.pair, props.showChanges ? styles.clickable : undefined]
          .filter(Boolean)
          .join(" ")}
        onClick={toggle}
        title={props.showChanges ? "What changed?" : undefined}
        role={props.showChanges ? "button" : undefined}
      >
        {props.title ? <span className={styles.title}>{props.title}</span> : null}
        <span className={styles.version}>v{version}</span>
      </span>
      {open ? (
        // Click anywhere to dismiss. A shared screen has no cursor to aim with, so the
        // whole backdrop is the close button rather than a small x in a corner.
        <div className={styles.backdrop} onClick={() => setOpen(false)}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.panelHead}>
              {props.title ?? "Changes"} <span className={styles.panelVersion}>v{version}</span>
            </div>
            <div className={styles.entries}>
              {props.history.map((entry) => (
                <div className={styles.entry} key={entry.version}>
                  <div className={styles.entryVersion}>v{entry.version}</div>
                  <ul className={styles.changes}>
                    {entry.changes.map((change, i) => (
                      <li key={i}>{change}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className={styles.dismiss}>click anywhere to close</div>
          </div>
        </div>
      ) : null}
    </span>
  );
}
