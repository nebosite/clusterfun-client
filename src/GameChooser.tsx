import { ClusterFunGameProps } from './libs';
import React from 'react';
import TestatoAssets from 'testLobby/TestGame/assets/Assets';
import LexibleAssets from 'games/Lexible/assets/Assets';
import Logger from 'js-logger';
import StressatoAssets from 'testLobby/stressgame/assets/Assets';

export interface GameManifestItem { 
    name: string,
    displayName?: string, 
    tags: string[], 
}

export interface GameDescriptor extends GameManifestItem {
    logoName: string, 
    lazyType: React.LazyExoticComponent<any> 
}

export const allGames: GameDescriptor[] = [
    {
        name: "Stressato",
        displayName: "Stress Game",
        tags: ["debug"],
        logoName: StressatoAssets.images.logo,
        lazyType: React.lazy(() => import('./testLobby/stressgame/views/GameComponent'))
    },
    {
        name: "Testato",
        displayName: "Test Game",
        tags: ["debug"],
        logoName: TestatoAssets.images.logo,
        lazyType: React.lazy(() => import('./testLobby/TestGame/views/GameComponent'))
    },
    {
        name: "Lexible",
        displayName: "Lexible",
        tags: [],
        logoName: LexibleAssets.images.logo,
        lazyType: React.lazy(() => import('./games/Lexible/views/GameComponent'))
    }
]

// -------------------------------------------------------------------
// getGameComponent
// -------------------------------------------------------------------
export function getGameComponent(descriptor: GameManifestItem, config: ClusterFunGameProps) {
    Logger.debug(`Creating component for ${descriptor.name} ${config.gameProperties.role} ${config.gameProperties.personalId}`)
    const foundGame = allGames.find(g => g.name === descriptor.name);
    if(!foundGame) throw Error(`Could not find game named '${descriptor.name}'`)
    return <div>
        <React.Suspense fallback="Loading Game...">
            <foundGame.lazyType {...config} />
        </React.Suspense>
    </div>;
}
