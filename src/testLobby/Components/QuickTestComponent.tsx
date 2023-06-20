import React from "react";
import { observer } from "mobx-react";
import * as Comlink from "comlink";
import { IClusterfunHostGameInitializer } from "libs/worker/IClusterfunHostGameInitializer";
import Logger from "js-logger";
import { ILexibleHostWorkerLifecycleController } from "games/Lexible/workers/IHostWorkerLifecycleController";
import { getStorage } from "libs";

class QuickState {
    initializer = Comlink.wrap(/* webpackChunkName: "quick-test-worker" */ new SharedWorker(new URL("../../games/Lexible/workers/HostWorker", import.meta.url), { type: "module" }).port) as 
        unknown as Comlink.Remote<IClusterfunHostGameInitializer<ILexibleHostWorkerLifecycleController>>;
    controller?: Comlink.Remote<ILexibleHostWorkerLifecycleController>;
    roomId?: string;
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
            const storage = getStorage("quick_test_host");
            this.st.roomId = await this.st.initializer.startNewGameOnRemoteOrigin("http://localhost:8080", Comlink.proxy(storage));
            this.st.controller = Comlink.wrap((await this.st.initializer.getLifecycleControllerPort(this.st.roomId))!) as Comlink.Remote<ILexibleHostWorkerLifecycleController>;
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
