import { UIProperties } from "libs/types";
import { GameInstanceProperties } from "./GameInstanceProperties";
import { IMessageThing } from "libs/messaging";
import { ITelemetryLogger } from "libs/telemetry";
import { IStorage } from "libs/storage";
import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";
import * as Comlink from "comlink";
import { ServerCall } from "libs/messaging/serverCall";

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
    serverCall: ServerCall
}

// -------------------------------------------------------------------
// ClusterFunGameAndUIProps
// -------------------------------------------------------------------
export interface ClusterFunGameAndUIProps extends ClusterFunGameProps {
    hostController?: Comlink.Remote<IClusterfunHostLifecycleController> | null;
    uiProperties: UIProperties;
}