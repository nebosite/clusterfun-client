// Host Worker for Testato
// Initialize with new SharedWorker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() to get an object of type 
// Comlink.Remote<IClusterfunHostGameInitializer<ITestatoHostWorkerLifecycleController>>

import * as Comlink from "comlink";
import { ITestatoHostWorkerLifecycleController } from "./IHostWorkerLifecycleController";
import { TestatoHostModel, getTestatoHostTypeHelper } from "../models/HostModel";
import { ClusterfunHostGameInitializer } from "../../../libs/worker/ClusterfunHostGameInitializer";
import Logger from "js-logger";

// eslint-disable-next-line
Logger.useDefaults();
Logger.setLevel(Logger.DEBUG);

class TestatoHostGameInitializer extends ClusterfunHostGameInitializer<
    ITestatoHostWorkerLifecycleController, TestatoHostModel> {
    getGameName(): string {
        return "Testato";
    }
    protected getDerviedHostTypeHelper = getTestatoHostTypeHelper;
    protected createLifecycleController(appModel: TestatoHostModel): ITestatoHostWorkerLifecycleController {
        return {
            startGame: () => {
                console.log("Game started");
                appModel.startGame()
            },
            pauseGame: () => appModel.pauseGame(),
            resumeGame: () => appModel.resumeGame(),
            endGame: () => appModel.quitApp(),
            startNextRound: () => appModel.startNextRound(),
        }
    }
    
}

const initializer = new TestatoHostGameInitializer();

global.addEventListener("connect", (raw_event) => {
    const event = raw_event as unknown as MessageEvent;
    const port = event.ports[0];
    Comlink.expose(initializer, port);
})