import React from "react";
import styles from "./LobbyComponent.module.css";

// -------------------------------------------------------------------
// PartyBurstLogo — the ClusterFun wordmark ("CLUSTER" white + "FUN"
// magenta, Bungee) preceded by a confetti-burst icon. Purely visual;
// `size` scales the SVG geometry, `fontSize` scales the wordmark.
// -------------------------------------------------------------------
export const PartyBurstLogo: React.FC<{ size?: number; fontSize?: number }> = ({
  size = 34,
  fontSize = 26,
}) => (
  <div className={styles.logoRow}>
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <circle cx="33" cy="20" r="3" fill="#22e0ff" />
      <circle cx="26.5" cy="31.3" r="3" fill="#ff3ea5" />
      <circle cx="13.5" cy="31.3" r="3" fill="#b6ff3a" />
      <circle cx="7" cy="20" r="3" fill="#ffd21a" />
      <circle cx="13.5" cy="8.7" r="3" fill="#22e0ff" />
      <circle cx="26.5" cy="8.7" r="3" fill="#b6ff3a" />
      <circle cx="20" cy="20" r="5.5" fill="#ff3ea5" />
    </svg>
    <div className={styles.wordmark} style={{ fontSize }}>
      <span>CLUSTER</span>
      <span className={styles.wordmarkFun}>FUN</span>
    </div>
  </div>
);
