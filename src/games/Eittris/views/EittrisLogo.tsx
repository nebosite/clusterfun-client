import React from "react";
import logo from "../assets/images/EittrisLogo.png";
import styles from "./EittrisLogo.module.css";

// ==========================================================================================
// The EITTRIS wordmark.
//
// An artwork PNG, not type: the letterforms, the gradient and the upside-down R are all
// drawn, so nothing here has to reproduce them.  It replaced a CSS version that painted a
// gradient through live text - which looked close but was at the mercy of whatever font the
// machine had, and lost the R entirely wherever a transform broke the background-clip.
//
// It is sized by HEIGHT in em, so it scales with the surrounding text exactly like the word
// it replaces: drop it anywhere the game's name would have been written out and it takes the
// size of its context.
// ==========================================================================================

export function EittrisLogo(props: { className?: string }) {
  return (
    <img
      src={logo}
      // The wordmark is the game's name, so it reads as the name rather than as decoration.
      alt="EITTRIS"
      className={[styles.logo, props.className].filter(Boolean).join(" ")}
      draggable={false}
    />
  );
}
