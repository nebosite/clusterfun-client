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

    const fallback = <div style={{
            display: "flex",
            width: "100%", 
            height: "100%", 
            background: "lightgreen",
            fontSize:"200%",
            justifyContent: "center",
            alignItems: "center"
        }}><div>Loading...</div></div>
    return <div>
        <React.Suspense fallback={fallback}>
            <descriptor.lazyType {...config} />
        </React.Suspense>
    </div>;
}
