import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";

export interface ITestatoHostWorkerLifecycleController extends IClusterfunHostLifecycleController {
    startNextRound(): void;
}