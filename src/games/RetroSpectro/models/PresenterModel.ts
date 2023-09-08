import { action, makeObservable, observable } from "mobx"
import { ClusterFunGameProps, ClusterFunPlayer, ClusterfunPresenterModel, GeneralGameState, ISessionHelper, ITypeHelper, PresenterGameEvent, PresenterGameState } from "libs";
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { IStorage } from "libs/storage/StorageHelper";
import { ANSWER_STAGE_TIME_MS } from "./GameSettings";
import { AnswerType } from "./ClientModel";
import { RetroSpectroStateUpdateEndPoint, RetroSpectroAnswerEndpoint, RetroSpectroStateUpdateResponse, RetroSpectroEndOfRoundEndpoint, RetroSpectroDiscussionEndpoint, RetroSpectroStatePushEndpoint, RetroSpectroAnswerResponse, RetroSpectroAnswerMessage } from "./EndPoints";

export enum RetroSpectroPlayerStatus {
    Unknown = "Unknown",
    Waiting = "WaitingForStart",
    Answering = "Answering",
    Sorting = "Sorting",
    Discussing = "Discussing",
}
export class RetroSpectroPlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    scoreThisRound: number = 0;
    status: RetroSpectroPlayerStatus = RetroSpectroPlayerStatus.Unknown;
    answer?: string;
    votes: number[] = [];
    winner: boolean = false;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum RetroSpectroGameState {
    Instructions = "Instructions",
    WaitingForAnswers = "Waiting For Answers",
    Sorting = "Sorting",
    Discussing = "Discussing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum RetroSpectroGameEvent {
    ResponseReceived = "ResponseReceived",
}

