import { observer } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import styles from "./LetterBlock.module.css";
import { COZY, teamColor, teamColorForScore } from "./cozyTheme";

// ==========================================================================================
// The capture firework.
//
// Thirty sparks thrown three tiles in every direction, white-hot at the core with the
// capturing team's colour glowing off them.  It is deliberately loud, which is affordable
// only because it is rare: a tile TAKEN OFF THE OTHER TEAM sets it off, and claiming neutral
// ground - most of what happens in a round - does not.
//
// The variation between sparks is hashed off the spark's index rather than random, so a burst
// looks scattered but is identical on the presenter and on every phone.  A real firework is
// not a ring: the reach, the size and the launch delay all vary, and without that the thirty
// sparks arrive as one expanding circle.
// ==========================================================================================
const SPARK_COUNT = 30;

/** How far the furthest sparks travel, in TILES. */
const SPARK_REACH_TILES = 3;

/** Deterministic 0..1 from a small integer. Same burst everywhere, no Math.random. */
function sparkNoise(index: number, salt: number): number {
  const h = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

export interface LetterBlockProps {
  context: LetterBlockModel;
  size?: number;
  onClick: (block: LetterBlockModel) => void;
  localPlayerId?: string;
  showBadge?: boolean;
}

@observer
export default class LetterBlock extends React.Component<LetterBlockProps> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { context } = this.props;
    const size = this.props.size ?? 40;
    const claimed = context.score > 0;
    const selected = context.selected;

    // Fire on pointerup, not click: on touch, the synthetic click lags and gets
    // dropped during rapid tapping. Pointerup registers each tap immediately;
    // taps that land at the end of a pan are still filtered by the caller's
    // drag guard (see ClientGameComponent.canClick).
    const handleSelect = () => {
      this.props.onClick(this.props.context);
    };

    // The outer block is just the spacing gutter around the tile; the tile
    // surface itself lives on the inner div.
    const blockStyle: React.CSSProperties = {
      width: `${size}px`,
      height: `${size}px`,
      padding: `${size * 0.1}px`,
      background: "transparent",
      // Sparks reach three tiles out, and tiles are siblings in a flex row: without
      // this the burst is painted under every tile that comes after it.
      ...(context.captureSeq > 0 ? { zIndex: 20 } : {}),
    };

    // Cozy tile surface + soft bevel, by state (see the reskin spec).
    let background: string;
    let letterColor: string;
    let boxShadow: string;
    let stateStyle: React.CSSProperties = {};

    if (context.failFade > 0) {
      // Keep the existing "rejected word" red flash, fading back to a tile.
      const failHex = Math.floor((1 - context.failFade) * 255)
        .toString(16)
        .padStart(2, "0");
      background = `#FF${failHex}${failHex}`;
      letterColor = COZY.ink;
      boxShadow = "inset 0 -4px 0 rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.08)";
    } else if (selected) {
      // Currently part of the word being spelled — unmistakably gold, and
      // reads distinctly on top of both team colors (never a team color).
      background = COZY.select;
      letterColor = COZY.selectInk;
      boxShadow =
        "0 0 0 6px rgba(255,255,255,0.95), 0 0 0 12px #F4B740, 0 8px 16px rgba(0,0,0,0.22)";
      stateStyle = { transform: "scale(1.04)", zIndex: 5 };
    } else if (claimed) {
      // Colour carries how hard the tile is to take: a 3 is 20% team colour on
      // white, a 9 or more is the full team colour.
      //
      // The letter stays DARK at every strength.  It used to flip to white once
      // the tile passed about half strength, which was correct about contrast
      // and wrong about reading: scanning the board, a scatter of white letters
      // among dark ones looks like a state you are meant to notice, and it is
      // not one - the tile colour already says how strong it is.
      background = teamColorForScore(context.team, context.score);
      letterColor = COZY.ink;
      boxShadow = "inset 0 -5px 0 rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.12)";
    } else {
      background = COZY.tile;
      letterColor = COZY.ink;
      boxShadow = "inset 0 -4px 0 rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.08)";
    }

    const innerStyle: React.CSSProperties = {
      borderRadius: `${size * 0.18}px`,
      background,
      boxShadow,
      ...stateStyle,
    };

    // A team-coloured outline around the whole set of tiles joined to the left
    // edge - ONE shape around the region, not a box per tile.
    //
    // Two things make it read as a single outline.  Only the sides that FACE
    // OUT of the region are drawn, so nothing is drawn between two members.
    // And it goes on the OUTER div, which includes the gutter between tiles:
    // drawn on the inner tile surface the segments are separated by that
    // gutter, and a run of them looks like a row of boxes rather than a border.
    const edgeMask = context.homeEdgeMask;
    const outlineStyle: React.CSSProperties = {};
    if (context.connectedToLeftEdge && edgeMask) {
      const line = `${Math.max(3, size * 0.09)}px solid ${teamColor(context.team)}`;
      if (edgeMask & 1) outlineStyle.borderTop = line;
      if (edgeMask & 2) outlineStyle.borderRight = line;
      if (edgeMask & 4) outlineStyle.borderBottom = line;
      if (edgeMask & 8) outlineStyle.borderLeft = line;
      // Inside the tile's footprint, so adding it does not shift the grid.
      outlineStyle.boxSizing = "border-box";
    }

    let fontSize = size * 0.7;
    if (context.letter.length > 1) fontSize = size * 0.6;
    const letterStyle: React.CSSProperties = {
      fontSize: `${fontSize}px`,
      color: letterColor,
      fontFamily: "'Fredoka', sans-serif",
      fontWeight: 700,
      textTransform: "uppercase",
      // Nudged up and left by a pixel to lean away from the score badge, which
      // sits bottom-right and was clipping the letter's descender corner.
      transform: "translate(-1px, -1px)",
    };

    let badgeUI: JSX.Element | null = null;
    if (claimed && this.props.showBadge) {
      // The letter is the thing people are reading; the badge is a footnote.
      // So it is small and pushed well into the corner, hanging off the tile
      // rather than sitting on it.
      //
      // The corner overhang is computed here in PIXELS rather than left to the
      // stylesheet's percentage.  An inline transform overrides the class
      // outright - it cannot add to it - so leaving the two to interact was how
      // the badge previously ended up back on top of the letter.  One place
      // owns the position, and it is this one.
      const badgeDim = size * 0.368 - 2; // 20% smaller than it was
      const overhang = badgeDim * 0.3 + 2;
      const badgeStyle: React.CSSProperties = {
        minWidth: `${badgeDim}px`,
        height: `${badgeDim}px`,
        padding: `0 ${size * 0.06}px`,
        fontSize: `${size * 0.26}px`,
        fontFamily: "'Nunito', sans-serif",
        fontWeight: 800,
        transform: `translate(${overhang}px, ${overhang}px)`,
      };
      badgeUI = (
        <div className={styles.badge} style={badgeStyle}>
          {context.score}
        </div>
      );
    }

    // A tile taken off the other team: firework.
    //
    // Keyed on the capture counter so a new capture re-mounts the element and the CSS
    // animation replays from the top - re-using the element would leave a finished animation
    // sitting there doing nothing.  Each spark gets its own angle, reach, size and delay here;
    // the motion, the fade and the afterglow live in the stylesheet.
    let sparkUI: JSX.Element | null = null;
    if (context.captureSeq > 0) {
      const glow = teamColor(context.team);
      sparkUI = (
        <div className={styles.sparkBurst} key={context.captureSeq}>
          {Array.from({ length: SPARK_COUNT }, (_, i) => {
            // Spread evenly and then jitter, so it is neither a ring nor a clump.
            const angle = (360 / SPARK_COUNT) * i + (sparkNoise(i, 1) - 0.5) * 10;
            const reach = size * SPARK_REACH_TILES * (0.45 + sparkNoise(i, 2) * 0.55);
            const dot = Math.max(2, size * (0.07 + sparkNoise(i, 3) * 0.07));
            return (
              <span
                key={i}
                className={styles.spark}
                style={
                  {
                    "--spark-angle": `${angle}deg`,
                    "--spark-reach": `${reach}px`,
                    "--spark-size": `${dot}px`,
                    "--spark-glow": glow,
                    // A staggered launch is what makes it read as a burst rather than a
                    // shockwave; the longest delay is inside CAPTURE_SPARK_MS.
                    animationDelay: `${Math.round(sparkNoise(i, 4) * 130)}ms`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      );
    }

    const innerClassName = styles.letterBlockInner;

    return (
      <div
        className={styles.letterBlock}
        style={{ ...blockStyle, ...outlineStyle }}
        key={context.__blockid}
        // Lets a drag work out which letter is under the finger with
        // elementFromPoint, rather than every tile needing its own listener.
        data-cell={`${context.coordinates.x},${context.coordinates.y}`}
      >
        <div className={innerClassName} style={innerStyle} onPointerUp={handleSelect}>
          <div className={styles.letterBlockText} style={letterStyle}>
            {context.letter}
          </div>
          {badgeUI}
          {sparkUI}
        </div>
      </div>
    );
  }
}
