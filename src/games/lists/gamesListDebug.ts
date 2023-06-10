import StressatoAssets from "games/stressgame/assets/Assets";
import TestatoAssets from "games/TestGame/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import releaseGames from "./gamesListRelease";

const debugOnlyGames: GameDescriptor[] = [
    {
        name: "Stressato",
        displayName: "Stress Game",
        tags: ["debug"],
        logoName: StressatoAssets.images.logo,
        hostWorkerThunk: () => /* webpackChunkName: "stressato-host-worker" */ new SharedWorker(new URL("../stressgame/workers/HostWorker", import.meta.url), { type: "module" }),
        componentImportThunk: () => import('../stressgame/views/GameComponent')
    },
    {
        name: "Testato",
        displayName: "Test Game",
        tags: ["debug"],
        logoName: TestatoAssets.images.logo,
        hostWorkerThunk: () => /* webpackChunkName: "testato-host-worker" */ new SharedWorker(new URL("../TestGame/workers/HostWorker", import.meta.url), { type: "module" }),
        componentImportThunk: () => import('../TestGame/views/GameComponent')
    },
]

const debugGames = releaseGames.concat(debugOnlyGames);

export default debugGames;