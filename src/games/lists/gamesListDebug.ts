import StressatoAssets from "games/stressgame/assets/Assets";
import TestatoAssets from "games/TestGame/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import releaseGames from "./gamesListRelease";
import WrongAnswersAssets from "games/WrongAnswers/assets/Assets";

const debugOnlyGames: GameDescriptor[] = [
    {
        name: "Stressato",
        displayName: "Stress Game",
        tags: ["debug"],
        logoName: StressatoAssets.images.logo,
        importThunk: () => import('../stressgame/views/GameComponent')
    },
    {
        name: "Testato",
        displayName: "Test Game",
        tags: ["debug"],
        logoName: TestatoAssets.images.logo,
        importThunk: () => import('../TestGame/views/GameComponent')
    },
    {
        name: "WrongAnswers",
        displayName: "Wrong Answers Only",
        tags: ["debug"],
        logoName: WrongAnswersAssets.images.logo,
        importThunk: () => import('../WrongAnswers/views/GameComponent')
    },
]

const debugGames = releaseGames.concat(debugOnlyGames);

export default debugGames;