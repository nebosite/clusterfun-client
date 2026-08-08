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

// The category chips shown on the presenter. "All" is the default filter.
export const CATEGORIES = [
  "All",
  "Trivia",
  "Drawing",
  "Party",
  "Puzzle",
  "Word",
  "Bluff",
  "Music",
  "Productivity",
];

// The animated thumbnail shown on each game tile (see GameThumbnail). A small
// set of themed loops; games map to the one that best evokes them, and anything
// unmapped falls back to "bars" so the catalog can grow without edits here.
export type ThumbKind = "photos" | "letters" | "sort" | "bars";

export interface GamePresentation {
  monogram: string;
  accent: string;
  category: string;
  blurb: string;
  players: string;
  playTime: string;
  thumbKind: ThumbKind;
}

// Hand-authored presentation for the games we ship; anything else falls
// back to derived defaults so the catalog can grow without edits here.
const KNOWN: Record<string, Partial<GamePresentation>> = {
  BidBots: {
    category: "Party",
    blurb: "Snipe battle bots on a falling-price auction, then brawl your squad last-bot-standing.",
    players: "2–8",
    playTime: "15m",
    thumbKind: "bars",
  },
  PassTheAux: {
    category: "Music",
    blurb: "Match the perfect song to the scenario, then rank the room's picks to crown a winner.",
    players: "3–8",
    playTime: "20m",
    thumbKind: "bars",
  },
  FaceOff: {
    category: "Party",
    blurb: "Mimic a secret face on 3-2-1, then vote head-to-head on who nailed it best.",
    players: "4–12",
    playTime: "15m",
    thumbKind: "photos",
  },
  CollageBoard: {
    category: "Party",
    blurb: "Outline a spot on a shared canvas, then fill it with your camera - collage together.",
    players: "1–12",
    playTime: "∞",
    thumbKind: "photos",
  },
  PartyPix: {
    category: "Party",
    blurb: "Snap guests around the party, upload your best, and vote them onto the big screen.",
    players: "1–50",
    playTime: "∞",
    thumbKind: "photos",
  },
  Lexible: {
    category: "Word",
    blurb: "Claim letters and build words across a shared board to outscore the room.",
    players: "2–8",
    playTime: "15m",
    thumbKind: "letters",
  },
  RetroSpectro: {
    category: "Productivity",
    blurb: "Toss out hot takes, then sort the room's reactions into agree and disagree.",
    players: "3–10",
    playTime: "20m",
    thumbKind: "sort",
  },
  Stressato: {
    category: "Party",
    blurb: "A load-test playground for hammering the relay with lots of players.",
    players: "1–99",
    playTime: "5m",
    thumbKind: "bars",
  },
  Template: {
    category: "Party",
    blurb: "The bare-bones template game used as the starting point for new games.",
    players: "1–8",
    playTime: "5m",
    thumbKind: "bars",
  },
  OneOhOne: {
    category: "Puzzle",
    blurb: "Race to land exactly on 101 — unique picks surge ahead, collisions knock you back.",
    players: "1–16",
    playTime: "10m",
    thumbKind: "bars",
  },
  Eittris: {
    category: "Puzzle",
    blurb:
      "Frenetic block-stacking battle: everyone runs a board from their phone — last one standing wins.",
    players: "2–16",
    playTime: "10m",
    thumbKind: "bars",
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
    thumbKind: known.thumbKind ?? "bars",
  };
}
