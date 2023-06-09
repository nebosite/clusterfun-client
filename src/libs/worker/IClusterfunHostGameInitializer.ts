import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";

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
 * @param init A function for making calls to the server
 * @param serverSocketEndpoint The endpoint to connect to to establish a socket.
 * If a string, the host will interpret it as an origin and create a true web socket.
 * If a MessagePort, the port will be used to send messages.
 * @param onGameEnded A function to call when the game ends
 */
export interface IClusterfunHostGameInitializer<T extends IClusterfunHostLifecycleController> {
    init(serverCall: <T>(url: string, payload: any | undefined) => PromiseLike<T>,
    serverSocketEndpoint: string | MessagePort,
    onGameEnded: () => void): Promise<IClusterfunHostGameControllerBundle<T>>
    // TODO: Add a proxy for accessing storage - all storage calls need to run on the UI thread
}