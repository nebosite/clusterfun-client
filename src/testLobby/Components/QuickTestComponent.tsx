import React from "react";
import { observer } from "mobx-react";
import * as Comlink from "comlink";
import { IClusterfunHostGameInitializer } from "libs/worker/IClusterfunHostGameInitializer";
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";
import { GameRole } from "libs/config/GameRole";
import Logger from "js-logger";
import { ILexibleHostWorkerLifecycleController } from "games/Lexible/workers/IHostWorkerLifecycleController";

class QuickState {
    initializer = Comlink.wrap(/* webpackChunkName: "quick-test-worker" */ new Worker(new URL("../../games/Lexible/workers/HostWorker", import.meta.url), { type: "module" })) as 
        unknown as Comlink.Remote<IClusterfunHostGameInitializer<ILexibleHostWorkerLifecycleController>>;
    controller?: Comlink.Remote<ILexibleHostWorkerLifecycleController>;
    roomId?: string;
}

// -------------------------------------------------------------------
// _serverCall 
// -------------------------------------------------------------------
async function realServerCall<T>(url: string, payload: any | undefined) {
    if(payload) {
        const response = await fetch("http://localhost:8080" + url, {
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
        const response = await fetch("http://localhost:8080" + url, { method: "GET" });
        if (response.ok) {
            const streamText = await response.text();
            return await JSON.parse(streamText) as T
        } else {
            const responseBody = await response.text();
            throw new Error("Server call failed" + responseBody);
        }        
    }

}

function mockServerCall<T>(url: string, payload: any): Promise<T> {
    if(url===("/api/startgame")) {
        const gameProperties: GameInstanceProperties = {
            gameName: payload.gameName,
            role: GameRole.Host,
            roomId: ["BEEF", "FIRE", "SHIP", "PORT", "SEAT"][Math.floor(Math.random() * 5)],
            hostId: "host_id",
            personalId: "host_id",
            personalSecret: "host_secret"
        }
        return Promise.resolve(gameProperties as unknown as T);
    } else {
        throw new Error("Unknown API " + url);
    }
 }

// -------------------------------------------------------------------
// ClientComponent
// -------------------------------------------------------------------
@observer export class QuickTestComponent extends React.Component {
    st = new QuickState();

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {

        const generateController = async () => {
            Logger.info("Requesting init");
            const bundle = await this.st.initializer.init(
                Comlink.proxy(realServerCall),
                "ws://localhost:8080",
                Comlink.proxy(() => {})
            );
            this.st.controller = Comlink.wrap(bundle.lifecycleControllerPort) as Comlink.Remote<ILexibleHostWorkerLifecycleController>;
            this.st.roomId = bundle.roomId;
            Logger.info("Controller successfully obtained");
            this.forceUpdate();
        }

        const endGame = async () => {
            this.st.controller!.endGame();
            this.st.controller![Comlink.releaseProxy]();
            this.st.controller = undefined;
            Logger.info("Controller successfully released");
            this.forceUpdate();
        }

        return (
            <div >
                { !!this.st.roomId && <div>{this.st.roomId}</div>}
                { !!this.st.controller
                    ? (
                        <div>
                            <button onClick={() => this.st.controller!.doneGathering()}>Show Instructions</button>
                            <button onClick={() => this.st.controller!.startGame()}>Start Game</button>
                            <button onClick={() => this.st.controller!.pauseGame()}>Pause Game</button>
                            <button onClick={() => this.st.controller!.resumeGame()}>Resume Game</button>
                            <button onClick={() => this.st.controller!.startNextRound()}>Start Next Round</button>
                            <button onClick={() => this.st.controller!.playAgain(false)}>Play Again</button>
                            <button onClick={() => endGame()}>End Game</button>
                        </div>
                    )
                    : (
                        <button onClick={generateController}>Generate Controller</button>
                    ) 
                }

            </div>
        )
    }        
}
