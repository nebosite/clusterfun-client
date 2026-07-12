import { observer } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import styles from "./LetterBlock.module.css";
import { COZY, teamColor } from "./cozyTheme";

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
      background = teamColor(context.team);
      letterColor = "rgba(255,255,255,0.97)";
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

    let fontSize = size * 0.7;
    if (context.letter.length > 1) fontSize = size * 0.6;
    const letterStyle: React.CSSProperties = {
      fontSize: `${fontSize}px`,
      color: letterColor,
      fontFamily: "'Fredoka', sans-serif",
      fontWeight: 700,
      textTransform: "uppercase",
    };

    let badgeUI: JSX.Element | null = null;
    if (claimed && this.props.showBadge) {
      const badgeDim = size * 0.46;
      const badgeStyle: React.CSSProperties = {
        minWidth: `${badgeDim}px`,
        height: `${badgeDim}px`,
        padding: `0 ${size * 0.08}px`,
        fontSize: `${size * 0.32}px`,
        fontFamily: "'Nunito', sans-serif",
        fontWeight: 800,
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
      <div className={styles.letterBlock} style={blockStyle} key={context.__blockid}>
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
