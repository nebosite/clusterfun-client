import { ClusterFunGameProps } from './libs';
import React from 'react';
import { GameDescriptor, GameManifestItem } from 'games/lists/GameDescriptor';
import { IClusterfunHostGameInitializer } from 'libs/worker/IClusterfunHostGameInitializer';
import { IClusterfunHostLifecycleController } from 'libs/worker/IClusterfunHostLifecycleController';
import * as Comlink from "comlink";

const gameListPromise: Promise<{default: GameDescriptor[]}> = (process.env.REACT_APP_SHOW_DEBUG_GAMES)
    ? import("./games/lists/gamesListDebug")
    : import("./games/lists/gamesListRelease");

const hostWorkerCache: Map<string, Promise<Comlink.Remote<IClusterfunHostGameInitializer<IClusterfunHostLifecycleController>>>> = new Map();
const lazyTypeCache: Map<string, React.ComponentType<any>> = new Map();

export async function getGameListPromise(): Promise<GameDescriptor[]> {
    const gameListModule = await gameListPromise;
    return gameListModule.default;
}

// -------------------------------------------------------------------
// getGameHostInitializer
// -------------------------------------------------------------------
export function getGameHostInitializer(gameName: string) {
    if (!hostWorkerCache.has(gameName)) {
        hostWorkerCache.set(gameName, (async () => {
            const gameList = await getGameListPromise();
            const foundGame = gameList.find(g => g.name === gameName);
            if(!foundGame) throw Error(`Could not find game named '${gameName}'`)
            const worker = foundGame.hostWorkerThunk();
            return Comlink.wrap(worker) as Comlink.Remote<IClusterfunHostGameInitializer<IClusterfunHostLifecycleController>>
        })())
    }
    return hostWorkerCache.get(gameName);
}

// -------------------------------------------------------------------
// getGameComponent
// -------------------------------------------------------------------
export function getGameComponent(descriptor: GameManifestItem, config: ClusterFunGameProps) {
    if (!lazyTypeCache.has(descriptor.name)) {
        lazyTypeCache.set(descriptor.name, React.lazy(async () => {
            const gameList = await getGameListPromise();
            const foundGame = gameList.find(g => g.name === descriptor.name);
            if(!foundGame) throw Error(`Could not find game named '${descriptor.name}'`)
            return foundGame.componentImportThunk();
        }))
    }
    const LazyType = lazyTypeCache.get(descriptor.name)!;
    return <div>
        <React.Suspense fallback="Loading...">
            <LazyType {...config} />
        </React.Suspense>
    </div>;
}
