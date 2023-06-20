// Host Worker for Stressato
// Initialize with new SharedWorker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() to get an object of type 
// Comlink.Remote<IClusterfunHostGameInitializer<IStressatoHostWorkerLifecycleController>>

import * as Comlink from "comlink";
import { IStressatoHostWorkerLifecycleController } from "./IHostWorkerLifecycleController";
import { StressatoHostModel, getStressatoHostTypeHelper,  } from "../models/HostModel";
import { ClusterfunHostGameInitializer } from "../../../libs/worker/ClusterfunHostGameInitializer";
import Logger from "js-logger";

// eslint-disable-next-line
Logger.useDefaults();
Logger.setLevel(Logger.DEBUG);

class StresstatoHostGameInitializer extends ClusterfunHostGameInitializer<
IStressatoHostWorkerLifecycleController, StressatoHostModel> {
    getGameName(): string {
        return "Stressato";
    }
    protected getDerviedHostTypeHelper = getStressatoHostTypeHelper;
    protected createLifecycleController(appModel: StressatoHostModel): IStressatoHostWorkerLifecycleController {
        return {
            startGame: () => {
                console.log("Game started");
                appModel.startGame()
            },
            pauseGame: () => appModel.pauseGame(),
            resumeGame: () => appModel.resumeGame(),
            endGame: () => appModel.quitApp(),
        }
    }
    
}

const initializer = new StresstatoHostGameInitializer();
Comlink.expose(initializer);