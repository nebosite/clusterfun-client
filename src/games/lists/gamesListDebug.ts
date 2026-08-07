import StressatoAssets from "games/stressgame/assets/Assets";
import TemplateAssets from "games/TemplateGame/assets/Assets";
import CollageBoardAssets from "games/CollageBoard/assets/Assets";
import FaceOffAssets from "games/FaceOff/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import releaseGames from "./gamesListRelease";

// -------------------------------------------------------------------
// Games that only exist in a debug build.  Reaching them at all is
// gated by REACT_APP_SHOW_DEBUG_GAMES (see GameChooser), and the server
// manifest is what keeps them out of production.
//
// No `tags` here: a registry entry deliberately cannot carry them (see GameDescriptor).
// Tags come from the SERVER manifest, which is the only thing that decides what production
// shows and how it is badged - a debug tag set here would have been ignored in production
// and, being outside the manifest, these are already invisible there.
// -------------------------------------------------------------------
const debugOnlyGames: GameDescriptor[] = [
  {
    name: "FaceOff",
    displayName: "Face Off",
    logoName: FaceOffAssets.images.logo,
    importThunk: () => import("../FaceOff/views/GameComponent"),
  },
  {
    name: "CollageBoard",
    displayName: "Collage Board",
    logoName: CollageBoardAssets.images.logo,
    importThunk: () => import("../CollageBoard/views/GameComponent"),
  },
  {
    name: "Stressato",
    displayName: "Stress Game",
    logoName: StressatoAssets.images.logo,
    importThunk: () => import("../stressgame/views/GameComponent"),
  },
  {
    name: "Template",
    displayName: "Template Game",
    logoName: TemplateAssets.images.logo,
    importThunk: () => import("../TemplateGame/views/GameComponent"),
  },
];

const debugGames = releaseGames.concat(debugOnlyGames);

export default debugGames;
