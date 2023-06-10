// Host Worker for Lexible
// Initialize with new SharedWorker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() on the port to get an object of type 
// Comlink.Remote<IClusterfunHostGameInitializer<ILexibleHostWorkerLifecycleController>>

import * as Comlink from "comlink";
import { ILexibleHostWorkerLifecycleController } from "./IHostWorkerLifecycleController";
import { LexibleHostModel, getLexibleHostTypeHelper } from "../models/HostModel";
import { ClusterfunHostGameInitializer } from "../../../libs/worker/ClusterfunHostGameInitializer";
import Logger from "js-logger";

// eslint-disable-next-line
Logger.useDefaults();
Logger.setLevel(Logger.DEBUG);

class LexibleHostGameInitializer extends ClusterfunHostGameInitializer<
    ILexibleHostWorkerLifecycleController, LexibleHostModel> {
    getGameName(): string {
        return "Lexible";
    }
    protected getDerviedHostTypeHelper = getLexibleHostTypeHelper;
    protected createLifecycleController(appModel: LexibleHostModel): ILexibleHostWorkerLifecycleController {
        return {
            startGame: () => {
                console.log("Game started");
                appModel.startGame()
            },
            pauseGame: () => appModel.pauseGame(),
            resumeGame: () => appModel.resumeGame(),
            endGame: () => appModel.quitApp(),
            startNextRound: () => appModel.startNextRound(),
            doneGathering: () => appModel.doneGathering(),
            playAgain: (resetPlayerList: boolean) => appModel.playAgain(resetPlayerList),
        }
    }
    
}

const initializer = new LexibleHostGameInitializer();

global.addEventListener("connect", (raw_event) => {
    const event = raw_event as unknown as MessageEvent;
    const port = event.ports[0];
    Comlink.expose(initializer, port);
})