let answerCount = 0;
// -------------------------------------------------------------------
// RetroSpectroAnswer
// -------------------------------------------------------------------
export class RetroSpectroAnswer {
    id: number = answerCount++;
    player?: RetroSpectroPlayer;
    text: string;
    answerType: string;
    memberOf?: RetroSpectroAnswerCollection;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(player: RetroSpectroPlayer | undefined = undefined, text: string = "***", answerType: string = "***")
    {
        this.player = player;
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
let combinedCollectionCount = 0;
// -------------------------------------------------------------------
// RetroSpectroAnswerCollection
// -------------------------------------------------------------------
export class RetroSpectroAnswerCollection {
    id: number = collectionCount++;
    
    @observable  private _name = ""
    get name() {return this._name}
    set name(value) {action(()=>{this._name = value})()}
    
    @observable answers = observable(new Array<RetroSpectroAnswer>());
    parent?: RetroSpectroPresenterModel;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor() {
        makeObservable(this);
    }

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
            if(!this.name) this.name = droppedItem.name;
            Array.from(droppedItem.answers).forEach(a => this.addAnswer(a));
        }

        if(!this.name) {
            this.name = "Group " + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[combinedCollectionCount % 26]
            combinedCollectionCount++;
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
                case RetroSpectroPlayer: return "RetroSpectroPlayer";
                case RetroSpectroAnswer: return "RetroSpectroAnswer";
                case RetroSpectroAnswerCollection: return "RetroSpectroAnswerCollection";
                case RetroSpectroPresenterModel: return "RetroSpectroPresenterModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "RetroSpectroPlayer": return new RetroSpectroPlayer();
                case "RetroSpectroAnswer": return new RetroSpectroAnswer();
                case "RetroSpectroAnswerCollection": return new RetroSpectroAnswerCollection();            
                case "RetroSpectroPresenterModel": return new RetroSpectroPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof RetroSpectroPresenterModel)
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
            if(typeName === "RetroSpectroPresenterModel")
            {
                switch(propertyName)
                {
                    case "answerCollections": return observable<RetroSpectroAnswerCollection>(rehydratedObject as RetroSpectroAnswerCollection[])
                } 
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
    @observable _currentDiscussionIndex = 0;
    get currentDiscussionIndex() { return this._currentDiscussionIndex; }
    set currentDiscussionIndex(value) { action(()=>this._currentDiscussionIndex = value)()}
    
    get currentDiscussion() { 
        if(!this.answerCollections) return null;
        return this.answerCollections[this.currentDiscussionIndex]
    }

    get hasPrev() {return this.currentDiscussionIndex > 0}
    get hasNext() {return this.currentDiscussionIndex < this.answerCollections.length - 1}
    get prevName() { return this.hasPrev ? (this.answerCollections[this.currentDiscussionIndex -1 ].name ?? "_"): ""}
    get nextName() { return this.hasNext ? (this.answerCollections[this.currentDiscussionIndex + 1 ].name ?? "_"): ""}

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("RetroSpectro", sessionHelper, logger, storage);
        makeObservable(this);


        this.minPlayers = 2;
        this.maxPlayers = 50;
        this.allowedJoinStates.push(...[
            RetroSpectroGameState.Instructions.toString(),
            RetroSpectroGameState.WaitingForAnswers.toString(),
            GeneralGameState.Paused.toString()
        ])

        // this.subscribe(
        //     PresenterGameEvent.PlayerJoined, 
        //     "PlayerJoin", 
        //     (p: RetroSpectroPlayer)=> {
        //         console.log(`Got a join for ${p.name}`)
        //         if(this.gameState === GeneralGameState.Paused
        //             && this.players.length >= this.minPlayers) {
        //                 this.resumeGame();
        //         }
        //         else if(this.gameState !== PresenterGameState.Gathering &&
        //             this.gameState !== RetroSpectroGameState.Instructions) {
        //                 const payload = { sender: this.session.personalId, customText: "Hi THere", roundNumber: this.currentRound}
        //                 this.sendToPlayer(p.playerId, new RetroSpectroPlayRequestMessage(payload))
        //             }
        //     }
        // );

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
    //  prepareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    prepareFreshRound = () => {
    }

    // -------------------------------------------------------------------
    //  nextDiscussion
    // -------------------------------------------------------------------
    nextDiscussion()
    {
        if(this.currentDiscussionIndex < this.answerCollections.length - 1) 
        {
            this.currentDiscussionIndex++;
            this.alertPlayersOnDiscussion();
        }
    }

    // -------------------------------------------------------------------
    //  prevDiscussion
    // -------------------------------------------------------------------
    prevDiscussion()
    {
        if(this.currentDiscussionIndex > 0) 
        {
            this.currentDiscussionIndex--;
            this.alertPlayersOnDiscussion();
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
        if(this.answerCollections.length === 0) {
            this.addTime(15);
        }
        else {
            this.timeOfStageEnd = this.gameTime_ms;
        }
    }

    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): RetroSpectroPlayer
    {
        const newPlayer = new RetroSpectroPlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;
        newPlayer.status = RetroSpectroPlayerStatus.Waiting;

        return newPlayer;
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
    //  handleUpdateRequest
    // -------------------------------------------------------------------
    handleUpdateRequest = (senderId: string) => {
        return {
            currentStage: this.gameState   
        } as RetroSpectroStateUpdateResponse;
    }

    // -------------------------------------------------------------------
    //  addTime
    // -------------------------------------------------------------------
    addTime(seconds: number) {
        this.timeOfStageEnd += seconds * 1000;
    }

    // -------------------------------------------------------------------
    //  pushState
    // -------------------------------------------------------------------
    pushState = () => {
        this.sendToEveryone(RetroSpectroStatePushEndpoint, (player, isExited) => {
            return { currentStage: this.gameState }; 
        });
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.isStageOver) {
            switch(this.gameState) {
                case RetroSpectroGameState.WaitingForAnswers: 
                    this.saveCheckpoint();
                    this.finishAnswers();
                    break;
            }
        }
    }

    // -------------------------------------------------------------------
    //  Return to categorizing from the discussion page
    // -------------------------------------------------------------------
    goBackToCategorizing = () => {
        this.gameState = RetroSpectroGameState.Sorting;
        this.timeOfStageEnd = this.gameTime_ms + ANSWER_STAGE_TIME_MS;
    }
    
    // -------------------------------------------------------------------
    //  finishPlayingRound
    // -------------------------------------------------------------------
    finishPlayingRound() {
        this.gameState = RetroSpectroGameState.EndOfRound;
        this.sendToEveryone(RetroSpectroEndOfRoundEndpoint, (player, isExited) => {
            return { roundNumber: this.currentRound };
        });
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        if(this.gameState === PresenterGameState.Gathering)
        {
            this.gameState = RetroSpectroGameState.Instructions;
            return;
        }
        this.gameState = RetroSpectroGameState.WaitingForAnswers;
        this.timeOfStageEnd = this.gameTime_ms + ANSWER_STAGE_TIME_MS;
        this.currentRound++;

        this.pushState();

        this.players.forEach((p,i) => {
            p.status = RetroSpectroPlayerStatus.Answering;
        })
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
            this.answerCollections.push(newCollection);
        } 
        else if (droppedItem instanceof RetroSpectroAnswerCollection) 
        {
            this.answerCollections.remove(droppedItem);
            this.answerCollections.push(droppedItem);
        }
    }

