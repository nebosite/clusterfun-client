import { UIProperties } from "libs/types";
import { GameInstanceProperties } from "./GameInstanceProperties";
import { IMessageThing } from "libs/messaging";
import { ITelemetryLogger } from "libs/telemetry";
import { IStorage } from "libs/storage";
import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";
import * as Comlink from "comlink";

// -------------------------------------------------------------------
// ClusterFunGameProps
// -------------------------------------------------------------------
export interface ClusterFunGameProps {
    playerName?: string;
    gameProperties: GameInstanceProperties;
    messageThing: IMessageThing;
    logger: ITelemetryLogger;
    storage: IStorage;
    onGameEnded: () => void;
    serverCall: <T>(url: string, payload: any) => PromiseLike<T>
}

// -------------------------------------------------------------------
// ClusterFunGameAndUIProps
// -------------------------------------------------------------------
export interface ClusterFunGameAndUIProps extends ClusterFunGameProps {
    hostController?: Comlink.Remote<IClusterfunHostLifecycleController> | null;
    uiProperties: UIProperties;
}