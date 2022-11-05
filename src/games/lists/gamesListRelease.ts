import LexibleAssets from "games/Lexible/assets/Assets";
import React from "react";
import { GameDescriptor } from "./GameDescriptor";

const releaseGames: GameDescriptor[] = [
    {
        name: "Lexible",
        displayName: "Lexible",
        tags: [],
        logoName: LexibleAssets.images.logo,
        importThunk: () => import('../Lexible/views/GameComponent')
    }
]

export default releaseGames;