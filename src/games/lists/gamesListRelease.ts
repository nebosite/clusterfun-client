import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";

const releaseGames: GameDescriptor[] = [
    {
        name: "Lexible",
        displayName: "Lexible",
        tags: [],
        logoName: LexibleAssets.images.logo,
        hostWorkerThunk: () => /* webpackChunkName: "lexible-host-worker" */ new SharedWorker(new URL("../Lexible/workers/HostWorker", import.meta.url), { type: "module" }),
        componentImportThunk: () => import('../Lexible/views/GameComponent')
    }
]

export default releaseGames;