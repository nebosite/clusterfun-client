import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";
import { MapSize } from "../models/lexibleDataTypes";

export interface ILexibleHostWorkerLifecycleController extends IClusterfunHostLifecycleController {
    doneGathering(): void;
    startNextRound(): void;
    playAgain(resetPlayerList: boolean): void;
    setStartFromTeamArea(startFromTeamArea: boolean): void;
    setMapSize(mapSize: MapSize): void;
    dev_handleRoundWin(team: string): void;
}