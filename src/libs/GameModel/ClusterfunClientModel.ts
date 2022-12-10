
import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage } from "../../libs";
import { makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";
import { GameOverEndpoint, InvalidateStateEndpoint, JoinEndpoint, PauseGameEndpoint, PingEndpoint, QuitEndpoint, ResumeGameEndpoint, TerminateGameEndpoint } from "libs/messaging/basicEndpoints";

export enum GeneralClientGameState {
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
    private _stateIsInvalid = true;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(name: string, sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage)
    {
        super(name, sessionHelper, logger, storage);
        makeObservable(this);
        this._playerName = playerName;

    }

    reconstitute():void {
        super.reconstitute();
        this.listenToEndpoint(InvalidateStateEndpoint, this.handleInvalidateStateMessage);
        this.listenToEndpoint(GameOverEndpoint, this.handleGameOverMessage);
        this.listenToEndpoint(TerminateGameEndpoint, this.handleTerminateGameMessage);
        this.listenToEndpoint(PauseGameEndpoint, this.handlePauseMessage);
        this.listenToEndpoint(ResumeGameEndpoint, this.handleResumeMessage);

        // this.session.onError((err) => {
        //     Logger.error(`Session error: ${err}`)
        // })

        this.subscribe(GeneralGameState.Destroyed, "GameDestroyed", () =>
        {
            if(!this.gameTerminated) {
                this.session.request(QuitEndpoint, this.session.presenterId, {}).forget();
            }
        })

        this.gameState = GeneralClientGameState.WaitingToStart;
        this.session.request(JoinEndpoint, this.session.presenterId, { playerName: this._playerName }).then(ack => {
            this.handleJoinAck(ack);
            this._stateIsInvalid = true;
            this.requestGameStateFromPresenter().then(() => this._stateIsInvalid = false);
        });
        this.keepAlive();
    }
    abstract requestGameStateFromPresenter(): Promise<void>;

    KEEPALIVE_INTERVAL_MS = 10 * 1000;  // ten seconds

    // -------------------------------------------------------------------
    // keepAlive 
    // -------------------------------------------------------------------
    keepAlive = () => {
        if(!this.session) {
            Logger.info(`No session on ${this.playerName}`)
            return;
        }
        
        if(this.gameState !== GeneralGameState.Destroyed) {
            this.session.request(PingEndpoint, this.session.presenterId, { pingTime: Date.now() }).then(undefined, (err) => {
                Logger.warn("Ping message was not received:", err);
            })
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
    handleInvalidateStateMessage = (sender: string, message: unknown) => {
        this._stateIsInvalid = true;
        this.requestGameStateFromPresenter().then(() => this._stateIsInvalid = false);
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleGameOverMessage = (sender: string, message: unknown) => {
        this.gameState = GeneralGameState.GameOver;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleTerminateGameMessage = (sender: string, message: unknown) => {
        Logger.info("Presenter has terminated the game")
        this.gameTerminated = true;
        this.quitApp();
    }

    prepauseState: string = GeneralGameState.Unknown
    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handlePauseMessage = (sender: string, message: unknown): any => {
        this.prepauseState = this.gameState;
        this.gameState = GeneralClientGameState.Paused
        this.saveCheckpoint();
        return {};
    }

    // -------------------------------------------------------------------
    // 
    // -------------------------------------------------------------------
    protected handleResumeMessage = (sender: string, message: unknown): any => {
        if(this.prepauseState !== GeneralGameState.Unknown) {
            this.gameState = this.prepauseState;
            this.saveCheckpoint();
        }
        return {};
    }
}
