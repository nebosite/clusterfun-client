import React from "react";
import styles from "./GameThumbnail.module.css";
import { ThumbKind } from "../LobbyPresentation";

interface GameThumbnailProps {
  kind: ThumbKind;
  accent: string;
  size: number; // box edge in design px (the tile is square)
}

// -------------------------------------------------------------------
// GameThumbnail
//
// A small looping animated tile for a game, drawn entirely with SVG +
// CSS (see GameThumbnail.module.css) so it needs no image assets and
// scales cleanly inside the presenter's transform-scaled canvas. The
// accent color drives the art via the --accent custom property; each
// ThumbKind is a distinct themed loop that evokes its game.
// -------------------------------------------------------------------
export class GameThumbnail extends React.Component<GameThumbnailProps> {
  private renderArt() {
    switch (this.props.kind) {
      case "photos":
        // Fanned photo frames that sway, with a camera flash blink.
        return (
          <svg viewBox="0 0 64 64" className={styles.svg}>
            <g className={styles.photos}>
              <rect
                className={styles.frame}
                x="18"
                y="20"
                width="28"
                height="28"
                rx="4"
                transform="rotate(-15 32 34)"
              />
              <rect
                className={styles.frame}
                x="18"
                y="20"
                width="28"
                height="28"
                rx="4"
                transform="rotate(-2 32 34)"
              />
              <rect
                className={styles.frame}
                x="18"
                y="20"
                width="28"
                height="28"
                rx="4"
                transform="rotate(11 32 34)"
              />
              <circle className={styles.flash} cx="47" cy="17" r="4.5" />
            </g>
          </svg>
        );
      case "letters":
        // Three tiles that pop in sequence, like a word being spelled.
        return (
          <svg viewBox="0 0 64 64" className={styles.svg}>
            {[
              { x: 5, ch: "A" },
              { x: 24, ch: "B" },
              { x: 43, ch: "C" },
            ].map(({ x, ch }) => (
              <g className={styles.letter} key={ch}>
                <rect className={styles.letterTile} x={x} y="22" width="16" height="20" rx="3" />
                <text className={styles.letterChar} x={x + 8} y="36.5">
                  {ch}
                </text>
              </g>
            ))}
          </svg>
        );
      case "sort":
        // A cluster of dots that splits into an accent group and a white
        // group and merges back — evokes sorting reactions two ways.
        return (
          <svg viewBox="0 0 64 64" className={styles.svg}>
            <circle className={`${styles.dot} ${styles.left}`} cx="30" cy="18" r="5" />
            <circle className={`${styles.dot} ${styles.left}`} cx="30" cy="32" r="5" />
            <circle className={`${styles.dot} ${styles.left}`} cx="30" cy="46" r="5" />
            <circle className={`${styles.dot} ${styles.right}`} cx="34" cy="18" r="5" />
            <circle className={`${styles.dot} ${styles.right}`} cx="34" cy="32" r="5" />
            <circle className={`${styles.dot} ${styles.right}`} cx="34" cy="46" r="5" />
          </svg>
        );
      case "bars":
      default:
        // Bouncing equalizer bars.
        return (
          <svg viewBox="0 0 64 64" className={styles.svg}>
            <rect className={styles.bar} x="9" y="12" width="8" height="40" rx="2" />
            <rect className={styles.bar} x="21" y="12" width="8" height="40" rx="2" />
            <rect className={styles.bar} x="33" y="12" width="8" height="40" rx="2" />
            <rect className={styles.bar} x="45" y="12" width="8" height="40" rx="2" />
          </svg>
        );
    }
  }

  render() {
    const { accent, size } = this.props;
    return (
      <div
        className={styles.thumb}
        style={
          {
            width: size,
            height: size,
            ["--accent" as string]: accent,
            boxShadow: `0 0 22px -8px ${accent}`,
            border: `1px solid ${accent}40`,
          } as React.CSSProperties
        }
      >
        {this.renderArt()}
      </div>
    );
  }
}
