import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage } from "../../libs";
import { action, makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";
import { JoinEndpoint, PauseGameEndpoint, PingEndpoint, QuitEndpoint, ResumeGameEndpoint, TerminateGameEndpoint } from "libs/messaging/basicEndpoints";
import MessageEndpoint from "libs/messaging/MessageEndpoint";

// All games have these states which are managed 
// in the base classes
export enum PresenterGameState 
{
    Gathering = "Gathering",
    Instructions = "Instructions"
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum PresenterGameEvent {
    PlayerJoined = "PlayerJoined",
}


export class ClusterFunPlayer
{
    playerId: string = "";
    @observable name: string = "";
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getPresenterTypeHelper = (derivedClassHelper: ITypeHelper): ITypeHelper =>
 {
     return {
        rootTypeName: derivedClassHelper.rootTypeName,
        getTypeName(o: object) {
            switch(o.constructor) {
                case ClusterFunPlayer: return "ClusterFunPlayer";
            }
            return derivedClassHelper.getTypeName(o);
        },
        constructType(typeName: string):any { 
            switch(typeName){
                case "ClusterFunPlayer": return new ClusterFunPlayer();
            }
            return derivedClassHelper.constructType(typeName); 
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean { return derivedClassHelper.shouldStringify(typeName, propertyName, object); },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            switch(propertyName) {
                case "players": 
                case "_exitedPlayers": 
                    return observable<ClusterFunPlayer>(rehydratedObject as ClusterFunPlayer[]); 
            }
            return derivedClassHelper.reconstitute(typeName, propertyName, rehydratedObject);
        }
     }
}

// -------------------------------------------------------------------
// Base class for all clusterfun game presenters.  
// This handles: 
//      - Player list management, joining, rejoinging, etx. 
//      - General game lifecycle control
// -------------------------------------------------------------------
export abstract class ClusterfunPresenterModel<PlayerType extends ClusterFunPlayer> extends BaseGameModel {
    players = observable<PlayerType>([]);
    _exitedPlayers = new Array<PlayerType>();
    public get isStageOver() {return this.gameTime_ms > this.timeOfStageEnd}
    // The time since game start in milliseconds
    @observable timeOfStageEnd: number = 1;
    @observable secondsLeftInStage: number = 0; // calculated based on timeOfStageEnd
    @observable isPaused: boolean = false;
    @observable currentRound = 0;
    @observable totalRounds = 3;

    @observable  private _showDebugInfo = false;
    get showDebugInfo() {return this._showDebugInfo}
    set showDebugInfo(value) {action(()=>{this._showDebugInfo = value})()}
    

    // General Game Settings
    minPlayers = 3;
    maxPlayers = 8; 
    allowRejoinOnNameOnly = true;
    allowedJoinStates:string[] = [PresenterGameState.Gathering];

    private _stateBeforePause:string = "";
    private _fullyInitialized = false;

    abstract createFreshPlayerEntry(name: string, id: string): PlayerType ;


    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        name: string,
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super(name, sessionHelper, logger, storage);
        makeObservable(this);
        
        this.gameTime_ms = 0;

        this.gameState = PresenterGameState.Gathering;
    }

    reconstitute(): void {
        super.reconstitute();
        this.subscribe(GeneralGameState.Destroyed, "Presenter EndGame", async () =>
        {
            if(this._fullyInitialized){
                await this.requestEveryone(TerminateGameEndpoint, (p, ie) => ({}) );  
                setTimeout(()=>{
                    this.session.serverCall<void>("/api/terminategame", {  roomId: this.roomId, presenterSecret: this.session.personalSecret })           
                },200)
            }
        })
        this.onTick.subscribe("PresenterState", ()=> this.manageState())

        this.listenToEndpoint(JoinEndpoint, this.handleJoinMessage);
        this.listenToEndpoint(QuitEndpoint, this.handlePlayerQuitMessage);
        this.listenToEndpoint(PingEndpoint, this.handlePing);
        setTimeout(()=>this._fullyInitialized = true, 500);
    }

    
    // -------------------------------------------------------------------
    //  handleJoinMessage
    // -------------------------------------------------------------------
    handleJoinMessage = async (sender: string, message: { playerName: string }): Promise<{ isRejoin: boolean, didJoin: boolean, joinError?: string }> => {
        Logger.info(`Join message from ${sender}`)

        // If a player has already joined, any additional Join messages should be idempotent.
        // Do send an Ack in case it's needed, though.
        let resendingPlayer = this.players.find(p => p.playerId === sender) as unknown as PlayerType;
        if (resendingPlayer) {
            Logger.debug(`Repeated join message: ${resendingPlayer.name}`)
            return {
                didJoin: true,
                isRejoin: true
            }
        }

        // If the player isn't currently in the game, but joined previously,
        // find them by playerID first
        let returningPlayer = this._exitedPlayers.find(p => p.playerId === sender) as unknown as PlayerType;

        // It's possible that the player has rebooted their device and doesn't have the player ID anymore -
        // if this is the case and we want to accomodate it, try matching on the player name
        if(!returningPlayer && this.allowRejoinOnNameOnly) {
            returningPlayer = this._exitedPlayers.find(p => p.name === message.playerName) as unknown as PlayerType;
        }

        if(returningPlayer) {
            Logger.info(`Returning player: ${returningPlayer.name}`)
            returningPlayer.playerId = sender;
            const index = this._exitedPlayers.indexOf(returningPlayer);
            this._exitedPlayers.splice(index,1);
            this.players.push(returningPlayer);
            this.telemetryLogger.logEvent("Presenter", "JoinRequest", "ApproveRejoin");
            this.invokeEvent(PresenterGameEvent.PlayerJoined, returningPlayer);
            return {
                didJoin: true,
                isRejoin: true
            }
        }
        else if (this.allowedJoinStates.find(s => s === this.gameState)) {
            Logger.info(`New Player`)
            if(this.players.length < this.maxPlayers)
            {
                let existingPlayer = this.players.find(p => p.name === message.playerName) as unknown as PlayerType;
                if(existingPlayer) {
                    Logger.info(`Denying join because name exists`)
                    this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Name Taken)" );
                    return { didJoin: false, isRejoin: false, joinError: `That name is taken`};
                }
                else {
                    const entry = this.createFreshPlayerEntry(message.playerName, sender);
                    action(()=>{this.players.push(entry)})();                
                    this.saveCheckpoint();
                    this.invokeEvent(PresenterGameEvent.PlayerJoined, entry);     
                    this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Approve new player" );
                    return { didJoin: true, isRejoin: false }
                }
            }
            else {
                this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Full)" );
                return {
                    didJoin: false,
                    isRejoin: false,
                    joinError: "The room is full"
                }
            }
        }
        else {
            this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Not Allowed)");
            return { didJoin: false, isRejoin: false, joinError: `The room is currently closed (game state: ${this.gameState})`}    
        }
    }

    // -------------------------------------------------------------------
    //  handlePlayerQuitMessage
    // -------------------------------------------------------------------
    handlePlayerQuitMessage = async (sender: string, message: any) => {
        if(this.gameState === GeneralGameState.Destroyed) return;
        Logger.info("received quit message from " + sender)
        this.telemetryLogger.logEvent("Presenter", "QuitRequest");
        const player = this.players.find(p => p.playerId === sender);
        if(player) {
            this.players.remove(player);
            this._exitedPlayers.push(player);

            if(this.players.length < this.minPlayers 
                && this.gameState !== PresenterGameState.Gathering) {
                await this.pauseGame();
            }
            this.saveCheckpoint();
        }
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    private manageState()
    {
        this.secondsLeftInStage = 
            Math.max(0, Math.floor((this.timeOfStageEnd - this.gameTime_ms) / 1000));
        this.handleTick();
    }


    // -------------------------------------------------------------------
    //  playAgain - reset the player list and start the game over
    // -------------------------------------------------------------------
    playAgain(resetPlayerList: boolean) {
        if(resetPlayerList) {
            this.players.clear();
        }

        const players = this.players.slice(0);
        this.players.clear();
        players.forEach(player => {
            this.players.push(this.createFreshPlayerEntry(player.name, player.playerId))
        });
        this.telemetryLogger.logEvent("Presenter", "PlayAgain");

        this.prepareFreshGame()
        this.startGame();
    }

    // -------------------------------------------------------------------
    //  startGame
    // -------------------------------------------------------------------
    startGame = () => {
        this.gameState = GeneralGameState.Playing;
        this.prepareFreshRound();
        this.startNextRound();
        this.saveCheckpoint();
        this.telemetryLogger.logEvent("Presenter", "Start");
    }

    // -------------------------------------------------------------------
    //  reset the stage end time to a new value
    // -------------------------------------------------------------------
    setStageEndTime(millisecondsAhead: number) {
        this.timeOfStageEnd = this.gameTime_ms + millisecondsAhead;
    }

    // -------------------------------------------------------------------
    // handle the passage of time. This should include a check for
    // the game state ending when its time expires
    // -------------------------------------------------------------------
    abstract handleTick(): void;

    // -------------------------------------------------------------------
    // Start a game round
    // -------------------------------------------------------------------
    abstract startNextRound(): void;

    // -------------------------------------------------------------------
    // Start a game round
    // -------------------------------------------------------------------
    abstract prepareFreshRound(): void;

    // -------------------------------------------------------------------
    // Start a whole new game
    // -------------------------------------------------------------------
    abstract prepareFreshGame(): void;

    // -------------------------------------------------------------------
    //  resumeGame
    // -------------------------------------------------------------------
    resumeGame = async () => {
        if(this._stateBeforePause === GeneralGameState.Unknown) {
            Logger.warn(`WEIRD:  Attempted resuming with previous unknown state. Current state is ${this.gameState}`)
        }
        else {
            this.gameState = this._stateBeforePause;
            try {
                await this.requestEveryone(ResumeGameEndpoint, (p,exited) => ({}));
            } catch (err) {
                console.error("Not able to reach everyone for resume", err);
            }
        }
        this.isPaused = false;
    }

    // -------------------------------------------------------------------
    //  pauseGame
    // -------------------------------------------------------------------
    pauseGame = async () => {
        this._stateBeforePause = this.gameState;
        this.gameState = GeneralGameState.Paused;
        try {
            await this.requestEveryone(PauseGameEndpoint, (p,exited) => ({}));
        } catch (err) {
            console.error("Not able to reach all players for pause")
        }
        this.isPaused = true;
    }

    // -------------------------------------------------------------------
    //  handle a ping message from the player
    // -------------------------------------------------------------------
    handlePing = (sender: string, message: { pingTime: number }): { pingTime: number, localTime: number } => {
        return { pingTime: message.pingTime, localTime: Date.now() };
    }

    // -------------------------------------------------------------------
    //  requestEveryone - make a request to all players, bundling the responses
    //  in a Promise.all() style array
    //  generateMessage should return falsy if a message should not go
    //  to that player
    // -------------------------------------------------------------------
    async requestEveryone<REQUEST, RESPONSE>(
        endpoint: MessageEndpoint<REQUEST, RESPONSE>, 
        generateRequest: (player: PlayerType, isExited: boolean) => REQUEST | undefined): Promise<(RESPONSE | undefined)[]> {

        const sendToPlayer = (isExited: boolean) => async (player:PlayerType): Promise<RESPONSE | undefined> => {
            // Don't send to self
            if(player.playerId !== this.session.personalId) {
                const request = generateRequest(player, isExited);
                if(request) {
                    const promise = this.session.request<REQUEST, RESPONSE>(endpoint, player.playerId, request);
                    return promise;
                } else {
                    return Promise.resolve(undefined)
                }
            }
        }
        
        return Promise.all(this.players.map(sendToPlayer(false)));
    }

    // -------------------------------------------------------------------
    //  sendToEveryone - send a fire-and-forget message to all players
    //  generateMessage should return falsy if a message should not go
    //  to that player
    // -------------------------------------------------------------------
    sendToEveryone<MESSAGE>(
        endpoint: MessageEndpoint<MESSAGE, void>, 
        generateRequest: (player: PlayerType, isExited: boolean) => MESSAGE | undefined): void {

        const sendToPlayer = (isExited: boolean) => async (player:PlayerType): Promise<void> => {
            // Don't send to self
            if(player.playerId !== this.session.personalId) {
                const request = generateRequest(player, isExited);
                if(request) {
                    this.session.sendMessage(endpoint, player.playerId, request);
                }
            }
        }
        
        this.players.forEach(sendToPlayer(false));
    }
}
