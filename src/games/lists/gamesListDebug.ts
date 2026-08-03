import StressatoAssets from "games/stressgame/assets/Assets";
import TemplateAssets from "games/TemplateGame/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import releaseGames from "./gamesListRelease";

// -------------------------------------------------------------------
// Games that only exist in a debug build.  Reaching them at all is
// gated by REACT_APP_SHOW_DEBUG_GAMES (see GameChooser), and the server
// manifest is what keeps them out of production.
// -------------------------------------------------------------------
const debugOnlyGames: GameDescriptor[] = [
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
