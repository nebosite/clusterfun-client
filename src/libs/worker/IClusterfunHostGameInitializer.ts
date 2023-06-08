import * as Comlink from "comlink";
import { IStorage } from "libs/storage";
import { ITelemetryLogger } from "libs/telemetry";
import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";

export interface ClusterfunHostProps {
    /**
     * A function that allows arbitrary calls to a server
     * @param url The path of the API to load
     * @param payload Any payload to provide in the body of the 
     */
    serverCall<T>(url: string, payload: any | undefined): PromiseLike<T>;
    /**
     * The endpoint to connect to for a socket.
     * If this property is a string, then the host will interpret it as a
     * fully qualified origin and create a real Websocket to it.
     * If this property is a transferred MessagePort, that port will be used.
     */
    serverSocketEndpoint: string | MessagePort;
    /**
     * A function to call when the game ends
     * @returns
     */
    onGameEnded: () => void;
}

/**
 * A bundle of objects returned by init(),
 * allowing communication with the server
 */
export interface IClusterfunHostGameControllerBundle<T extends IClusterfunHostLifecycleController> {
    /**
     * The ID of the created room
     */
    roomId: string;
    /**
     * A MessagePort to which a lifecycle controller of type T has been exposed
     */
    lifecycleControllerPort: MessagePort

    // TODO: Add a MessagePort for shortcut communication between the host and device it's running on
}

/**
 * The root interface exposed by a Worker that hosts a game.
 * Grants the ability to initialize and host a new game.
 */
export interface IClusterfunHostGameInitializer<T extends IClusterfunHostLifecycleController> {
    init(serverCall: <T>(url: string, payload: any | undefined) => PromiseLike<T>,
    serverSocketEndpoint: string | MessagePort,
    onGameEnded: () => void): Promise<IClusterfunHostGameControllerBundle<T>>
}