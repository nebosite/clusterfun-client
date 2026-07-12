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
