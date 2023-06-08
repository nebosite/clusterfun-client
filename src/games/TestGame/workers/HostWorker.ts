// Host Worker for Testato
// Initialize with new Worker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() to get an object of type Comlink.Remote<TestatoHostWorkerInterface>

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
    protected getGameName(): string {
        return "Testato";
    }
    protected getDerviedHostTypeHelper = getTestatoHostTypeHelper;
    protected createLifecycleController(appModel: TestatoHostModel): ITestatoHostWorkerLifecycleController {
        console.log("Reached the lifecycle controller");
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

Comlink.expose(new TestatoHostGameInitializer());