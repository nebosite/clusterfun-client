import Logger from 'js-logger';
import {createRoot} from 'react-dom/client'
import { LobbyModel } from "./lobby/models/LobbyModel";
import { GameTestComponent } from "./testLobby/Components/GameTestComponent";
import { LobbyMainPage } from "./lobby/views/LobbyMainPage";
import { GameTestModel } from "./testLobby/models/GameTestModel";
import { QuickTestComponent } from "./testLobby/Components/QuickTestComponent";
import { googleTrackingIds } from "secrets";
import { GameInstanceProperties, getStorage, MockTelemetryLoggerFactory, TelemetryLoggerFactory, WebSocketMessageThing } from './libs';
import { GameManifestItem, allGames, GameDescriptor } from "./GameChooser"
import { GLOBALS } from './Globals';
import 'index.css'
import React from 'react';

// Configure logging levels here
// TODO: While in production, set default log level to WARN/ERROR
// eslint-disable-next-line
Logger.useDefaults();
if (process.env.REACT_APP_DEVMODE === 'development') {
    Logger.setLevel(Logger.DEBUG);
} else {
    Logger.setLevel(Logger.WARN);
}

const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

const showParam = (params as any).show;

const rootContainer = document.getElementById('root') as HTMLElement;
const root = createRoot(rootContainer);

document.title = GLOBALS.Title;

// auto-redirect http to http on the prod server
if (window.location.href.toLowerCase().startsWith('http://clusterfun.tv')) {
    window.location.replace(`https:${window.location.href.substring(5)}`);
}

Logger.debug(`MOBILE: ${GLOBALS.IsMobile}`)
// -------------------------------------------------------------------
// _serverCall 
// -------------------------------------------------------------------
async function serverCall<T>(url: string, payload: any | undefined) {
    if(payload) {
        const response = await fetch(url, {
            method: "POST",
            headers: [
                ['Content-Type', 'application/json']
            ],
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            return await response.json() as T
        } else {
            const responseBody = await response.text();
            throw new Error("Failed to connect to game: " + responseBody);
        }        
    }
    else {
        const response = await fetch(url, { method: "GET" });
        if (response.ok) {
            const streamText = await response.text();
            return await JSON.parse(streamText) as T
        } else {
            const responseBody = await response.text();
            throw new Error("Server call failed" + responseBody);
        }        
    }

}

// Get the google analitics measurement ID from :  https://analytics.google.com/analytics/web/#/a169765098p268496630/admin/streams/table/2416371752

const telemetryFactory=  new TelemetryLoggerFactory(googleTrackingIds);

const quickTest = process.env.REACT_APP_QUICKTEST ?? false;
// -------------------------------------------------------------------
// Development: Render test Lobby
// -------------------------------------------------------------------
if (quickTest) {
    root.render( <QuickTestComponent /> );        

}
else if (process.env.REACT_APP_DEVMODE === 'development') {
    const factory = process.env.REACT_APP_USE_REAL_TELEMETRY 
        ? telemetryFactory
        : new MockTelemetryLoggerFactory();

    const gameTestModel = new GameTestModel(4, getStorage("clusterfun_test"), factory);
    
    const games: GameDescriptor[] = allGames.map((g) => {
        const item = {...g}
        item.tags = []
        return item;
    });
    
    root.render( <GameTestComponent gameTestModel={gameTestModel} games={games} /> );        
}

// -------------------------------------------------------------------
// Production: Render Lobby
// -------------------------------------------------------------------
else {
    Logger.info(`------- PAGE RELOAD -------------------`)

    let cachedMessageThings = new Map<string, WebSocketMessageThing>()
    const lobbyModel = new LobbyModel(
        {
            messageThingFactory: (gp: GameInstanceProperties) => {
                let cachedThing = cachedMessageThings.get(gp.personalSecret);
                if(!cachedThing || cachedThing.isClosed)
                {
                    Logger.debug(`Caching a new web socket for ${gp.personalSecret}...`)
                    cachedThing = new WebSocketMessageThing(gp.roomId, gp.personalId, gp.personalSecret)
                    cachedMessageThings.set(gp.personalSecret, cachedThing)
                }
                return cachedThing;
            },
            serverCall: serverCall,
            storage: getStorage("clusterfun"),            
            telemetryFactory,
            onGameEnded: () => {},
        }
        , "mainLobby");

    // TODO: Add server loading code here along with a check to make sure empty list of games works
    // TODO: Fill game list dynamically
    setTimeout(async() => {
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

        const gameList = gamesFromServerManifest.map(serverItem => {
            const foundGame = allGames.find(g => g.name.toLowerCase() === serverItem.name.toLowerCase()) 
            const debugOK = showParam === "debug"
            if(foundGame) {
                if(foundGame.tags.find(t => t.toLowerCase() === "debug") && !debugOK)
                {
                    // exclude this debug item
                    return undefined;
                }
                else {
                    const addMe = {...foundGame}
                    if(serverItem.displayName) addMe.displayName = serverItem.displayName
                    addMe.tags = serverItem.tags;
                    return addMe                    
                }
            }
            else {
                Logger.warn(`Server specified a game I don't know about: ${serverItem.name}`)
                return undefined;
            }
        }).filter(i => i !== undefined) as GameDescriptor[]

        root.render( <LobbyMainPage lobbyModel={lobbyModel} games={gameList}/> );             

    },0)
    root.render( <div>Loading stuff....</div> );     
}
