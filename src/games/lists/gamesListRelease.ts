import LexibleAssets from "games/Lexible/assets/Assets";
import { GameDescriptor } from "./GameDescriptor";
import RetroSpectroAssets from "games/RetroSpectro/assets/Assets";

const releaseGames: GameDescriptor[] = [
    {
        name: "Lexible",
        displayName: "Lexible",
        tags: [],
        logoName: LexibleAssets.images.logo,
        importThunk: () => import('../Lexible/views/GameComponent')
    },
    {
        name: "RetroSpectro",
        displayName: "Retro Spectro",
        tags: [],
        logoName: RetroSpectroAssets.images.logo,
        importThunk: () => import('../RetroSpectro/views/GameComponent')
    }
]

export default releaseGames;