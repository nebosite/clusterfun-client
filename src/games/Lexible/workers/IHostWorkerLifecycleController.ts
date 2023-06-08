import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";

export interface ILexibleHostWorkerLifecycleController extends IClusterfunHostLifecycleController {
    doneGathering(): void;
    startNextRound(): void;
    playAgain(resetPlayerList: boolean): void;
}