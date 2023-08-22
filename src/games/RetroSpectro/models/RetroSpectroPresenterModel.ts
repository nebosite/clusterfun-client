import { observable } from "mobx"
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { RetroSpectroPlayer, RetroSpectroPlayerStatus } from "./RetroSpectroPlayer";
import { SETTING_ANSWERING_TIME_MS, SETTING_VOTING_TIME_MS } from "./RetroSpectroGameSettings";
import { AnswerType } from "./RetroSpectroClientModel";
import {stringify} from "flatted";
import { ClusterFunGameProps, ClusterfunPresenterModel, ISessionHelper, ITypeHelper } from "libs";
import { IStorage } from "libs/storage/StorageHelper";
import { RetroSpectroStateUpdateEndPoint, RetroSpectroAnswerEndpoint, RetroSpectroAnswerMessage, RetroSpectroStateUpdateResponse, RetroSpectroStatePushEndpoint } from "./RetroSpectroEndpoints";

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum RetroSpectroGameState {
    Gathering = "Gathering",
    WaitingForAnswers = "Waiting For Answers",
    Sorting = "Sorting",
    Discussing = "Discussing",
    GameOver = "Game Over",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum RetroSpectroGameEvent {
    PlayerJoined = "PlayerJoined",
    ResponseReceived = "ResponseReceived",
}

let answerCount = 0;
// -------------------------------------------------------------------
// RetroSpectroAnswer
// -------------------------------------------------------------------
export class RetroSpectroAnswer {
    id: number = answerCount++;
    playerId: string;
    text: string;
    answerType: string;
    memberOf?: RetroSpectroAnswerCollection;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(playerId: string = "***", text: string = "***", answerType: string = "***")
    {
        this.playerId = playerId;
        this.text = text;
        this.answerType = answerType;
    }

    // -------------------------------------------------------------------
    // handleDrop
    // -------------------------------------------------------------------
    handleDrop = (droppedAnswer: RetroSpectroAnswer) => {
        console.log(`UNEXPECTED! dropped on an answer: ${droppedAnswer.text}`)   
    }

    // -------------------------------------------------------------------
    // saveState
    // -------------------------------------------------------------------
    saveState = () => {
        this.memberOf?.saveState();
    }
}

let collectionCount = 0;
// -------------------------------------------------------------------
// RetroSpectroAnswerCollection
// -------------------------------------------------------------------
export class RetroSpectroAnswerCollection {
    id: number = collectionCount++;
    @observable name: string = "...";
    @observable answers = observable(new Array<RetroSpectroAnswer>());
    parent?: RetroSpectroPresenterModel;

    // -------------------------------------------------------------------
    // handleDrop
    // -------------------------------------------------------------------
    handleDrop = (droppedItem: RetroSpectroAnswer | RetroSpectroAnswerCollection) => {
        if( droppedItem instanceof RetroSpectroAnswer) {
            if(this.answers.find(a => a.id === droppedItem.id)) 
            {
                // don't drop an answer on itself
                return;
            }
            else this.addAnswer(droppedItem);
        } 
        else if (droppedItem instanceof RetroSpectroAnswerCollection) 
        {
            if(this.id === droppedItem.id) return; // don't drop collection on itself
            Array.from(droppedItem.answers).forEach(a => this.addAnswer(a));
        }

        droppedItem.saveState();
    }

    // -------------------------------------------------------------------
    // insertCollection
    // -------------------------------------------------------------------
    insertCollection(droppedItem: RetroSpectroAnswer | RetroSpectroAnswerCollection)
    {
        if( droppedItem instanceof RetroSpectroAnswer) {
            // Dropping an answer in front of itself should do nothing
            if(this.answers.length === 1 && this.answers[0].id === droppedItem.id) return;
            else droppedItem.memberOf?.removeAnswer(droppedItem);
        } 
        else if(droppedItem instanceof RetroSpectroAnswerCollection) 
        {
            if(droppedItem.id === this.id) return;
            this.parent?.removeAnswerCollection(droppedItem);
        }
        this.parent?.insertCollection(this, droppedItem)
        droppedItem.saveState();
    }

    // -------------------------------------------------------------------
    // saveState
    // -------------------------------------------------------------------
    saveState = () => {
        this.parent?.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // addAnswer
    // -------------------------------------------------------------------
    addAnswer = (newAnswer: RetroSpectroAnswer) => {
        if(newAnswer.memberOf) newAnswer.memberOf.removeAnswer(newAnswer);
        newAnswer.memberOf = this;
        this.answers.push(newAnswer);
    }

    // -------------------------------------------------------------------
    // removeAnswer
    // -------------------------------------------------------------------
    removeAnswer = (answerToRemove: RetroSpectroAnswer) => {
        answerToRemove.memberOf = undefined;
        const answerIndex = this.answers.findIndex(a => a.id === answerToRemove.id);
        console.log(`Removing ${answerToRemove.text} (${answerIndex}) from ${this.name}`)
        if(answerIndex >= 0) this.answers.splice(answerIndex, 1);
        if(this.answers.length === 0) {
            this.parent?.removeAnswerCollection(this);
        }
    }
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getRetroSpectroPresenterTypeHelper = (
    sessionHelper: ISessionHelper,
    gameProps: ClusterFunGameProps 
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "RetroSpectroPresenterModel",
        getTypeName(o) {
            switch (o.constructor) {
                case RetroSpectroAnswer: return "RetroSpectroAnswer";
                case RetroSpectroAnswerCollection: return "RetroSpectroAnswerCollection";
                case RetroSpectroPresenterModel: return "RetroSpectroPresenterModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "RetroSpectroAnswer":
                    return new RetroSpectroAnswer();
                case "RetroSpectroAnswerCollection":
                    return new RetroSpectroAnswerCollection();
                case "RetroSpectroPresenterModel":
                    return new RetroSpectroPresenterModel(
                        sessionHelper,
                        gameProps.logger, 
                        gameProps.storage);
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            switch(propertyName)
            {
                case "players": 
                case "_exitedPlayers": return observable<RetroSpectroPlayer>(rehydratedObject as RetroSpectroPlayer[])
                case "answerCollections": return observable<RetroSpectroAnswerCollection>(rehydratedObject as RetroSpectroAnswerCollection[])
            } 

            return rehydratedObject;
        }
     }
}

// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class RetroSpectroPresenterModel extends ClusterfunPresenterModel<RetroSpectroPlayer> {
    @observable answerCollections = observable(new Array<RetroSpectroAnswerCollection>())


    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage
)
    {
        super("RetroSpectroPresenter", sessionHelper, logger, storage );
        this.minPlayers = 2;
        this.maxPlayers = 50;

        this.gameState = RetroSpectroGameState.Gathering;
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpoint(RetroSpectroStateUpdateEndPoint, this.handleUpdateRequest);
        this.listenToEndpoint(RetroSpectroAnswerEndpoint, this.handleAnswer);
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
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.isStageOver) {
            if (this.gameState === RetroSpectroGameState.WaitingForAnswers) {
                this.finishAnswers();
                this.saveCheckpoint();
            } 
        }
    }

    // -------------------------------------------------------------------
    //  playAgain
    // -------------------------------------------------------------------
    playAgain() {
        const players = this.players.slice(0);
        this.players.clear();

        players.forEach(player => {
            this.players.push(this.createFreshPlayerEntry(player.name, player.playerId))
        });
        this.telemetryLogger.logEvent("Presenter", "PlayAgain");

        this.startGame();
    }

    // -------------------------------------------------------------------
    //  finishRound
    // -------------------------------------------------------------------
    finishRound() {
        this.timeOfStageEnd = this.gameTime_ms;
    }

    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): RetroSpectroPlayer
    {
        return {
            playerId: id,
            name: name,
            totalScore: 0,
            scoreThisRound: 0,
            status: RetroSpectroPlayerStatus.Waiting,
            answer: "",
            votes: [],
            winner: false,
        }
    }

    // -------------------------------------------------------------------
    //  doneSorting
    // -------------------------------------------------------------------
    doneSorting = () => {
        //this.gameState = RetroSpectroGameState.Discussing;
        this.answerCollections = this.answerCollections.sort((c1, c2) => c2.answers.length - c1.answers.length)
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.telemetryLogger.logEvent("Presenter", "Start");

        this.gameState = RetroSpectroGameState.WaitingForAnswers;
        this.timeOfStageEnd = this.gameTime_ms + SETTING_ANSWERING_TIME_MS;

        this.players.forEach(p => {
            p.scoreThisRound = 0;
            p.status = RetroSpectroPlayerStatus.Answering;
            p.answer = "";
            p.votes = [];
        })

        this.startAnswering();
    }

    // -------------------------------------------------------------------
    //  pushState
    // -------------------------------------------------------------------
    pushState = () => {
        this.requestEveryoneAndForget(RetroSpectroStatePushEndpoint, (player, isExited) => {
            return { currentStage: this.gameState };
        });
    }

    // -------------------------------------------------------------------
    //  startAnswering
    // -------------------------------------------------------------------
    startAnswering = () =>
    {
        this.gameState = RetroSpectroGameState.WaitingForAnswers;
        this.pushState();
        this.timeOfStageEnd = this.gameTime_ms + SETTING_ANSWERING_TIME_MS;
        this.saveCheckpoint(); 
    }

    // -------------------------------------------------------------------
    // insertCollection
    // -------------------------------------------------------------------
    insertCollection(insertBefore: RetroSpectroAnswerCollection, droppedItem: RetroSpectroAnswer | RetroSpectroAnswerCollection)
    {
        let newCollection: RetroSpectroAnswerCollection;
        if(droppedItem instanceof RetroSpectroAnswer)
        {
            newCollection = new RetroSpectroAnswerCollection();
            newCollection.parent = this;
            newCollection.addAnswer(droppedItem);
            newCollection.name = droppedItem.text;
        }
        else newCollection = droppedItem;

        const insertAt = this.answerCollections.findIndex(c => c.id === insertBefore.id);
        if(insertAt >= 0)
        {
            this.answerCollections.splice(insertAt, 0, newCollection);
        }
    }


    // -------------------------------------------------------------------
    // removeAnswerCollection
    // -------------------------------------------------------------------
    removeAnswerCollection(collectionToRemove: RetroSpectroAnswerCollection)
    {
        console.log(`removing ${collectionToRemove.name}`)
        this.answerCollections.remove(collectionToRemove);
    }

    // -------------------------------------------------------------------
    // handleDrop
    // -------------------------------------------------------------------
    handleDrop = (droppedItem: RetroSpectroAnswer | RetroSpectroAnswerCollection) => {
        if( droppedItem instanceof RetroSpectroAnswer) {
            droppedItem.memberOf?.removeAnswer(droppedItem);
            const newCollection = new RetroSpectroAnswerCollection();
            newCollection.parent = this;
            newCollection.addAnswer(droppedItem);
            newCollection.name = droppedItem.text;
            this.answerCollections.push(newCollection);
        } 
        else if (droppedItem instanceof RetroSpectroAnswerCollection) 
        {
            this.answerCollections.remove(droppedItem);
            this.answerCollections.push(droppedItem);
        }
    }

    // -------------------------------------------------------------------
    //  addNewAnswer
    // -------------------------------------------------------------------
    addNewAnswer(playerId: string, text: string, type: string)
    {
        const newCollection = new RetroSpectroAnswerCollection();
        newCollection.parent = this;
        newCollection.addAnswer(new RetroSpectroAnswer(playerId, text, type))
        newCollection.name = text;
        this.answerCollections.push(newCollection);
    }

    // -------------------------------------------------------------------
    //  handleUpdateRequest
    // -------------------------------------------------------------------
    handleUpdateRequest = (senderId: string) => {
        return {
            currentStage: this.gameState   
        } as RetroSpectroStateUpdateResponse;
    }

    // -------------------------------------------------------------------
    //  handleAnswer
    // -------------------------------------------------------------------
    handleAnswer = (senderId: string, message: RetroSpectroAnswerMessage) => {
        this.addNewAnswer(senderId, message.answer, message.answerType);
        const player = this.players.find(p => p.playerId === senderId);
        if(!player) {
            console.log("No player found for message: " + stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }
        this.timeOfStageEnd += 5000/ this.players.length; // Add some time when an answer is added 
        this.saveCheckpoint();
    }

    generateAnswers = () => {
        for(let i = 0; i < 5; i++)
        {
            const text = demoAnswers[Math.floor(Math.random() * demoAnswers.length)];
            const type = Math.random() > 0.5 ? AnswerType.Positive : AnswerType.Negative;
            const playerId = `${Math.floor(Math.random() * this.players.length)}`
            this.addNewAnswer(playerId, text, type);
        }
    }

    // -------------------------------------------------------------------
    //  finishAnswers
    // -------------------------------------------------------------------
    private finishAnswers = () => {
        this.gameState = RetroSpectroGameState.Sorting;
        this.pushState();

        // Transition to "Waiting for Votes" and save the checkpoint
        this.timeOfStageEnd = this.gameTime_ms + SETTING_VOTING_TIME_MS;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  resolve the current round
    // -------------------------------------------------------------------
    resolveRound = () => {
        this.players.forEach(p => {
            p.totalScore += p.scoreThisRound;
            p.scoreThisRound = 0;
            p.answer = "";
        })

        this.saveCheckpoint();

        this.gameState = RetroSpectroGameState.GameOver;
        let highestScore = 0;
        this.players.forEach(p => highestScore = Math.max(highestScore, p.totalScore));
        this.players.forEach(p => p.winner = p.totalScore === highestScore);
        this.saveCheckpoint();
        this.pushState();
    }
}

const demoAnswers = [
    "Fish",
    "Bubble Tubers",
    "Mascots",
    "Overly protective second cousins",
    "Trianguler pressure chocolate flux valves",
    "Nits",
    "Wits",
    "Cordialinos",
    "Cheese Pizza",
    "Treble clefs",
    "Radical over easy widgets",
    "Heat death of the univers",
    "TV",
    "A",
    "3.14159265359",
    "facebook birthdays",
    "traditions",
    "zippography",
]
