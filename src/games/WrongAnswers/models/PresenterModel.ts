import { action, computed, makeObservable, observable } from "mobx"
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, ClusterfunPresenterModel, ITelemetryLogger, 
    IStorage, ITypeHelper, PresenterGameState } from "libs";
import Logger from "js-logger";
import { WrongAnswersAnswerUpdate, WrongAnswersAnswerUpdateMessage, WrongAnswersOnboardClientEndpoint, WrongAnswersStartRoundEndpoint } from "./Endpoints";
import { GameOverEndpoint } from "libs/messaging/basicEndpoints";
import { RandomHelper } from "libs/Algorithms/RandomHelper";
import MessageEndpoint from "libs/messaging/MessageEndpoint";


export enum WrongAnswersPlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

interface RoundScore {
    score:number
}
export class WrongAnswersPlayer extends ClusterFunPlayer {
    scores = observable<RoundScore>([])
    currentAnswers = observable<PlayerAnswer>([])

    constructor() {
        super();
        makeObservable(this);
    }
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum WrongAnswersGameState {
    StartOfRound = "StartOfRound",
    StartOfTourney = "StartOfTourney",
    Battle = "Battle",
    BattleResults = "BattleResults",
    EndOfTourney = "EndOfTourney",
    EndOfGame = "EndOfGame",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum WrongAnswersGameEvent {
    ResponseReceived = "ResponseReceived",
}

export interface PlayerAnswer {
    playerId: string;
    answer: string;
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getWrongAnswersPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "WrongAnswersPresenterModel",
        getTypeName(o) {
            switch (o.constructor) {
                case WrongAnswersPresenterModel: return "WrongAnswersPresenterModel";
                case WrongAnswersPlayer: return "WrongAnswersPlayer";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "WrongAnswersPresenterModel": return new WrongAnswersPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "WrongAnswersPlayer": return new WrongAnswersPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof WrongAnswersPresenterModel)
            {
                const doNotSerializeMe = 
                [
                    "_rand",
                    // TODO:  put names of properties here that should not be part
                    //        of the saved game state  
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "WrongAnswersPresenterModel")
            {
                // TODO: if there are any properties that need special treatment on 
                // deserialization, you can override it here.  e.g.:
                switch(propertyName) {
                    case "foundAnswers": 
                        return observable<PlayerAnswer>(rehydratedObject as PlayerAnswer[]); 
                }
            }
            return rehydratedObject;
        }
     }
}

// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class WrongAnswersPresenterModel extends ClusterfunPresenterModel<WrongAnswersPlayer> {

    get currentPrompt() { return this._prompts[this.currentRound - 1]}
    
    @observable  private _answerSetSize = 8
    get answerSetSize() {return this._answerSetSize}
    set answerSetSize(value) {action(()=>{this._answerSetSize = value})()}

    @observable  private _playerSetSize = 1;
    get playerSetSize() {return this._playerSetSize}
    set playerSetSize(value) {action(()=>{this._playerSetSize = value})()}

    @observable  private _foundAnswers:PlayerAnswer[] = [];
    get foundAnswers() {return this._foundAnswers}
    set foundAnswers(value) {action(()=>{this._foundAnswers = value})()}
    
    

    private _prompts: WrongAnswersPrompt[] = []
    private _rand = new RandomHelper();


    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("WrongAnswers", sessionHelper, logger, storage);
        this._prompts = this._rand.pickN(AllPrompts, this.totalRounds);

        this.allowedJoinStates = [PresenterGameState.Gathering, PresenterGameState.Instructions]

        this.minPlayers = 2;
        makeObservable(this);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpoint(WrongAnswersOnboardClientEndpoint, this.handleOnboardClient);
        this.listenToEndpoint(WrongAnswersAnswerUpdate, this.handleAnswerUpdate);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    handleAnswerUpdate = (sender:string, message: WrongAnswersAnswerUpdateMessage) => {
        if(!this.players) {
            console.log("WEIRD: undefined players!");
            return;
        }

        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            console.log(`Could not find player with id: ${sender}`)
            return;
        }

        player.currentAnswers.clear();
        player.currentAnswers.push(...message.answers.map(answer => ({playerId: sender, answer})))

        const answerSet:PlayerAnswer[] = [];

        this.players.forEach(p => {
            for(let i = 0; i < this.playerSetSize && i <p.currentAnswers.length; i++) {
                answerSet.push(p.currentAnswers[i]);
            }
        })
        this.foundAnswers = answerSet;
    }

    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): WrongAnswersPlayer
    {
        const newPlayer = new WrongAnswersPlayer();
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
        // if (this.isStageOver) {
        //     switch(this.gameState) {
        //         case WrongAnswersGameState.Playing: 
        //             this.finishPlayingRound(); 
        //             this.saveCheckpoint();
        //             break;
        //     }
        // }
    }
    
    // // -------------------------------------------------------------------
    // //  finishPlayingRound
    // // -------------------------------------------------------------------
    // finishPlayingRound() {
    //     this.gameState = WrongAnswersGameState.EndOfRound;
    //     this.sendToEveryone(InvalidateStateEndpoint, (p,ie) => ({}))
    // }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.gameState = WrongAnswersGameState.StartOfRound;
        //this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            // Reset player objects here
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = WrongAnswersGameState.EndOfGame;
            this.requestEveryone(GameOverEndpoint, (p,ie) => ({}))
                .then(_result => {})
                .catch(err => {
                    console.warn("Not able to send Game Over to everyone:", err)
                })
            this.saveCheckpoint();
        }    
        else {
            this.gameState = WrongAnswersGameState.StartOfRound;
            const prompt = this._prompts[this.currentRound - 1];
            this.playerSetSize =  Math.ceil(this.answerSetSize / this.players.length);
            this.sendToEveryone(WrongAnswersStartRoundEndpoint, 
                (p,ie) => ({
                    prompt: prompt.text, 
                    minAnswers: this.playerSetSize 
                }))
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


    // handleColorChangeAction = (sender: string, message: { colorStyle: string }) => {
    //     const player = this.players.find(p => p.playerId === sender);
    //     if(!player) {
    //         Logger.warn("No player found for message: " + JSON.stringify(message));
    //         this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
    //         return;
    //     }
    //     player.colorStyle = message.colorStyle;
    //     this.saveCheckpoint();
    // }

    // handleMessageAction = (sender: string, message: { message: string }) => {
    //     const player = this.players.find(p => p.playerId === sender);
    //     if(!player) {
    //         Logger.warn("No player found for message: " + JSON.stringify(message));
    //         this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
    //         return;
    //     }
    //     player.message = message.message;
    //     this.saveCheckpoint();
    // }

    // handleTapAction = (sender: string, message: { point: Vector2 }) => {
    //     const player = this.players.find(p => p.playerId === sender);
    //     if(!player) {
    //         Logger.warn("No player found for message: " + JSON.stringify(message));
    //         this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
    //         return;
    //     }
    //     player.x = message.point.x;
    //     player.y = message.point.y;
    //     this.saveCheckpoint();
    // }

}

