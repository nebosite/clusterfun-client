import React from "react";
import ReactDOM from "react-dom";
import { LobbyModel } from "lobby/models/LobbyModel";
import { WebSocketMessageThing, TelemetryLoggerFactory, MockTelemetryLoggerFactory } from "libs";
import { getStorage } from "libs/storage/StorageHelper";
import GameTestComponent from "testLobby/Components/GameTestComponent";
import LobbyMainPage from "lobby/views/LobbyMainPage";
import { GameTestModel } from "testLobby/models/GameTestModel";
import QuickTestComponent from "testLobby/Components/QuickTestComponent";
import {isMobile} from 'react-device-detect';
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";

const packageInfo = require("../package.json");

export class GLOBALS {
    static Version = packageInfo.version;
    static Title = `ClusterFun.tv ${(process.env.REACT_APP_DEVMODE === "development") ? "DEV": "" } ${GLOBALS.Version}`;
    static IsMobile = isMobile;
}

document.title = GLOBALS.Title;

// auto-redirect http to http on the prod server
if (window.location.href.toLowerCase().startsWith('http://clusterfun.tv')) {
    window.location.replace(`https:${window.location.href.substring(5)}`);
}

console.log(`MOBILE: ${GLOBALS.IsMobile}`)
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

const telemetryFactory=  new TelemetryLoggerFactory([]);

const quickTest = process.env.REACT_APP_QUICKTEST ?? false;
// -------------------------------------------------------------------
// Development: Render test Lobby
// -------------------------------------------------------------------
if (quickTest) {
    ReactDOM.render(
        <QuickTestComponent />,
        document.getElementById("root")
      );        

}
else if (process.env.REACT_APP_DEVMODE === 'development') {
    //console.log(`------- TEST PAGE RELOAD -------------------`)
    const factory = process.env.REACT_APP_USE_REAL_TELEMETRY 
        ? telemetryFactory
        : new MockTelemetryLoggerFactory();

    const gameTestModel = new GameTestModel(4, getStorage("clusterfun_test"), factory);
    ReactDOM.render(
        <GameTestComponent gameTestModel={gameTestModel} />,
        document.getElementById("root")
      );        
}

// -------------------------------------------------------------------
// Production: Render Lobby
// -------------------------------------------------------------------
else {
    console.log(`------- PAGE RELOAD -------------------`)

    let cachedMessageThings = new Map<string, WebSocketMessageThing>()
    const lobbyModel = new LobbyModel(
        {
            messageThingFactory: (gp: GameInstanceProperties) => {
                //console.log(`getting message thing for ${gp.personalSecret}`)
                let cachedThing = cachedMessageThings.get(gp.personalSecret);
                if(!cachedThing || cachedThing.isClosed)
                {
                    console.log(`Caching a new web socket for ${gp.personalSecret}...`)
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

    ReactDOM.render(
        <LobbyMainPage lobbyModel={lobbyModel} />,
        document.getElementById("root") 
    );             
}


