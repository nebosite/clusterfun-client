import Logger from "js-logger";
import { ISessionHelper, ClusterFunGameProps, ClusterfunClientModel, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper, Vector2, GeneralGameState } from "libs";
import { action, makeObservable, observable } from "mobx";
import { EgyptianRatScrewGameState } from "./PresenterModel";
import { ERSTimepointUpdateMessage, EgyptianRatScrewOnboardClientEndpoint, EgyptianRatScrewPlayCardActionEndpoint, EgyptianRatScrewPushUpdateEndpoint, EgyptianRatScrewTakePileActionEndpoint } from "./egyptianRatScrewEndpoints";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getEgyptianRatScrewClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "EgyptianRatScrewClientModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case EgyptianRatScrewClientModel: return "EgyptianRatScrewClientModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "EgyptianRatScrewClientModel":
                    return new EgyptianRatScrewClientModel(
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

export enum EgyptianRatScrewClientState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

const colors = ["white", "red", "orange", "yellow", "blue", "cyan", "magenta", "gray"]

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class EgyptianRatScrewClientModel extends ClusterfunClientModel  {

    private _timepointCode: string = "";
    @observable numberOfCards: number = 0;

    get canPlayCards() {
        return this.numberOfCards > 0;
    }

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("EgyptianRatScrewClient", sessionHelper, playerName, logger, storage);
        makeObservable(this);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpointFromPresenter(EgyptianRatScrewPushUpdateEndpoint, this.updateFromTimepoint)
    }

    async requestGameStateFromPresenter(): Promise<void> {
        const response = await this.session.requestPresenter(EgyptianRatScrewOnboardClientEndpoint, {});
        if (response.timepoint) {
            this.updateFromTimepoint(response.timepoint);
        }
        switch(response.state) {
            case EgyptianRatScrewGameState.Playing: this.gameState = EgyptianRatScrewGameState.Playing; break;
            case GeneralGameState.GameOver: this.gameState = GeneralGameState.GameOver; break;
            default:
                Logger.debug(`Server Updated State to: ${response.state}`)
                this.gameState = GeneralClientGameState.WaitingToStart;
                break;
        }
    }

    private updateFromTimepoint = (timepoint: ERSTimepointUpdateMessage) => {
        action(() => {
            this._timepointCode = timepoint.timepointCode;
            this.numberOfCards = timepoint.numberOfCards;
        })();
    }

    async doPlayCard() {
        if (!this.canPlayCards) {
            return; // don't play cards if we're out - note that the button should be disabled anyway
        }
        const response = await this.session.requestPresenter(EgyptianRatScrewPlayCardActionEndpoint, { timepointCode: this._timepointCode });
        if (response.timepoint) {
            this.updateFromTimepoint(response.timepoint);
        }
    }

    async doTakePile() {
        const response = await this.session.requestPresenter(EgyptianRatScrewTakePileActionEndpoint, { timepointCode: this._timepointCode });
        if (response.timepoint) {
            this.updateFromTimepoint(response.timepoint);
        }
    }

    // TODO: Consider a set of actions/buttons that allow you to change your position
    // in the turn order if you are out of cards. This would let you establish your seat
    // in the game to match your seating arrangements IRL. You should also be able to
    // do this before the game starts.
}