interface WrongAnswersPrompt {
    text: string;
}
const AllPrompts = [
    { text: "Roses are red, violets are _____" },
    { text: "Why did the chicken cross the road?" },
    { text: "What does NASA stand for?" },
    { text: "What happened in Jurassic Park?" },
    { text: "Why is the sky blue" },
    { text: "Where do babies come from?" },
    { text: "Why should [player] get a haircut?" },
    { text: "What makes the sun rise?" },
    { text: "How do birds fly?" },
    { text: "Why do we have seasons?" },
    { text: "Where does rain come from?" },
    { text: "Why do stars twinkle?" },
    { text: "How do plants grow?" },
    { text: "Why do we need to sleep?" },
    { text: "What are clouds made of?" },
    { text: "How does the moon change shape?" },
    { text: "Why do we have different time zones?" },
    { text: "How do fish breathe underwater?" },
    { text: "Why do leaves change color in autumn?" },
    { text: "What causes thunder and lightning?" },
    { text: "How do airplanes stay in the sky?" },
    { text: "Why are there so many languages?" },
    { text: "Where does wind come from?" },
    { text: "Why do we have dreams?" },
    { text: "How does the internet work?" },
    { text: "Why do animals hibernate?" },
    { text: "What is Money?" },
    { text: "How should I treat a paper cut?" },
    { text: "How does voting work?" },
    { text: "How do I pay taxes?" },
    { text: "What is a square meal?" },
    { text: "What is under the hood of a car?" },
    { text: "How can I manage my time?" },
    { text: "How do I get on my boss' good side?" },
    { text: "How do I choose a good career?" },
    { text: "How should I choose a home?" },
    { text: "What is work-life balance?" },
    { text: "How do I protect my name online?" },
    { text: "What is a good citizen?" },
    { text: "What's the best way to end an argument?" },
    { text: "How do I know a person is 'The One'?" },
    { text: "How do I fix a faucet?" },
    { text: "An easy thing is a Piece of ____." },
    { text: "Costs an arm and a ____." },
    { text: "To get to know someoneone, you need to Break the ____." },
    { text: "Hit the nail on the ____." },
    { text: "Sure, that will happen When pigs ____." },
    { text: "Shhh!  Don't Spill the ____." },
    { text: "[player] is missing school today because they are Under the ____." },
    { text: "The ball is in your ____." },
    { text: "I know you [player] doesn't want to, but they just need to Bite the ____." },
    { text: "[player] likes to Burn the midnight ____." },
    { text: "[player] gets ahead by Cutting ____." },
    { text: "I'm so sleepy! I need to Hit the ____." },
    { text: "Let the cat out of the ____." },
    { text: "Better hurry, you don't want to Miss the ____." },
    { text: "Make a decision! No need to be On the ____." },
    { text: "Once in a blue ____." },
    { text: "Are you telling the truth, or are you Pulling my ____." },
    { text: "[player] likes to See ____ to ____." },
    { text: "The best of both ____." },
    { text: "You can do it!  No need to Throw in the ____." },
]



