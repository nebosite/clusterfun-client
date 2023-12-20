import Logger from "js-logger";
import { ISessionHelper, ClusterFunGameProps, ClusterfunClientModel, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper, Vector2 } from "libs";
import { action, observable } from "mobx";
import { WrongAnswersGameState } from "./PresenterModel";
import { WrongAnswersStartRoundMessage, WrongAnswersColorChangeActionEndpoint, WrongAnswersMessageActionEndpoint, WrongAnswersOnboardClientEndpoint, WrongAnswersStartRoundEndpoint, WrongAnswersTapActionEndpoint } from "./Endpoints";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getWrongAnswersClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "WrongAnswersClientModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case WrongAnswersClientModel: return "WrongAnswersClientModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "WrongAnswersClientModel":
                    return new WrongAnswersClientModel(
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
            switch(propertyName)
            {
                case "votedAnswerIndices": 
                case "unvotedAnswerIndices": return observable<number>(rehydratedObject as number[]); 
            } 

            return rehydratedObject;
        }
     }
}

export enum WrongAnswersClientState {
    Answering = "Answering",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class WrongAnswersClientModel extends ClusterfunClientModel  {
    @observable  private _prompt = "No Prompt";
    get prompt() {return this._prompt}
    set prompt(value) {action(()=>{this._prompt = value})()}
    
    @observable  private _currentAnswer = "";
    get currentAnswer() {return this._currentAnswer}
    set currentAnswer(value) {action(()=>{this._currentAnswer = value})()}
    

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("WrongAnswersClient", sessionHelper, playerName, logger, storage);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpointFromPresenter(WrongAnswersStartRoundEndpoint, this.handleStartRoundMessage);
    }

    // -------------------------------------------------------------------
    // handleRecentlyTouchedMessage
    // -------------------------------------------------------------------
    protected handleStartRoundMessage = (message: WrongAnswersStartRoundMessage) => {
        this.prompt = message.prompt;
        this.gameState = WrongAnswersClientState.Answering;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    async requestGameStateFromPresenter(): Promise<void> {
        const response = await this.session.requestPresenter(WrongAnswersOnboardClientEndpoint, {});
        this.roundNumber = response.roundNumber;
        switch(response.state) {
            case WrongAnswersGameState.StartOfRound: this.gameState = WrongAnswersClientState.Answering; break;
            default:
                Logger.debug(`Server Updated State to: ${response.state}`)
                this.gameState = GeneralClientGameState.WaitingToStart;
                break;
        }
    }

    // -------------------------------------------------------------------
    // Tell the presenter to show a message for me
    // -------------------------------------------------------------------
    doMessage(){
        const messages = ["Hi!", "Bye?", "What's up?", "Oh No!", "Hoooooweeee!!", "More gum."]
        this.session.sendMessageToPresenter(WrongAnswersMessageActionEndpoint, { message: this.randomItem(messages)});
    }
}
