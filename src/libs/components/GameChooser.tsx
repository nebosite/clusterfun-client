import { GameInstanceProperties, UIProperties, IMessageThing, ITelemetryLogger, IStorage } from '../../libs';
import React from 'react';

export interface GameDescriptor { 
    name: string, 
    tags: string[], 
    logoName: string, 
    lazyType?: React.LazyExoticComponent<any> 
}

// Declare Games Here:
let games: GameDescriptor[] =
    [
        // {
        //     name:       "Testorama",   
        //     tags:       ["production"],
        //     logoName:   LobbyAssets.images.logos.Testorama,
        //     lazyType:   React.lazy(() => import('../../Testorama'))
        // },
    ]

// -------------------------------------------------------------------
// ClusterFunGameProps
// -------------------------------------------------------------------
export interface ClusterFunGameProps {
    playerName?: string;
    gameProperties: GameInstanceProperties;
    uiProperties: UIProperties;
    messageThing: IMessageThing;
    logger: ITelemetryLogger;
    storage: IStorage;
    onGameEnded: () => void;
    serverCall: <T>(url: string, payload: any) => Promise<T>
}

// -------------------------------------------------------------------
// getGameNames
// -------------------------------------------------------------------
export function getGames(searchTags: string[]) {
    //console.log(`Tags: ${searchTags}`)
    return games.filter(g => {
        let count = 0;
        g.tags.forEach(gameTag => count += (searchTags.indexOf(gameTag) > -1 ? 1 : 0))
        return count > 0;
    })
}

// -------------------------------------------------------------------
// getGameComponent
// -------------------------------------------------------------------
export function getGameComponent(gameName: string, config: ClusterFunGameProps) {
    const foundGame = games.find(g => g.name === gameName);
    if (foundGame && foundGame.lazyType) {
        console.log(`Creating component for ${gameName} ${config.gameProperties.role} ${config.gameProperties.personalId}`)
        return <div>
            <React.Suspense fallback="Loading...">
                <foundGame.lazyType {...config} />
            </React.Suspense>
        </div>;
    }

    throw Error('Unknown game: ' + gameName);
}
