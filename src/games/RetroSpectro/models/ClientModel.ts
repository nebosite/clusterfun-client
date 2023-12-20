import { makeObservable, observable } from "mobx";
import { ClusterFunGameProps, ClusterfunClientModel, GeneralClientGameState, ISessionHelper } from "libs";
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { IStorage } from "libs/storage/StorageHelper";
import { SETTING_ANSWER_CHARACTER_LIMIT } from "./GameSettings";
import { RetroSpectroGameState } from "./PresenterModel";
import { RetroSpectroAnswerEndpoint, 
    RetroSpectroAnswerMessage, 
    RetroSpectroDiscussionEndpoint, 
    RetroSpectroDiscussionMessage, 
    RetroSpectroEndOfRoundEndpoint, 
    RetroSpectroEndOfRoundMessage, 
    RetroSpectroStatePushEndpoint, 
    RetroSpectroStateUpdateEndPoint, 
    RetroSpectroStateUpdateResponse } from "./EndPoints";

export enum AnswerType{
    Positive = "Positive",
    Negative = "Negative"
}

export enum RetroSpectroClientState {
    SubmittingAnswers = "SubmittingAnswers",
    Sorting = "Sorting",
    Discussing = "Discussing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getRetroSpectroClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ) =>
 {
     return {
        rootTypeName: "RetroSpectroClientModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case RetroSpectroClientModel: return "RetroSpectroClientModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "RetroSpectroClientModel":
                    return new RetroSpectroClientModel(
                        sessionHelper,
                        gameProps.playerName || "Player",
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
            return rehydratedObject;
        }
     }
}


// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class RetroSpectroClientModel extends ClusterfunClientModel  {

    @observable private _currentAnswer: string = "";
    get currentAnswer() { return this._currentAnswer;}
    get currentAnswerOK() {
        const trimmedAnswer = this.currentAnswer.trim();
        if(trimmedAnswer.length > 100) return false;
        if(trimmedAnswer.split(" ").length > 5) return false;
        return trimmedAnswer.length > 2;
    }
    set currentAnswer(value: string) { 
        if(value.length > SETTING_ANSWER_CHARACTER_LIMIT) value = value.substr(0,SETTING_ANSWER_CHARACTER_LIMIT);
        this._currentAnswer = value;  this.saveCheckpoint()}
    
    @observable hasOnscreenAnswer = false;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("RetroSpectroClient", sessionHelper, playerName, logger, storage);
        makeObservable(this);
    }
    
    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpointFromPresenter(RetroSpectroStatePushEndpoint, this.handleStatePush);
        this.listenToEndpointFromPresenter(RetroSpectroEndOfRoundEndpoint, this.handleEndOfRoundMessage);
        this.listenToEndpointFromPresenter(RetroSpectroDiscussionEndpoint, this.handleDiscussionMessage);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    async requestGameStateFromPresenter(): Promise<void> {
        const onboardState = await this.session.requestPresenter(RetroSpectroStateUpdateEndPoint, {})
        this.assignClientStateFromServerState(onboardState.currentStage);
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // handleStatePush
    // -------------------------------------------------------------------
    protected handleStatePush = (message: RetroSpectroStateUpdateResponse) => {
        this.assignClientStateFromServerState(message.currentStage);
    }

    // -------------------------------------------------------------------
    // switchToAnswering 
    // -------------------------------------------------------------------
    switchToAnswering = () => {
        if(this.gameState === GeneralClientGameState.WaitingToStart) {
            this.telemetryLogger.logEvent("Client", "Start");
        }
        this.currentAnswer = "";
        this.gameState = RetroSpectroClientState.SubmittingAnswers;

        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // switchToSorting 
    // -------------------------------------------------------------------
    switchToSorting = () => {
        this.gameState = RetroSpectroClientState.Sorting;
        this.saveCheckpoint();
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    assignClientStateFromServerState(serverState: string) {    
        switch(serverState) {
            case RetroSpectroGameState.Discussing: 
                this.gameState = RetroSpectroClientState.Discussing; 
                break;
            case RetroSpectroGameState.Sorting: 
                this.gameState = RetroSpectroClientState.Sorting; 
                break;
            case RetroSpectroGameState.WaitingForAnswers: 
                this.gameState = RetroSpectroClientState.SubmittingAnswers; 
                break;
            default: 
                this.gameState = GeneralClientGameState.WaitingToStart; 
                break;
            //message.currentStage satisfies never;
        }
    
    }

    // -------------------------------------------------------------------
    // handleEndOfRoundMessage
    // -------------------------------------------------------------------
    protected handleEndOfRoundMessage = (message: RetroSpectroEndOfRoundMessage) => {
        this.gameState = RetroSpectroClientState.EndOfRound;

        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // handleDiscussionMessage 
    // -------------------------------------------------------------------
    handleDiscussionMessage = (message: RetroSpectroDiscussionMessage) => {
        this.gameState = RetroSpectroClientState.Discussing;
        this.hasOnscreenAnswer = message.youAreInThis;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // submitAnswer 
    // -------------------------------------------------------------------
    submitAnswer(answerType: AnswerType) {
        const message : RetroSpectroAnswerMessage = 
            {
                answer: this.currentAnswer,
                answerType: answerType,
            }
        this.session.requestPresenter(RetroSpectroAnswerEndpoint, message)
        this.currentAnswer = "";
        this.saveCheckpoint(); 
    }
}
