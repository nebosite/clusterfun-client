// Host Worker for Stressato
// Initialize with new Worker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() to get an object of type Comlink.Remote<IClusterfunHostGameInitializer<IStressatoHostWorkerLifecycleController>>

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
    protected getGameName(): string {
        return "Stressato";
    }
    protected getDerviedHostTypeHelper = getStressatoHostTypeHelper;
    protected createLifecycleController(appModel: StressatoHostModel): IStressatoHostWorkerLifecycleController {
        console.log("Reached the lifecycle controller");
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

Comlink.expose(new StresstatoHostGameInitializer());