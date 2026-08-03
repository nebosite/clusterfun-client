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
// Saturation carries it: a 3 is barely tinted, a 9 or more is the full team
// colour, and everything between is interpolated. Only saturation moves -
// hue stays so the team is never in doubt, and lightness stays so the white
// letter on top keeps the same contrast at every strength.
// -------------------------------------------------------------------
export const MIN_STRENGTH_SCORE = 3;
export const FULL_STRENGTH_SCORE = 9;
export const MIN_SATURATION_SCALE = 0.2;

/** 0..1: how far along the weak-to-strong ramp a score sits. */
export function strengthFraction(score: number): number {
  const span = FULL_STRENGTH_SCORE - MIN_STRENGTH_SCORE;
  const t = (score - MIN_STRENGTH_SCORE) / span;
  return Math.max(0, Math.min(1, t));
}

/** The fraction of the team colour's saturation a tile at this score shows. */
export function saturationScaleForScore(score: number): number {
  return MIN_SATURATION_SCALE + strengthFraction(score) * (1 - MIN_SATURATION_SCALE);
}

/** The team colour for a tile, faded towards grey as the tile gets weaker. */
export function teamColorForScore(team: string, score: number): string {
  const base = teamColor(team);
  if (team !== "A" && team !== "B") return base;
  return scaleSaturation(base, saturationScaleForScore(score));
}

// -------------------------------------------------------------------
// scaleSaturation - hex in, hsl() out, with saturation multiplied.
// -------------------------------------------------------------------
export function scaleSaturation(hex: string, scale: number): string {
  const { h, s, l } = hexToHsl(hex);
  const scaled = Math.max(0, Math.min(1, s * scale));
  return `hsl(${Math.round(h)}, ${(scaled * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = 60 * (((g - b) / delta) % 6);
  else if (max === g) h = 60 * ((b - r) / delta + 2);
  else h = 60 * ((r - g) / delta + 4);
  if (h < 0) h += 360;

  return { h, s, l };
}
