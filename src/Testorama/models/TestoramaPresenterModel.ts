import { observable } from "mobx"
import { 
    TestoramaPlayRequestMessage,
    TestoramaPlayerActionMessage,
    TestoramaEndOfRoundMessage, } from "./TestoramaMessages";
import { ClusterFunGameProps, ISessionHelper } from "libs";
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { IStorage } from "libs/storage/StorageHelper";
import { PLAYTIME_MS } from "./TestoramaGameSettings";
import { ClusterFunPlayer, ClusterfunPresenterModel, PresenterGameState } from "libs/models/ClusterfunPresenterModel";
import { GeneralGameState } from "libs/models/BaseGameModel";
import { ClusterFunGameOverMessage } from "libs/comms"; 

export enum TestoramaPlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class TestoramaPlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    @observable status = TestoramaPlayerStatus.Unknown;
    @observable message = "";
    @observable colorStyle= "#ffffff";
    @observable x = 0;
    @observable y = 0;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum TestoramaGameState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum TestoramaGameEvent {
    ResponseReceived = "ResponseReceived",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getTestoramaPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ) =>
 {
     return {
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "TestoramaPresenterModel": return new TestoramaPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "TestoramaPlayer": return new TestoramaPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof TestoramaPresenterModel)
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
            if(typeName === "TestoramaPresenterModel")
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
export class TestoramaPresenterModel extends ClusterfunPresenterModel<TestoramaPlayer> {

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Testorama", sessionHelper, logger, storage);
        console.log(`Constructing TestoramaPresenterModel ${this.gameState}`)

        sessionHelper.addListener(TestoramaPlayerActionMessage, "answer", this.handlePlayerAction);

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
    createFreshPlayerEntry(name: string, id: string): TestoramaPlayer
    {
        const newPlayer = new TestoramaPlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;

        return newPlayer;
    }

    // -------------------------------------------------------------------
    //  prePareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  resetGame
    // -------------------------------------------------------------------
    resetGame() {
        this.players.clear();
        this.gameState = PresenterGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleState()
    {
        if (this.isStageOver) {
            switch(this.gameState) {
                case TestoramaGameState.Playing: 
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
        this.gameState = TestoramaGameState.EndOfRound;
        this.sendToEveryone((p,ie) => new TestoramaEndOfRoundMessage({ sender: this.session.personalId, roundNumber: this.currentRound}));
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.gameState = TestoramaGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            p.status = TestoramaPlayerStatus.WaitingForStart;
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
            this.sendToEveryone((p,ie) =>  new TestoramaPlayRequestMessage(payload))
            this.saveCheckpoint();
        }

    }

    // -------------------------------------------------------------------
    //  handlePlayerAction
    // -------------------------------------------------------------------
    handlePlayerAction = (message: TestoramaPlayerActionMessage) => {
        const player = this.players.find(p => p.playerId === message.sender);
        if(!player) {
            console.log("No player found for message: " + JSON.stringify(message));
            this.logger.logEvent("Presenter", "AnswerMessage", "Deny");
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
