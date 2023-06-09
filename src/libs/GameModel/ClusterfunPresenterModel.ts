
import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage, ClusterFunPlayer, GameRole } from "..";
import { action, makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";
import { GameOverEndpoint, InvalidateStateEndpoint, JoinClientEndpoint, JoinPresenterEndpoint, PauseGameEndpoint, PingEndpoint, QuitClientEndpoint, ResumeGameEndpoint, TerminateGameEndpoint } from "libs/messaging/basicEndpoints";

export enum GeneralClientGameState {
    WaitingToStart = "WaitingToStart",
    JoinError = "JoinError",
    Paused = "Paused"
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getPresenterTypeHelper = (derivedClassHelper: ITypeHelper): ITypeHelper =>
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
// Presenter data and logic
// -------------------------------------------------------------------
export abstract class ClusterfunPresenterModel<PlayerType extends ClusterFunPlayer> extends BaseGameModel  {
    players = observable<PlayerType>([]);
    public get isStageOver() {return this.gameTime_ms > this.timeOfStageEnd }
    // The time since game start in milliseconds
    @observable timeOfStageEnd: number = 1;
    @observable secondsLeftInStage: number = 0; // calculated based on timeOfStageEnd
    @observable isPaused: boolean = false;
    @observable currentRound = 0;
    @observable totalRounds = 3;

    @observable  private _showDebugInfo = false;
    get showDebugInfo() {return this._showDebugInfo}
    set showDebugInfo(value) {action(()=>{this._showDebugInfo = value})()}
    get playerId() { return this.session.personalId}
    @observable joinError: string | null = null;
    @observable roundNumber: number = 0;
    gameTerminated = false;
    private _stateIsInvalid = true;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(name: string, sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage)
    {
        super(name, sessionHelper, logger, storage);
        makeObservable(this);
    }

    reconstitute():void {
        super.reconstitute();
        this.listenToEndpointFromHost(InvalidateStateEndpoint, this.handleInvalidateStateMessage);
        this.listenToEndpointFromHost(GameOverEndpoint, this.handleGameOverMessage);
        this.listenToEndpointFromHost(TerminateGameEndpoint, this.handleTerminateGameMessage);
        this.listenToEndpointFromHost(PauseGameEndpoint, this.handlePauseMessage);
        this.listenToEndpointFromHost(ResumeGameEndpoint, this.handleResumeMessage);

        this.subscribe(GeneralGameState.Destroyed, "GameDestroyed", () =>
        {
            if(!this.gameTerminated) {
                this.session.requestHost(QuitClientEndpoint, {}).forget();
            }
        })

        this.session.requestHost(JoinPresenterEndpoint, { }).then(ack => {
            this.handleJoinAck(ack);
            this._stateIsInvalid = true;
            this.requestGameStateFromHost().then(() => this._stateIsInvalid = false);
        });
        this.keepAlive();
    }
    abstract requestGameStateFromHost(): Promise<void>;

    KEEPALIVE_INTERVAL_MS = 10 * 1000;  // ten seconds

    // -------------------------------------------------------------------
    // keepAlive 
    // -------------------------------------------------------------------
    keepAlive = async () => {
        if(!this.session) {
            Logger.info(`No session on presenter`)
            return;
        }
        
        if(this.gameState !== GeneralGameState.Destroyed) {
            try {
                this.session.requestHost(PingEndpoint, { pingTime: Date.now() })
            } catch (err) {
                Logger.warn("Ping message was not received:", err);
            }
            setTimeout(this.keepAlive, this.KEEPALIVE_INTERVAL_MS)
        }
        else {
            Logger.info(`Game appears to be over (${this.playerId})`)
        }
    }

    // -------------------------------------------------------------------
    // handleJoinAckMessage 
    // -------------------------------------------------------------------
    handleJoinAck = (message: { isRejoin: boolean, didJoin: boolean, joinError?: string }) => {

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
    //  handleInvalidateStateMessage
    // -------------------------------------------------------------------
    handleInvalidateStateMessage = (message: unknown) => {
        this._stateIsInvalid = true;
        this.requestGameStateFromHost().then(() => this._stateIsInvalid = false);
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleGameOverMessage = (message: unknown) => {
        this.gameState = GeneralGameState.GameOver;
        this.saveCheckpoint();
        return {};
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleTerminateGameMessage = (message: unknown) => {
        Logger.info("Presenter has terminated the game")
        this.gameTerminated = true;
        this.quitApp();
        return {};
    }

    prepauseState: string = GeneralGameState.Unknown
    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handlePauseMessage = (message: unknown): any => {
        this.prepauseState = this.gameState;
        this.gameState = GeneralClientGameState.Paused
        this.saveCheckpoint();
        return {};
    }

    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handleResumeMessage = (message: unknown): any => {
        if(this.prepauseState !== GeneralGameState.Unknown) {
            this.gameState = this.prepauseState;
            this.saveCheckpoint();
        }
        return {};
    }
}
