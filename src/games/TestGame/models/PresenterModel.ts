import { observable } from "mobx"
import { 
    TestatoPlayRequestMessage,
    TestatoPlayerActionMessage,
    TestatoEndOfRoundMessage, } from "./Messages";
import { PLAYTIME_MS } from "./GameSettings";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, ClusterfunPresenterModel, ITelemetryLogger, IStorage, ITypeHelper, PresenterGameState, GeneralGameState, ClusterFunGameOverMessage } from "libs";
import Logger from "js-logger";


export enum TestatoPlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class TestatoPlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    @observable status = TestatoPlayerStatus.Unknown;
    @observable message = "";
    @observable colorStyle= "#ffffff";
    @observable x = 0;
    @observable y = 0;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum TestatoGameState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum TestatoGameEvent {
    ResponseReceived = "ResponseReceived",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getTestatoPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "TestatoPresenterModel",
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "TestatoPresenterModel": return new TestatoPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "TestatoPlayer": return new TestatoPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof TestatoPresenterModel)
            {
                const doNotSerializeMe = 
                [
                    "Name_of_presenter_property_to_not_serialize",
                    // TODO:  put names of properties here that should not be part
                    //        of the saved game state  
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "TestatoPresenterModel")
            {
                // TODO: if there are any properties that need special treatment on 
                // deserialization, you can override it here.  e.g.:
                // switch(propertyName) {
                //     case "myOservableCollection": 
                //         return observable<ItemType>(rehydratedObject as ItemType[]); 
                // }
            }
            return rehydratedObject;
        }
     }
}


// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class TestatoPresenterModel extends ClusterfunPresenterModel<TestatoPlayer> {

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Testato", sessionHelper, logger, storage);
        Logger.info(`Constructing TestatoPresenterModel ${this.gameState}`)

        sessionHelper.addListener(TestatoPlayerActionMessage, this, this.handlePlayerAction);

        this.allowedJoinStates = [PresenterGameState.Gathering, TestatoGameState.Playing]

        this.minPlayers = 2;
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {}


    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): TestatoPlayer
    {
        const newPlayer = new TestatoPlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;

        return newPlayer;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    prepareFreshRound = () => {
    }

    // -------------------------------------------------------------------
    //  prepareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.gameState = PresenterGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.isStageOver) {
            switch(this.gameState) {
                case TestatoGameState.Playing: 
                    this.finishPlayingRound(); 
                    this.saveCheckpoint();
                    break;
            }
        }
    }
    
    // -------------------------------------------------------------------
    //  finishPlayingRound
    // -------------------------------------------------------------------
    finishPlayingRound() {
        this.gameState = TestatoGameState.EndOfRound;
        this.sendToEveryone((p,ie) => new TestatoEndOfRoundMessage({ sender: this.session.personalId, roundNumber: this.currentRound}));
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.gameState = TestatoGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            p.status = TestatoPlayerStatus.WaitingForStart;
            p.pendingMessage = undefined;
            p.message = "";
            p.colorStyle = "white";
            p.x = .1;
            p.y = i * .1 + .1;
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.sendToEveryone((p,ie) => new ClusterFunGameOverMessage({ sender: this.session.personalId }))
            this.saveCheckpoint();
        }    
        else {
            const payload = { sender: this.session.personalId, customText: "Hi THere", roundNumber: this.currentRound}
            this.sendToEveryone((p,ie) =>  new TestatoPlayRequestMessage(payload))
            this.saveCheckpoint();
        }

    }

    // -------------------------------------------------------------------
    //  handlePlayerAction
    // -------------------------------------------------------------------
    handlePlayerAction = (message: TestatoPlayerActionMessage) => {
        const player = this.players.find(p => p.playerId === message.sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }

        switch(message.action)
        {
            case "ColorChange": 
                this.invokeEvent("ColorChange"); 
                player.colorStyle = message.actionData.colorStyle;
                break;
            case "Message": 
                player.message = message.actionData.text; 
                break;
            case "Tap": 
                player.x = message.actionData.x;
                player.y = message.actionData.y;
                break;
        }

        player.pendingMessage = undefined;

        this.saveCheckpoint();
    }

}
