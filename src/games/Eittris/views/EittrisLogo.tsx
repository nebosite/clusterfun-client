import React from "react";
import styles from "./EittrisLogo.module.css";

// ==========================================================================================
// The EITTRIS wordmark.
//
// All caps, a red-to-yellow gradient running top to bottom, and the R upside down - the
// joke being a piece that landed the wrong way up and nobody can rotate it any more.
//
// Text rather than an image, on purpose: it lands in a phone header, a presenter corner and a
// version tag, at three different sizes, and it has to stay crisp in all of them. It takes
// its size from whatever it is dropped into, so callers set font-size and this follows.
// ==========================================================================================

export function EittrisLogo(props: { className?: string }) {
  return (
    <span
      className={[styles.logo, props.className].filter(Boolean).join(" ")}
      // The gradient is painted through the glyphs, which leaves nothing for a screen
      // reader or a copy-paste to find - so the real word goes here.
      aria-label="EITTRIS"
      role="img"
    >
      <span aria-hidden="true">EITT</span>
      <span aria-hidden="true" className={styles.upsideDownR}>
        R
      </span>
      <span aria-hidden="true">IS</span>
    </span>
  );
}
