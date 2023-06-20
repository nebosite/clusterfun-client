import { IServerCall } from "libs/messaging/serverCall";
import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";
import { GameInstanceProperties } from "libs/config";
import { IStorage } from "libs/storage";

/**
 * A message port that, when wrapped with Comlink.wrap(), exposes an object for controlling
 * the lifecycle of a host controller.
 */
export type LifecycleControllerMessagePort<T extends IClusterfunHostLifecycleController> = MessagePort;

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
    startNewGameOnRemoteOrigin(origin: string, storage: IStorage): Promise<string>;
    /**
     * Starts a new game on a simulated Clusterfun API server accessible via the given serverCall function
     * and communications port.
     * @param serverCall An interface to a mocked/real API server, used to create the game
     * @param messagePortFactory A callback that creates a port to connect to a room
     */
    startNewGameOnMockedServer(
        serverCall: IServerCall<unknown>, 
        messagePortFactory: (gp: GameInstanceProperties) => (MessagePort | PromiseLike<MessagePort>),
        storage: IStorage): Promise<string>;
    /**
     * Returns whether or not a host is available for the given room ID
     * @param roomId The room ID to detect
     */
    isHostAvailable(roomId: string): boolean;
    /**
     * Get a MessagePort that, when wrapped with Comlink.wrap(), exposes an object for 
     * controlling the lifecycle of the host controller indicated by the given room ID.
     * If no host controller for that room is available, return undefined.
     */
    getLifecycleControllerPort(roomId: string): LifecycleControllerMessagePort<T> | undefined;
}