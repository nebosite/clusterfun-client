
import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage, ClusterFunJoinAckMessage, 
    ClusterFunGameOverMessage, ClusterFunTerminateGameMessage, ClusterFunGamePauseMessage, 
    ClusterFunServerStateMessage, ClusterFunGameResumeMessage, ClusterFunQuitMessage, ClusterFunKeepAliveMessage 
} from "../../libs";
import { makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";

export enum GeneralClientState {
    WaitingToStart = "WaitingToStart",
    JoinError = "JoinError",
    Paused = "Paused"
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getClientTypeHelper = (derivedClassHelper: ITypeHelper) =>
 {
     return {
        rootTypeName: derivedClassHelper.rootTypeName,
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

        sessionHelper.addListener(ClusterFunJoinAckMessage, playerName, this.handleJoinAckMessage);
        sessionHelper.addListener(ClusterFunGameOverMessage, playerName, this.handleGameOverMessage);
        sessionHelper.addListener(ClusterFunTerminateGameMessage, playerName, this.handleTerminateGameMessage);
        sessionHelper.addListener(ClusterFunGamePauseMessage, playerName, this.handlePauseMessage);
        sessionHelper.addListener(ClusterFunServerStateMessage, playerName, this.handleServerStateMessage);
        sessionHelper.addListener(ClusterFunGameResumeMessage, playerName, this.handleResumeMessage);

        sessionHelper.onError((err) => {
            console.log(`Session error: ${err}`)
        })

        this.subscribe(GeneralGameState.Destroyed, "GameDestroyed", () =>
        {
            if(!this.gameTerminated) {
                this.session.sendMessageToPresenter(new ClusterFunQuitMessage({sender: this.playerId}));
            }
        })

        

        this.gameState = GeneralClientState.WaitingToStart;
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
            console.log(`No session on ${this.playerName}`)
            return;
        }
        
        if(this.gameState !== GeneralGameState.Destroyed) {
            this.session.sendMessageToPresenter(new ClusterFunKeepAliveMessage({sender: this.playerId}));
            setTimeout(this.keepAlive, this.KEEPALIVE_INTERVAL_MS)
        }
        else {
            console.log(`Game appears to be over (${this.playerId})`)
        }
    }

    // -------------------------------------------------------------------
    // handleJoinAckMessage 
    // -------------------------------------------------------------------
    handleJoinAckMessage = (message: ClusterFunJoinAckMessage) => {

        if(!message.didJoin) {
            this.joinError = message.joinError ?? "Unknown reason";
            this.gameState = GeneralClientState.JoinError;
        }
        else if(!message.isRejoin){
            this.clearCheckpoint();
            this.gameState = GeneralClientState.WaitingToStart;
        }
        else {
            console.log("Rejoining...")
            this.unStashCheckpoint();
            this.gameState = GeneralClientState.WaitingToStart;
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
        console.log("Presenter has terminated the game")
        this.gameTerminated = true;
        this.quitApp();
    }

    prepauseState: string = GeneralGameState.Unknown
    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handlePauseMessage = (message: ClusterFunGamePauseMessage | undefined) => {
        this.prepauseState = this.gameState;
        this.gameState = GeneralClientState.Paused
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
        if(this.gameState === GeneralClientState.JoinError) return;
        
        this.assignClientStateFromServerState(message.state);
        if(message.isPaused) {
            this.handlePauseMessage(undefined);
        }
    }
}
