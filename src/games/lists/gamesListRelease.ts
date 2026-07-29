import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import RetroSpectroAssets from "games/RetroSpectro/assets/Assets";
import PartyPixAssets from "games/PartyPix/assets/Assets";
import EittrisAssets from "games/Eittris/assets/Assets";
import OneOhOneAssets from "games/OneOhOne/assets/Assets";

const releaseGames: GameDescriptor[] = [
  {
    name: "Eittris",
    displayName: "EITtris",
    // Shipping, but still finding its feet - the lobby shows a "beta" badge.
    // In production the SERVER manifest's tags win (see index.tsx), so the
    // matching entry in ApiHandlers.getGameManifest has to say beta too.
    tags: ["beta"],
    logoName: EittrisAssets.images.logo,
    importThunk: () => import("../Eittris/views/GameComponent"),
  },
  {
    name: "OneOhOne",
    displayName: "101",
    // Earlier than beta - playable, still rough.  Alpha is in the lobby's
    // default showTags, so it is visible without a ?show= parameter; the
    // matching server manifest entry has to say alpha too, because that is
    // the one whose tags win (see index.tsx).
    tags: ["alpha"],
    logoName: OneOhOneAssets.images.logo,
    importThunk: () => import("../OneOhOne/views/GameComponent"),
  },
  {
    name: "PartyPix",
    displayName: "PartyPix",
    tags: [],
    logoName: PartyPixAssets.images.logo,
    importThunk: () => import("../PartyPix/views/GameComponent"),
  },
  {
    name: "Lexible",
    displayName: "Lexible",
    tags: [],
    logoName: LexibleAssets.images.logo,
    importThunk: () => import("../Lexible/views/GameComponent"),
  },
  {
    name: "RetroSpectro",
    displayName: "Retro Spectro",
    tags: [],
    logoName: RetroSpectroAssets.images.logo,
    importThunk: () => import("../RetroSpectro/views/GameComponent"),
  },
];

export default releaseGames;
