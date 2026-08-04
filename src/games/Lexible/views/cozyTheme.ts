// -------------------------------------------------------------------
// Lexible "Cozy" reskin — color tokens (single source of truth)
//
// Soft, tactile party-game palette: warm cream surfaces, beveled
// Scrabble-style tiles, coral/teal teams. The two team colors and the
// background are meant to be re-themed from HERE. The CSS Modules mirror
// these same values as CSS variables on their root containers
// (.gamepresenter / .gameclient) — keep them in sync if you retheme.
// -------------------------------------------------------------------
export const COZY = {
  bg: "#F1E9DB", // page background (cream)
  board: "#E7DCC8", // grid backing panel
  panel: "#FBF6EC", // cards, top bars, chips
  tile: "#FFFDF7", // unclaimed letter tile
  ink: "#4A4038", // primary text / tile letters
  sub: "#9A8C79", // secondary text, labels, hints
  teamA: "#E56B45", // Team A (coral)
  teamB: "#2E9E92", // Team B (teal)
  select: "#F4B740", // gold — the tile(s) in the word being spelled
  selectInk: "#4A3A10", // text on gold selected tiles
} as const;

// The strong accent color for a team ("A"/"B"); anything else is neutral.
export function teamColor(team: string): string {
  if (team === "A") return COZY.teamA;
  if (team === "B") return COZY.teamB;
  return COZY.sub;
}

// -------------------------------------------------------------------
// How strongly a tile is held, as colour.
//
// A tile's score is the length of the word that took it, and it can only be
// taken again by a LONGER word - so score is exactly "how hard this is to
// shift".  Every claimed tile used to be the flat team colour, which told you
// who owned the board but nothing about where it was soft.
//
// The tile is a MIX OF WHITE AND THE TEAM COLOUR: a 3 is 20% team colour on
// 80% white, a 9 or more is the full team colour, and everything between is
// interpolated.  Mixing towards white rather than scaling HSL saturation is
// deliberate - desaturating alone keeps the original lightness, so a weak
// tile came out a muddy mid-grey that was hard to tell from a strong one at
// a distance.  Against a cream board, "pale" reads instantly.
//
// The letter colour has to follow: white text on a nearly-white tile is
// invisible, so weak tiles take the dark ink instead (see letterColorForScore).
// -------------------------------------------------------------------
export const MIN_STRENGTH_SCORE = 3;
export const FULL_STRENGTH_SCORE = 9;
/** How much team colour a minimum-strength tile shows. */
export const MIN_TEAM_MIX = 0.2;

/** 0..1: how far along the weak-to-strong ramp a score sits. */
export function strengthFraction(score: number): number {
  const span = FULL_STRENGTH_SCORE - MIN_STRENGTH_SCORE;
  const t = (score - MIN_STRENGTH_SCORE) / span;
  return Math.max(0, Math.min(1, t));
}

/** The proportion of team colour (vs white) a tile at this score shows. */
export function teamMixForScore(score: number): number {
  return MIN_TEAM_MIX + strengthFraction(score) * (1 - MIN_TEAM_MIX);
}

/** The team colour for a tile, mixed towards white as the tile gets weaker. */
export function teamColorForScore(team: string, score: number): string {
  const base = teamColor(team);
  if (team !== "A" && team !== "B") return base;
  return mixWithWhite(base, teamMixForScore(score));
}

/**
 * The letter on top of that tile.  Below about half strength the tile is pale
 * enough that white text disappears into it, so the dark ink takes over.
 */
export function letterColorForScore(score: number): string {
  return teamMixForScore(score) >= 0.55 ? "rgba(255,255,255,0.97)" : COZY.ink;
}

/** `amount` of the colour, the rest white. 1 is the colour itself. */
export function mixWithWhite(hex: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel: number) => Math.round(255 + (channel - 255) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}
