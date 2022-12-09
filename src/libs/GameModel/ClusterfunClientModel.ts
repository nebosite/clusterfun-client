
import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage, ClusterFunJoinAckMessage, 
    ClusterFunGameOverMessage, ClusterFunTerminateGameMessage, ClusterFunGamePauseMessage, 
    ClusterFunServerStateMessage, ClusterFunGameResumeMessage, ClusterFunQuitMessage, ClusterFunKeepAliveMessage 
} from "../../libs";
import { makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";

export enum GeneralClientGameState {
    WaitingToStart = "WaitingToStart",
    JoinError = "JoinError",
    Paused = "Paused"
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getClientTypeHelper = (derivedClassHelper: ITypeHelper): ITypeHelper =>
 {
     return {
        rootTypeName: derivedClassHelper.rootTypeName,
        getTypeName(o: object) {
            return derivedClassHelper.getTypeName(o);
        },
        constructType(typeName: string):any 
            { return derivedClassHelper.constructType(typeName); },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean 
            { return derivedClassHelper.shouldStringify(typeName, propertyName, object); },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
            { return derivedClassHelper.reconstitute(typeName, propertyName, rehydratedObject); }
     }
}

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export abstract class ClusterfunClientModel extends BaseGameModel  {
    @observable private _playerName: string;
    get playerName() { return this._playerName; }
    get playerId() { return this.session.personalId}
    @observable joinError: string | null = null;
    @observable roundNumber: number = 0;
    gameTerminated = false;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(name: string, sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage)
    {
        super(name, sessionHelper, logger, storage);
        makeObservable(this);
        this._playerName = playerName;

        sessionHelper.addListener(ClusterFunJoinAckMessage, this, this.handleJoinAckMessage);
        sessionHelper.addListener(ClusterFunGameOverMessage, this, this.handleGameOverMessage);
        sessionHelper.addListener(ClusterFunTerminateGameMessage, this, this.handleTerminateGameMessage);
        sessionHelper.addListener(ClusterFunGamePauseMessage, this, this.handlePauseMessage);
        sessionHelper.addListener(ClusterFunServerStateMessage, this, this.handleServerStateMessage);
        sessionHelper.addListener(ClusterFunGameResumeMessage, this, this.handleResumeMessage);

        sessionHelper.onError((err) => {
            Logger.error(`Session error: ${err}`)
        })

        this.subscribe(GeneralGameState.Destroyed, "GameDestroyed", () =>
        {
            if(!this.gameTerminated) {
                this.session.sendMessageToPresenter(new ClusterFunQuitMessage({sender: this.playerId}));
            }
        })

        

        this.gameState = GeneralClientGameState.WaitingToStart;
        this.keepAlive();
    }

    abstract reconstitute():void;
    abstract assignClientStateFromServerState(serverState: string): void;

    KEEPALIVE_INTERVAL_MS = 60 * 1000;  // one minute

    // -------------------------------------------------------------------
    // keepAlive 
    // -------------------------------------------------------------------
    keepAlive = () => {
        if(!this.session) {
            Logger.info(`No session on ${this.playerName}`)
            return;
        }
        
        if(this.gameState !== GeneralGameState.Destroyed) {
            this.session.sendMessageToPresenter(new ClusterFunKeepAliveMessage({sender: this.playerId}));
            setTimeout(this.keepAlive, this.KEEPALIVE_INTERVAL_MS)
        }
        else {
            Logger.info(`Game appears to be over (${this.playerId})`)
        }
    }

    // -------------------------------------------------------------------
    // handleJoinAckMessage 
    // -------------------------------------------------------------------
    handleJoinAckMessage = (message: ClusterFunJoinAckMessage) => {

        if(!message.didJoin) {
            this.joinError = message.joinError ?? "Unknown reason";
            this.gameState = GeneralClientGameState.JoinError;
        }
        else if(!message.isRejoin){
            this.clearCheckpoint();
            this.gameState = GeneralClientGameState.WaitingToStart;
        }
        else {
            Logger.info("Rejoining...")
            this.unStashCheckpoint();
            this.gameState = GeneralClientGameState.WaitingToStart;
        }

        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleGameOverMessage = (message: ClusterFunGameOverMessage) => {
        this.gameState = GeneralGameState.GameOver;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleTerminateGameMessage = (message: ClusterFunTerminateGameMessage) => {
        Logger.info("Presenter has terminated the game")
        this.gameTerminated = true;
        this.quitApp();
    }

    prepauseState: string = GeneralGameState.Unknown
    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handlePauseMessage = (message: ClusterFunGamePauseMessage | undefined) => {
        this.prepauseState = this.gameState;
        this.gameState = GeneralClientGameState.Paused
        this.saveCheckpoint();
        if(message) this.ackMessage(message);
    }

    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handleResumeMessage = (message: ClusterFunGameResumeMessage) => {
        if(this.prepauseState !== GeneralGameState.Unknown) {
            this.gameState = this.prepauseState;
            this.saveCheckpoint();
            this.ackMessage(message);
        }

    }

    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handleServerStateMessage = (message: ClusterFunServerStateMessage) => {
        if(this.gameState === GeneralClientGameState.JoinError) return;
        
        this.assignClientStateFromServerState(message.state);
        if(message.isPaused) {
            this.handlePauseMessage(undefined);
        }
    }
}
