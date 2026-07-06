import { GameDescriptor } from "games/lists/GameDescriptor";

// -------------------------------------------------------------------
// LobbyPresentation
//
// Purely presentational metadata for the "Neon Arcade" re-skin. None of
// this feeds game logic, routing, or the relay — it only decorates the
// lobby views (accent colors, monograms, blurbs, category chips, badges).
// The game catalog (GameDescriptor) carries no such fields, so we derive
// them here with sensible fallbacks so new games still render cleanly.
// -------------------------------------------------------------------

// Neon accents (equal chroma, varied hue) used for links / focus / logo.
export const NEON = {
  cyan: "#22e0ff",
  magenta: "#ff3ea5",
  lime: "#b6ff3a",
  yellow: "#ffd21a",
};

// Extended game-tile palette — assign one per game, cycle as it grows.
export const TILE_PALETTE = [
  "#ff4d6d",
  "#22e0ff",
  "#ffd21a",
  "#7c5cff",
  "#ff7a1a",
  "#2ee6c8",
  "#ff3ea5",
  "#b6ff3a",
  "#4d8bff",
  "#ff5cc8",
  "#ffb020",
  "#12b8ff",
];

// Grayscale swatch tones for the neutral avatar shapes.
export const AVATAR_TONES = ["#d4d6dd", "#9296a6", "#f2f3f6"];

// The category chips shown on the presenter. "All" is the default filter.
export const CATEGORIES = ["All", "Trivia", "Drawing", "Party", "Word", "Bluff", "Music"];

export interface GamePresentation {
  monogram: string;
  accent: string;
  category: string;
  blurb: string;
  players: string;
  playTime: string;
}

// Hand-authored presentation for the games we ship; anything else falls
// back to derived defaults so the catalog can grow without edits here.
const KNOWN: Record<string, Partial<GamePresentation>> = {
  PartyPix: {
    category: "Party",
    blurb: "Snap guests around the party, upload your best, and vote them onto the big screen.",
    players: "1–50",
    playTime: "∞",
  },
  Lexible: {
    category: "Word",
    blurb: "Claim letters and build words across a shared board to outscore the room.",
    players: "2–8",
    playTime: "15m",
  },
  RetroSpectro: {
    category: "Party",
    blurb: "Toss out hot takes, then sort the room's reactions into agree and disagree.",
    players: "3–10",
    playTime: "20m",
  },
  Stressato: {
    category: "Party",
    blurb: "A load-test playground for hammering the relay with lots of players.",
    players: "1–99",
    playTime: "5m",
  },
  Testato: {
    category: "Party",
    blurb: "The bare-bones template game used as the starting point for new games.",
    players: "1–8",
    playTime: "5m",
  },
};

// Two-letter monogram from the display name: initials of the first two
// words, or the first two letters of a single-word name.
export function monogramFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.trim().substring(0, 2).toUpperCase();
}

// Resolve full presentation for a game, cycling the tile palette by index.
export function presentationFor(game: GameDescriptor, index: number): GamePresentation {
  const known = KNOWN[game.name] ?? {};
  const label = game.displayName ?? game.name;
  return {
    monogram: known.monogram ?? monogramFor(label),
    accent: known.accent ?? TILE_PALETTE[index % TILE_PALETTE.length],
    category: known.category ?? "Party",
    blurb: known.blurb ?? "Grab your phone and jump in — everyone plays on the big screen.",
    players: known.players ?? "2–8",
    playTime: known.playTime ?? "15m",
  };
}
