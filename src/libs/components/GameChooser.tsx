import { GameInstanceProperties, UIProperties, IMessageThing, ITelemetryLogger, IStorage } from '../../libs';
import React from 'react';

export interface GameDescriptor { 
    name: string, 
    tags: string[], 
    logoName: string, 
    lazyType: React.LazyExoticComponent<any> 
}

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
// getGameComponent
// -------------------------------------------------------------------
export function getGameComponent(descriptor: GameDescriptor, config: ClusterFunGameProps) {
    console.log(`Creating component for ${descriptor.name} ${config.gameProperties.role} ${config.gameProperties.personalId}`)
    return <div>
        <React.Suspense fallback="Loading...">
            <descriptor.lazyType {...config} />
        </React.Suspense>
    </div>;
}
