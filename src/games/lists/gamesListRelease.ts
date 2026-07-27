import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import RetroSpectroAssets from "games/RetroSpectro/assets/Assets";
import PartyPixAssets from "games/PartyPix/assets/Assets";
import PassTheAuxAssets from "games/PassTheAux/assets/Assets";

const releaseGames: GameDescriptor[] = [
  {
    name: "PassTheAux",
    displayName: "Pass the AUX",
    tags: [],
    logoName: PassTheAuxAssets.images.logo,
    importThunk: () => import("../PassTheAux/views/GameComponent"),
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
