import { IMessageReceipt, ITypeHelper, ISessionHelper, ITelemetryLogger, 
    IStorage, ClusterFunTerminateGameMessage, ClusterFunJoinMessage, ClusterFunQuitMessage, 
    ClusterFunReceiptAckMessage, ClusterFunKeepAliveMessage, ClusterFunServerStateMessage, 
    ClusterFunJoinAckMessage, ClusterFunGameResumeMessage, ClusterFunGamePauseMessage, ClusterFunMessageBase 
} from "../../libs";
import { action, makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";

// All games have these states which are managed 
// in the base classes
export enum PresenterGameState 
{
    Gathering = "Gathering",
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
    pendingMessage?: IMessageReceipt = undefined;
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getPresenterTypeHelper = (derivedClassHelper: ITypeHelper) =>
 {
     return {
        rootTypeName: derivedClassHelper.rootTypeName,
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
        this.subscribe(GeneralGameState.Destroyed, "Presenter EndGame", async () =>
        {
            if(this._fullyInitialized){
                await this.sendToEveryone((p, ie) => new ClusterFunTerminateGameMessage({ sender: this.session.personalId }));  
                setTimeout(()=>{
                    sessionHelper.serverCall<void>("/api/terminategame", {  roomId: this.roomId, presenterSecret: this.session.personalSecret })           
                },200)                
            }
        })
        
        this.gameTime_ms = 0;
        this.onTick.subscribe("PresenterState", ()=> this.manageState())

        sessionHelper.addListener(ClusterFunJoinMessage, "playerJoin", this.handleJoinMessage);
        sessionHelper.addListener(ClusterFunQuitMessage, "playerQuit", this.handlePlayerQuitMessage);
        sessionHelper.addListener(ClusterFunReceiptAckMessage, "playerAck", this.handleReceipts)
        sessionHelper.addListener(ClusterFunKeepAliveMessage, "keepAliveSignal", this.handleKeepAlive)

        this.gameState = PresenterGameState.Gathering;

        setTimeout(()=>this._fullyInitialized = true, 500);
    }

    
    // -------------------------------------------------------------------
    //  handleJoinMessage
    // -------------------------------------------------------------------
    handleJoinMessage = async (message: ClusterFunJoinMessage) => {
        Logger.info(`Join message from ${message.sender}`)

        // Find a player with a matching id - we know this one is an exact match
        let returningPlayer = this._exitedPlayers.find(p => p.playerId === message.sender) as unknown as PlayerType;

        // Maybe they rebooted their device and don't have the id any more - then we will try to 
        // match on the player name. 
        if(!returningPlayer && this.allowRejoinOnNameOnly) {
            returningPlayer = this._exitedPlayers.find(p => p.name === message.name) as unknown as PlayerType;
        }

        const notifyState = () => {
            const isPaused = this.gameState === GeneralGameState.Paused 
            const state = isPaused  ? this._stateBeforePause : this.gameState;

            if(this.gameState === GeneralGameState.Paused) {
            }
            Logger.info(`Sending state to ${message.sender}...`)
            setTimeout(()=>{
                this.session.sendMessage(
                    message.sender,
                    new ClusterFunServerStateMessage({sender: this.session.personalId, state, isPaused})
                )                    
            },100)
        }

        if(returningPlayer) {
            Logger.info(`Returning player: ${returningPlayer.name}`)
            returningPlayer.playerId = message.sender;
            this.session.sendMessage(
                message.sender,
                new ClusterFunJoinAckMessage({ sender: this.session.personalId, didJoin: true, isRejoin: true})
            )
            if(returningPlayer.pendingMessage) {
                const pendingMessage = returningPlayer.pendingMessage
                const playerId = returningPlayer.playerId
                setTimeout(()=>{
                    Logger.info("Resending Pending message to " + playerId)
                    this.session.resendMessage(playerId, pendingMessage);
                },50)
            }

            const index = this._exitedPlayers.indexOf(returningPlayer);
            this._exitedPlayers.splice(index,1);
            this.players.push(returningPlayer);
            this.telemetryLogger.logEvent("Presenter", "JoinRequest", "ApproveRejoin");
            this.invokeEvent(PresenterGameEvent.PlayerJoined, returningPlayer);
            setTimeout(() => {notifyState()}, 250)
        }
        else if (this.allowedJoinStates.find(s => s === this.gameState)) {
            Logger.info(`New Player`)
            if(this.players.length < this.maxPlayers)
            {
                let existingPlayer = this.players.find(p => p.name === message.name) as unknown as PlayerType;
                Logger.info(`Existing Player:: ${existingPlayer?.name}`)
                if(existingPlayer) {
                    Logger.info(`Denying join because name exists`)
                    this.session.sendMessage(
                        message.sender,
                        new ClusterFunJoinAckMessage({ sender: this.session.personalId, didJoin: false, isRejoin: false, joinError: `That name is taken`})   
                    )
    
                    this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Name Taken)" );
                }
                else {
                    const entry = this.createFreshPlayerEntry(message.name, message.sender);
                    this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Approve");
                    action(()=>{this.players.push(entry)})();                

                    this.session.sendMessage(
                        message.sender,
                        new ClusterFunJoinAckMessage({ sender: this.session.personalId, didJoin: true, isRejoin: false})
                    )
                    notifyState();

                    this.saveCheckpoint();
                    this.invokeEvent(PresenterGameEvent.PlayerJoined, entry);     
                    this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Approve new player" );
                }
            }
            else {
                this.session.sendMessage(
                    message.sender,
                    new ClusterFunJoinAckMessage({ sender: this.session.personalId, didJoin: false, isRejoin: false, joinError: "The room is full"})
                )
                this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Full)" );
            }
        }
        else {
            this.session.sendMessage(
                message.sender,
                new ClusterFunJoinAckMessage({ sender: this.session.personalId, didJoin: false, isRejoin: false, joinError: `The room is currently closed (game state: ${this.gameState})`})
            )
            this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Not Allowed)");          
        }
    }

    // -------------------------------------------------------------------
    //  handlePlayerQuitMessage
    // -------------------------------------------------------------------
    handlePlayerQuitMessage = (message: ClusterFunQuitMessage) => {
        if(this.gameState === GeneralGameState.Destroyed) return;
        Logger.info("received quit message from " + message.sender)
        this.telemetryLogger.logEvent("Presenter", "QuitRequest");
        const player = this.players.find(p => p.playerId === message.sender);
        if(player) {
            this.players.remove(player);
            this._exitedPlayers.push(player);

            if(this.players.length < this.minPlayers 
                && this.gameState !== PresenterGameState.Gathering) {
                this.pauseGame();
            }
        }

        this.saveCheckpoint();
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
    resumeGame = () => {
        if(this._stateBeforePause === GeneralGameState.Unknown) {
            Logger.warn(`WEIRD:  Attempted resuming with previous unknown state. Current state is ${this.gameState}`)
        }
        else {
            this.gameState = this._stateBeforePause;
            this.sendToEveryone((p,exited) => new ClusterFunGameResumeMessage({sender: this.session.personalId}))
        }
        this.isPaused = false;
    }

    // -------------------------------------------------------------------
    //  pauseGame
    // -------------------------------------------------------------------
    pauseGame = () => {
        this._stateBeforePause = this.gameState;
        this.gameState = GeneralGameState.Paused;
        this.sendToEveryone((p,exited) => new ClusterFunGamePauseMessage({sender: this.session.personalId}))
        this.isPaused = true;
    }

    // -------------------------------------------------------------------
    //  handleKeepAlive
    // -------------------------------------------------------------------
    handleKeepAlive = (message: ClusterFunKeepAliveMessage) => {
        // FIXME: Maybe do something to be proactive about clients
        // that are no longer keeping alive - like, remove from game ?
    }
   
    // -------------------------------------------------------------------
    //  handleReceipts
    // -------------------------------------------------------------------
    handleReceipts = (message: ClusterFunReceiptAckMessage) => {
        for(const p of this.players)  {
            if(p.pendingMessage 
                && p.playerId === message.sender
                && p.pendingMessage.id === message.ackedMessageId) { 
                p.pendingMessage = undefined;
                return;
            }
        }
        Logger.warn(`Weird: got a message Ack for a message not pending: ` + JSON.stringify(message))
    }
   
    // -------------------------------------------------------------------
    //  sendToPlayer - send a message to a player
    // -------------------------------------------------------------------
    async sendToPlayer(playerId: string, message:ClusterFunMessageBase) {
        const player = this.players.find(p => p.playerId === playerId);
        if(player) {
            player.pendingMessage = await this.session.sendMessage(playerId, message);
        }
    }

    // -------------------------------------------------------------------
    //  sendToEveryone - send a message to all players
    //  generateMessage should return null if a message should not go
    //  to that player
    // -------------------------------------------------------------------
    async sendToEveryone(generateMessage: (player: PlayerType, isExited: boolean) => ClusterFunMessageBase) {
        const sendToPlayer = (isExited: boolean) => async (player:PlayerType) => {
            // Don't send to self
            if(player.playerId !== this.session.personalId) {
                const message = generateMessage(player, isExited);
                if(message) {
                    player.pendingMessage = await this.session.sendMessage(player.playerId, message);
                }
            }
        }
        
        await Promise.all(this.players.map(sendToPlayer(false)));
    }
}
