import { IMessageThing, ISessionHelper, MessagePortMessageThing, SessionHelper, WebSocketMessageThing } from "libs/messaging";
import { IClusterfunHostGameControllerBundle, IClusterfunHostGameInitializer } from "./IClusterfunHostGameInitializer";
import { IClusterfunHostLifecycleController } from "./IClusterfunHostLifecycleController";
import { ClusterFunGameProps } from "libs/config/ClusterFunGameProps";
import { ITypeHelper } from "libs/storage/BruteForceSerializer";
import { GameInstanceProperties } from "libs/config/GameInstanceProperties";
import { MockTelemetryLogger } from "libs/telemetry";
import { getStorage } from "libs/storage";
import { BaseGameModel, getHostTypeHelper, instantiateGame } from "libs/GameModel";
import * as Comlink from "comlink";

export abstract class ClusterfunHostGameInitializer<
    TController extends IClusterfunHostLifecycleController,
    TAppModel extends BaseGameModel> 
    implements IClusterfunHostGameInitializer<TController> {

    async init(
        serverCall: <T>(url: string, payload: any | undefined) => PromiseLike<T>,
        serverSocketEndpoint: string | MessagePort,
        onGameEnded: () => void): 
        Promise<IClusterfunHostGameControllerBundle<TController>> {
        const gameProperties = await this.createGame(serverCall);
        const messageThing = this.createMessageThing(gameProperties, serverSocketEndpoint);
        const sessionHelper = new SessionHelper(
            messageThing, 
            gameProperties.roomId, 
            gameProperties.hostId,
            serverCall
            );

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

        const lifecycleController = this.createLifecycleController(appModel);
        const lifecycleControllerChannel = new MessageChannel();
        Comlink.expose(lifecycleController, lifecycleControllerChannel.port1);
        // NOTE: Proxy bundling does not mix well when stacked too far.
        // A good Get-Out-of-Jail-Free card, however, is to send MessagePort objects,
        // which are transferable, for new proxied objects.
        return Comlink.transfer({
            roomId: gameProperties.roomId,
            lifecycleControllerPort: lifecycleControllerChannel.port2
        }, [lifecycleControllerChannel.port2])
    }

    private async createGame(serverCall: <T>(url: string, payload: any | undefined) => PromiseLike<T>): Promise<GameInstanceProperties> {
        const gameName = this.getGameName();
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
            return new WebSocketMessageThing(gameProperties.roomId, gameProperties.personalId, gameProperties.personalSecret);
        } else {
            return new MessagePortMessageThing(serverSocketEndpoint, gameProperties.personalId);
        }
    }

    protected abstract getGameName(): string;

    protected abstract getDerviedHostTypeHelper(sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps): ITypeHelper;

    protected abstract createLifecycleController(appModel: TAppModel): TController;
}