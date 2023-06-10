import { IMessageThing, ISessionHelper, MessagePortMessageThing, SessionHelper, WebSocketMessageThing } from "libs/messaging";
import { IClusterfunHostGameInitializer, LifecycleControllerMessagePort } from "./IClusterfunHostGameInitializer";
import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";
import { ClusterFunGameProps } from "libs/config/ClusterFunGameProps";
import { ITypeHelper } from "libs/storage/BruteForceSerializer";
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";
import { MockTelemetryLogger } from "libs/telemetry";
import { getStorage } from "libs/storage";
import { BaseGameModel, GeneralGameState, getHostTypeHelper, instantiateGame } from "libs/GameModel";
import * as Comlink from "comlink";
import { ServerCall, createServerCallFromOrigin } from "libs/messaging/serverCall";

// TODO: Convert this to work with a Shared Worker -
// as far as you understand it, multiple requests to the same URL
// will produce the same worker in that scenario, allowing
// multiple tabs to access it or for it to survive between refreshes.
// - To make this work, index the lifecycle controllers you create by room ID,
//   and add a method to retrieve them on demand.
// - Also allow a way to delete lifecycle controllers

// A Set to keep alive message ports.
// TODO: Clean this up when app models are removed

export abstract class ClusterfunHostGameInitializer<
    TController extends IClusterfunHostLifecycleController,
    TAppModel extends BaseGameModel> 
    implements IClusterfunHostGameInitializer<TController> {

    private activeHosts: Map<string, TController> = new Map();

    abstract getGameName(): string;

    async startNewGameOnRemoteOrigin(origin: string): Promise<string> {
        const serverCall = createServerCallFromOrigin(origin);
        console.log("Server call", serverCall);
        const gameProperties = await this.createGame(serverCall);
        console.log(gameProperties);
        const socketOrigin = new URL(origin);
        const messageThing = new WebSocketMessageThing((socketOrigin.protocol === "https:" ? "wss:" : "ws:") + socketOrigin.host, gameProperties.roomId, gameProperties.personalId, gameProperties.personalSecret)
        console.log(messageThing);
        return this.startNewGame_Helper(serverCall, gameProperties, messageThing);
    }

    async startNewGameOnMockedServer(serverCall: ServerCall, messagePort: MessagePort): Promise<string> {
        const gameProperties = await this.createGame(serverCall);
        const messageThing = new MessagePortMessageThing(messagePort, gameProperties.personalId);
        return this.startNewGame_Helper(serverCall, gameProperties, messageThing);
    }

    private startNewGame_Helper(serverCall: ServerCall, gameProperties: GameInstanceProperties, messageThing: IMessageThing): string {
        const sessionHelper = new SessionHelper(
            messageThing, 
            gameProperties.roomId, 
            gameProperties.hostId,
            serverCall
            );

        const onGameEnded = () => {
            this.activeHosts.delete(gameProperties.roomId);
        };

        const logger = new MockTelemetryLogger("mock"); // TODO: Use real telemetry eventually
        const storage = getStorage("clusterfun_host"); // TODO: Use mock storage

        const clusterFunGameProps: ClusterFunGameProps = {
            gameProperties,
            messageThing,
            logger,
            storage,
            onGameEnded,
            serverCall,
        }
        
        const appModel: TAppModel = instantiateGame(
            getHostTypeHelper(this.getDerviedHostTypeHelper(sessionHelper, clusterFunGameProps)),
            logger,
            storage) as TAppModel;

        appModel.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => onGameEnded());
        appModel.reconstitute();

        const lifecycleController = this.createLifecycleController(appModel);
        this.activeHosts.set(gameProperties.roomId, lifecycleController);
        return gameProperties.roomId;
    }

    getLifecycleControllerPort(roomId: string): LifecycleControllerMessagePort<TController> | undefined {
        const controller = this.activeHosts.get(roomId);
        if (!controller) return undefined;

        const channel = new MessageChannel();
        Comlink.expose(controller, channel.port1);
        return Comlink.transfer(channel.port2, [channel.port2]);
    }

    private async createGame(serverCall: ServerCall): Promise<GameInstanceProperties> {
        const gameName = this.getGameName();
        console.log("Game name: ", gameName);
        const payload: any = { gameName };
        const properties = await serverCall<GameInstanceProperties>("/api/startgame", payload);
        // NOTE: Local and Session Storage are not available in Web Workers.
        // We will need to shunt values that we want to save back to the UI thread.
        return properties;
    }

    private createMessageThing(
        gameProperties: GameInstanceProperties, 
        serverSocketEndpoint: string | MessagePort): IMessageThing {
        if (typeof serverSocketEndpoint === "string") {
            return new WebSocketMessageThing(serverSocketEndpoint, gameProperties.roomId, gameProperties.personalId, gameProperties.personalSecret);
        } else {
            return new MessagePortMessageThing(serverSocketEndpoint, gameProperties.personalId);
        }
    }

    protected abstract getDerviedHostTypeHelper(sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps): ITypeHelper;

    protected abstract createLifecycleController(appModel: TAppModel): TController;
}