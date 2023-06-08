// Host Worker for Lexible
// Initialize with new Worker("./path/to/HostWorker", { type: "module" })
// and use Comlink.wrap() to get an object of type Comlink.Remote<IClusterfunHostGameInitializer<ILexibleHostWorkerLifecycleController>>

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
    protected getGameName(): string {
        return "Lexible";
    }
    protected getDerviedHostTypeHelper = getLexibleHostTypeHelper;
    protected createLifecycleController(appModel: LexibleHostModel): ILexibleHostWorkerLifecycleController {
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
            doneGathering: () => appModel.doneGathering(),
            playAgain: (resetPlayerList: boolean) => appModel.playAgain(resetPlayerList),
        }
    }
    
}

Comlink.expose(new LexibleHostGameInitializer());