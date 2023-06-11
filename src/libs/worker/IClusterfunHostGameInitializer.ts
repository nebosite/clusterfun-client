import { IServerCall } from "libs/messaging/serverCall";
import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";

/**
 * A message port that, when wrapped with Comlink.wrap(), exposes an object for controlling
 * the lifecycle of a host controller.
 */
export type LifecycleControllerMessagePort<T extends IClusterfunHostLifecycleController> = MessagePort;

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
 * Grants the ability to initialize and host a new game,
 * and retrieve the controller for an existing game.
 */
export interface IClusterfunHostGameInitializer<T extends IClusterfunHostLifecycleController> {
    /**
     * Returns the name of the game being played - use this to confirm
     * that the correct Worker has been initialized
     */
    getGameName(): string;
    /**
     * Starts a new game on a real Clusterfun API server specified by the origin.
     * @param origin The fully-qualified origin (e.g. `"https://clusterfun.tv"`)
     */
    startNewGameOnRemoteOrigin(origin: string): Promise<string>;
    /**
     * Starts a new game on a simulated Clusterfun API server accessible via the given serverCall function
     * and communications port.
     * @param serverCall An interface to a mocked/real API server, used to create the game
     */
    // TODO: Create a better API for this that can correctly survive refreshes -
    //       perhaps the ServerCall should be a proper interface that can create
    //       sockets on demand.
    startNewGameOnMockedServer(serverCall: IServerCall, messagePort: MessagePort): Promise<string>;
    /**
     * Get a MessagePort that, when wrapped with Comlink.wrap(), exposes an object for 
     * controlling the lifecycle of the host controller indicated by the given room ID.
     * If no host controller for that room is available, return undefined.
     */
    // TODO: Since we only have one value now, we might be able to pass a proxy back directly
    getLifecycleControllerPort(roomId: string): LifecycleControllerMessagePort<T> | undefined;
}