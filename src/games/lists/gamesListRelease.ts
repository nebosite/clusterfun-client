import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import EgyptianRatScrewAssets from "games/EgyptianRatScrew/assets/Assets";

const releaseGames: GameDescriptor[] = [
    {
        name: "Lexible",
        displayName: "Lexible",
        tags: [],
        logoName: LexibleAssets.images.logo,
        importThunk: () => import('../Lexible/views/GameComponent')
    },
    {
        name: "EgyptianRatScrew",
        displayName: "Egyptian Rat Screw",
        tags: [],
        logoName: EgyptianRatScrewAssets.images.logo,
        importThunk: () => import('../EgyptianRatScrew/views/GameComponent')
    },
]

export default releaseGames;