    // -------------------------------------------------------------`------
    //  addNewAnswer
    // -------------------------------------------------------------------
    addNewAnswer(player: RetroSpectroPlayer, text: string, type: string)
    {
        const newCollection = new RetroSpectroAnswerCollection();
        newCollection.parent = this;
        newCollection.addAnswer(new RetroSpectroAnswer(player, text, type))
        this.answerCollections.push(newCollection);
    }

    // -------------------------------------------------------------------
    //  handleAnswer
    // -------------------------------------------------------------------
    handleAnswer = (senderId: string, message: RetroSpectroAnswerMessage):RetroSpectroAnswerResponse => {
        const player = this.players.find(p => p.playerId === senderId);
        const returnMessage = {
            success: true, 
            answer: message.answer, 
            answerType: message.answerType 
        } as RetroSpectroAnswerResponse;

        if(!player) {
            console.log("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            returnMessage.success = false;
        } else {
            this.addNewAnswer(player, message.answer, message.answerType);
            this.timeOfStageEnd += 1000 + 8000/ this.players.length; // Add some time when an answer is added 
            this.saveCheckpoint();
        }
        return returnMessage;
    }

    // -------------------------------------------------------------------
    //  generateAnswers
    // -------------------------------------------------------------------
    generateAnswers = () => {
        for(let i = 0; i < 5; i++)
        {
            const text = this.randomItem(demoAnswers);
            const type = this.randomDouble(1) > 0.5 ? AnswerType.Positive : AnswerType.Negative;
            this.addNewAnswer(this.randomItem(this.players), text, type);
        }
    }

    // -------------------------------------------------------------------
    //  doneSorting
    // -------------------------------------------------------------------
    doneSorting = () => {
        this.answerCollections.sort((c1, c2) => c2.answers.length - c1.answers.length)
        this.gameState = RetroSpectroGameState.Discussing;
        this.alertPlayersOnDiscussion();
        this.saveCheckpoint();
    }
    
    // -------------------------------------------------------------------
    //  alertPlayersOnDiscussion
    // -------------------------------------------------------------------
    alertPlayersOnDiscussion = () => {
        this.sendToEveryone(RetroSpectroDiscussionEndpoint, (player, isExited) => {
            const youAreInThis = this.currentDiscussion?.answers.find(a => a.player?.playerId === player.playerId) ? true : false;
            return { youAreInThis };
        })
    }

    // -------------------------------------------------------------------
    //  finishAnswers
    // -------------------------------------------------------------------
    private finishAnswers = () => {
        this.players.forEach(player => {
            if (!(player.answer) || player.answer === "") {
                player.answer = "chocolate cake";
            }
        });
        this.gameState = RetroSpectroGameState.Sorting;
        this.pushState();

        // Transition to "Waiting for Votes" and save the checkpoint
        this.timeOfStageEnd = this.gameTime_ms + ANSWER_STAGE_TIME_MS;
        this.saveCheckpoint();
    }
}

const demoAnswers = [
    "Coffee machine",
    "Hot chocolate",
    "Coffee maker",
    "Environment Temperature Controls",
    "Too cold in my office",
    "Window Shades",
    "Server Issues",
    "Can telnet after 10",
    "Service crashes",
    "Hamburgers with tall buns",
    "Chicken sandwich",
    "Hot dogs and condiments",
    "Cafeteria seating and lines",
    "Movie night",
    "Entertainment complexities with movie choices",
    "Why so many comedies?",
    "😂😂🤦‍♀️🤞🤞💖🤦‍♂️🤦‍♀️😎🤳👨‍🦱👱‍♀️👱‍♀️",
    "Mascots",
    "Animal Kindom Representatives",
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
    "Euler's number",
    "facebook birthdays",
    "traditions",
    "zippography",
]
