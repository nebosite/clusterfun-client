import { observer } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import styles from "./LetterBlock.module.css";
import { COZY, teamColor, teamColorForScore, letterColorForScore } from "./cozyTheme";

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
      // white, a 9 or more is the full team colour.  The letter follows the
      // tile - white text vanishes on a nearly-white one.
      background = teamColorForScore(context.team, context.score);
      letterColor = letterColorForScore(context.score);
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

    let innerClassName = styles.letterBlockInner;
    if (context.onPath) innerClassName += " " + styles.highlight;

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
        </div>
      </div>
    );
  }
}
