import { UIProperties } from "libs/types";
import { GameInstanceProperties } from "./GameInstanceProperties";
import { IMessageThing } from "libs/messaging";
import { ITelemetryLogger } from "libs/telemetry";
import { IStorage } from "libs/storage";

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
    uiProperties: UIProperties;
}