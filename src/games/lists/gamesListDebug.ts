import StressatoAssets from "games/stressgame/assets/Assets";
import TemplateAssets from "games/TemplateGame/assets/Assets";
import OneOhOneAssets from "games/OneOhOne/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import releaseGames from "./gamesListRelease";

const debugOnlyGames: GameDescriptor[] = [
  {
    name: "OneOhOne",
    displayName: "101",
    tags: ["debug"],
    logoName: OneOhOneAssets.images.logo,
    importThunk: () => import("../OneOhOne/views/GameComponent"),
  },
  {
    name: "Stressato",
    displayName: "Stress Game",
    tags: ["debug"],
    logoName: StressatoAssets.images.logo,
    importThunk: () => import("../stressgame/views/GameComponent"),
  },
  {
    name: "Template",
    displayName: "Template Game",
    tags: ["debug"],
    logoName: TemplateAssets.images.logo,
    importThunk: () => import("../TemplateGame/views/GameComponent"),
  },
];

const debugGames = releaseGames.concat(debugOnlyGames);

export default debugGames;
