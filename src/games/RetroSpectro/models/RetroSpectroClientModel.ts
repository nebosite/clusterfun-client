import { action, makeObservable, observable } from "mobx";
import { ClusterFunGameProps, ClusterfunClientModel, GeneralClientGameState, GeneralGameState, ISessionHelper, ITypeHelper } from "libs";
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { IStorage } from "libs/storage/StorageHelper";
import { SETTING_ANSWER_CHARACTER_LIMIT } from "./RetroSpectroGameSettings";
import { RetroSpectroAnswerEndpoint, RetroSpectroAnswerMessage, RetroSpectroStatePushEndpoint, RetroSpectroStateUpdateEndPoint, RetroSpectroStateUpdateResponse } from "./RetroSpectroEndpoints";
import { RetroSpectroGameState } from "./RetroSpectroPresenterModel";
import logger from "js-logger";

export enum AnswerType{
    Positive = "Positive",
    Negative = "Negative"
}

export enum RetroSpectroClientState {
    AnsweringQuestion = "Answering Question",
    WaitingForQuestionFinish = "WaitingForRoundFinish",
    Sorting = "Sorting",
    JoinError = "Join Error",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getRetroSpectroClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
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
export class RetroSpectroClientModel extends ClusterfunClientModel {

    @observable _currentAnswer: string = "";
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
    
    @observable _activeQuestion: string | undefined;
    get activeQuestion() { return this._activeQuestion }
    set activeQuestion(value) {
        action(()=> this._activeQuestion = value)();
    }

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("RetroSpectroClient", sessionHelper, playerName, logger, storage);
        makeObservable(this);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    async requestGameStateFromPresenter(): Promise<void> {
        const gameState = await this.session.requestPresenter(RetroSpectroStateUpdateEndPoint, {})
        this.handleStatePush(gameState)
    }

    // -------------------------------------------------------------------
    // reconstitute 
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpointFromPresenter(RetroSpectroStatePushEndpoint, this.handleStatePush);
    }

    // -------------------------------------------------------------------
    // handleStatePush
    // -------------------------------------------------------------------
    protected handleStatePush = (message: RetroSpectroStateUpdateResponse) => {
        switch(message.currentStage) {
            case RetroSpectroGameState.WaitingForAnswers: this.switchToAnswering(); break;
            case RetroSpectroGameState.Sorting: this.switchToSorting(); break;;
            //message.currentStage satisfies never;
        }
    }

    // -------------------------------------------------------------------
    // switchToAnswering 
    // -------------------------------------------------------------------
    switchToAnswering = () => {
        if(this.gameState === GeneralClientGameState.WaitingToStart) {
            this.telemetryLogger.logEvent("Client", "Start");
        }
        this.currentAnswer = "";
        this.gameState = RetroSpectroClientState.AnsweringQuestion;

        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // switchToSorting 
    // -------------------------------------------------------------------
    switchToSorting = () => {
        this.gameState = RetroSpectroClientState.Sorting;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // submitAnswer 
    // -------------------------------------------------------------------
    submitAnswer(answerType: AnswerType) {
        const message: RetroSpectroAnswerMessage = {
                answer: this.currentAnswer,
                answerType: answerType,
        }
        this.session.requestPresenter(RetroSpectroAnswerEndpoint, message).forget();

        this.currentAnswer = "";
        this.saveCheckpoint(); 
    }
}
