import { observable } from "mobx"
import { PLAYTIME_MS } from "./GameSettings";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, ClusterfunPresenterModel, ITelemetryLogger, IStorage, ITypeHelper, PresenterGameState, GeneralGameState, Vector2 } from "libs";
import Logger from "js-logger";
import { TestatoColorChangeActionEndpoint, TestatoMessageActionEndpoint, TestatoOnboardClientEndpoint, TestatoTapActionEndpoint } from "./Endpoints";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";


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
        getTypeName(o) {
            switch (o.constructor) {
                case TestatoPresenterModel: return "TestatoPresenterModel";
                case TestatoPlayer: return "TestatoPlayer";
            }
            return undefined;
        },
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
        this.allowedJoinStates = [PresenterGameState.Gathering, TestatoGameState.Playing]
        this.minPlayers = 2;
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpoint(TestatoOnboardClientEndpoint, this.handleOnboardClient);
        this.listenToEndpoint(TestatoColorChangeActionEndpoint, this.handleColorChangeAction);
        this.listenToEndpoint(TestatoMessageActionEndpoint, this.handleMessageAction);
        this.listenToEndpoint(TestatoTapActionEndpoint, this.handleTapAction);
    }


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
        this.sendToEveryone(InvalidateStateEndpoint, (p,ie) => ({}))
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
            p.message = "";
            p.colorStyle = "white";
            p.x = .1;
            p.y = i * .1 + .1;
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.requestEveryone(GameOverEndpoint, (p,ie) => ({}))
                .then(_result => {})
                .catch(err => {
                    console.warn("Not able to send Game Over to everyone:", err)
                })
            this.saveCheckpoint();
        }    
        else {
            this.gameState = TestatoGameState.Playing;
            this.sendToEveryone(InvalidateStateEndpoint, (p,ie) => ({}))
            this.saveCheckpoint();
        }

    }

    handleOnboardClient = (sender: string, message: unknown): { roundNumber: number, customText: string, state: string } => {
        this.telemetryLogger.logEvent("Presenter", "Onboard Client")
        return {
            roundNumber: this.currentRound,
            customText: "Hi There",
            state: this.gameState
        }
    }


    handleColorChangeAction = (sender: string, message: { colorStyle: string }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }
        player.colorStyle = message.colorStyle;
        this.saveCheckpoint();
    }

    handleMessageAction = (sender: string, message: { message: string }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }
        player.message = message.message;
        this.saveCheckpoint();
    }

    handleTapAction = (sender: string, message: { point: Vector2 }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }
        player.x = message.point.x;
        player.y = message.point.y;
        this.saveCheckpoint();
    }

}
