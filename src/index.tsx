import Logger from 'js-logger';
import {createRoot} from 'react-dom/client'
import { GLOBALS } from './Globals';
import { getGameListPromise } from 'GameChooser';
import { GameDescriptor, GameManifestItem } from 'games/lists/GameDescriptor';
import { GameInstanceProperties } from 'libs/config/GameInstanceProperties';
import { WebSocketMessageThing } from 'libs/messaging/MessageThing';
import 'index.css'
import React from 'react';
import { createServerCallFromOrigin } from 'libs/messaging/serverCall';

// auto-redirect http to https on the prod server
if (window.location.href.toLowerCase().startsWith('http://clusterfun.tv')) {
    window.location.replace(`https:${window.location.href.substring(5)}`);
}

// Configure logging levels here
// TODO: While in production, set default log level to WARN/ERROR
// eslint-disable-next-line
Logger.useDefaults();
if (process.env.REACT_APP_DEVMODE === 'development') {
    Logger.setLevel(Logger.DEBUG);
} else {
    Logger.setLevel(Logger.WARN);
}

const rootContainer = document.getElementById('root') as HTMLElement;
const root = createRoot(rootContainer);

document.title = GLOBALS.Title;

Logger.debug(`MOBILE: ${GLOBALS.IsMobile}`)
// -------------------------------------------------------------------
// _serverCall 
// -------------------------------------------------------------------
const serverCall = createServerCallFromOrigin(window.location.origin);

const telemetryFactoryPromise = (async () => {
    if (process.env.REACT_APP_USE_REAL_TELEMETRY) {
        const realModulePromise = import('./libs/telemetry/TelemetryLogger');
        const googleTrackingIds = (await import('./secrets')).googleTrackingIds;
        const TelemetryLoggerFactory = (await realModulePromise).TelemetryLoggerFactory;
        return new TelemetryLoggerFactory(googleTrackingIds);
    } else {
        const mockModulePromise = import('./libs/telemetry/MockTelemetryLogger');
        const MockTelemetryLoggerFactory = (await mockModulePromise).MockTelemetryLoggerFactory;
        return new MockTelemetryLoggerFactory();
    }
})();

const getStoragePromise = (async () => (await import('./libs/storage/StorageHelper')).getStorage)();

// Get the google analitics measurement ID from :  https://analytics.google.com/analytics/web/#/a169765098p268496630/admin/streams/table/2416371752

const quickTest = process.env.REACT_APP_QUICKTEST ?? false;
// -------------------------------------------------------------------
// Development: Render test Lobby
// -------------------------------------------------------------------
if (quickTest) {
    (async () => {
        const QuickTestComponent = (await import('./testLobby/Components/QuickTestComponent')).QuickTestComponent;
        root.render( <QuickTestComponent /> );
    })();
}
else if (process.env.REACT_APP_DEVMODE === 'development') {
    (async () => {
        const gameTestModuleTypePromise = import('./testLobby/models/GameTestModel');
        const gameListPromise = getGameListPromise();
        const gameTestComponentPromise = import('./testLobby/Components/GameTestComponent');
        const GameTestModel = (await gameTestModuleTypePromise).GameTestModel;
        const GameTestComponent = (await gameTestComponentPromise).GameTestComponent;
        const gameList = await gameListPromise;
        const getStorage = await getStoragePromise;

        const factory = await telemetryFactoryPromise;

        const gameTestModel = new GameTestModel(4, getStorage("clusterfun_test"), factory);

        const games: GameDescriptor[] = gameList.map((g) => {
            const item = {...g}
            item.tags = []
            return item;
        });
        
        root.render( <GameTestComponent gameTestModel={gameTestModel} games={games} /> );
    })();         
}

// -------------------------------------------------------------------
// Production: Render Lobby
// -------------------------------------------------------------------
else {
    (async () => {
        Logger.info(`------- PAGE RELOAD -------------------`)

        const LobbyModel = (await import('./lobby/models/LobbyModel')).LobbyModel;
        const LobbyMainPage = (await import('./lobby/views/LobbyMainPage')).LobbyMainPage;
        const WebSocketMessageThing_class = (await import('./libs/messaging/MessageThing')).WebSocketMessageThing;
        const telemetryFactory = await telemetryFactoryPromise;
        const getStorage = await getStoragePromise;

        let cachedMessageThings = new Map<string, WebSocketMessageThing>()
        const lobbyModel = new LobbyModel(
            {
                messageThingFactory: (gp: GameInstanceProperties) => {
                    const origin = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + window.location.host;
                    let cachedThing = cachedMessageThings.get(gp.personalSecret);
                    if(!cachedThing || cachedThing.isClosed)
                    {
                        Logger.debug(`Caching a new web socket for ${gp.personalSecret}...`)
                        cachedThing = new WebSocketMessageThing_class(origin, gp.roomId, gp.personalId, gp.personalSecret)
                        cachedMessageThings.set(gp.personalSecret, cachedThing)
                    }
                    return cachedThing;
                },
                serverSocketEndpoint: window.location.origin,
                serverCall: serverCall,
                storage: getStorage("clusterfun"),            
                telemetryFactory,
                onGameEnded: () => {},
            }
            , "mainLobby");

        const getGameManifest = async () => {
            const response = await fetch("/api/game_manifest", { method: "GET" });
            if (response.ok) {
                const streamText = await response.text();
                return await JSON.parse(streamText) as GameManifestItem[]
            } else {
                return [] as GameManifestItem[]
            }      
        }

        try {
            var gamesFromServerManifest:GameManifestItem[] = await getGameManifest(); 
        }
        catch(err) {
            root.render( <div>There was a problem trying to load clusterfun.  Please try again later. </div> );     
            return;        
        }

        const allGames = await getGameListPromise();
        const gameList = gamesFromServerManifest.map(serverItem => {
            const foundGame = allGames.find(g => g.name.toLowerCase() === serverItem.name.toLowerCase()) 
            if(foundGame) {
                const addMe = {...foundGame}
                if(serverItem.displayName) addMe.displayName = serverItem.displayName
                addMe.tags = serverItem.tags;
                return addMe                    
            }
            else {
                Logger.warn(`Server specified a game I don't know about: ${serverItem.name}`)
                return undefined;
            }
        }).filter(i => i !== undefined) as GameDescriptor[]

        root.render( <LobbyMainPage lobbyModel={lobbyModel} games={gameList}/> );             

    })();
    root.render( <div>Loading stuff....</div> );     
}
