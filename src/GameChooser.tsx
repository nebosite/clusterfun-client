import { ClusterFunGameProps } from './libs';
import React from 'react';
import { GameDescriptor, GameManifestItem } from 'games/lists/GameDescriptor';

const gameListPromise: Promise<{default: GameDescriptor[]}> = (process.env.REACT_APP_SHOW_DEBUG_GAMES)
    ? import("./games/lists/gamesListDebug")
    : import("./games/lists/gamesListRelease");

const lazyTypeCache: Map<string, React.ComponentType<any>> = new Map();

export async function getGameListPromise(): Promise<GameDescriptor[]> {
    const gameListModule = await gameListPromise;
    return gameListModule.default;
}

// -------------------------------------------------------------------
// getGameComponent
// -------------------------------------------------------------------
export function getGameComponent(descriptor: GameManifestItem, config: ClusterFunGameProps) {
    //Logger.debug(`Creating component for ${descriptor.name} ${config.gameProperties.role} ${config.gameProperties.personalId}`)
    if (!lazyTypeCache.has(descriptor.name)) {
        lazyTypeCache.set(descriptor.name, React.lazy(async () => {
            const gameList = await getGameListPromise();
            const foundGame = gameList.find(g => g.name === descriptor.name);
            if(!foundGame) throw Error(`Could not find game named '${descriptor.name}'`)
            return foundGame.importThunk();
        }))
    }
    const LazyType = lazyTypeCache.get(descriptor.name)!;
    return <div>
        <React.Suspense fallback="Loading...">
            <LazyType {...config} />
        </React.Suspense>
    </div>;
}
