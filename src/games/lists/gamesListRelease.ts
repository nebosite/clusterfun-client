import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import RetroSpectroAssets from "games/RetroSpectro/assets/Assets";
import PartyPixAssets from "games/PartyPix/assets/Assets";
import EittrisAssets from "games/Eittris/assets/Assets";
import OneOhOneAssets from "games/OneOhOne/assets/Assets";
import PassTheAuxAssets from "games/PassTheAux/assets/Assets";

// -------------------------------------------------------------------
// Games the client knows how to build for production.  Appearing here
// makes a game POSSIBLE, not visible: the server's game_manifest
// decides what actually shows and how it is badged (alpha/beta/debug).
// See clusterfun-server/src/apis/ApiHandlers.ts.
// -------------------------------------------------------------------
const releaseGames: GameDescriptor[] = [
  {
    name: "Eittris",
    // The lobby card is a plain string, so it cannot carry the wordmark itself (see
    // views/EittrisLogo.tsx) - the caps at least match it. NOTE: in production the
    // displayName comes from the SERVER manifest, so changing it here only affects dev.
    displayName: "EITTRIS",
    logoName: EittrisAssets.images.logo,
    importThunk: () => import("../Eittris/views/GameComponent"),
  },
  {
    name: "OneOhOne",
    displayName: "101",
    logoName: OneOhOneAssets.images.logo,
    importThunk: () => import("../OneOhOne/views/GameComponent"),
  },
  {
    name: "PassTheAux",
    displayName: "Pass the AUX",
    logoName: PassTheAuxAssets.images.logo,
    importThunk: () => import("../PassTheAux/views/GameComponent"),
  },
  {
    name: "PartyPix",
    displayName: "PartyPix",
    logoName: PartyPixAssets.images.logo,
    importThunk: () => import("../PartyPix/views/GameComponent"),
  },
  {
    name: "Lexible",
    displayName: "Lexible",
    logoName: LexibleAssets.images.logo,
    importThunk: () => import("../Lexible/views/GameComponent"),
  },
  {
    name: "RetroSpectro",
    displayName: "Retro Spectro",
    logoName: RetroSpectroAssets.images.logo,
    importThunk: () => import("../RetroSpectro/views/GameComponent"),
  },
];

export default releaseGames;
