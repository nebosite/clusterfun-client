import { ISessionHelper, ClusterFunGameProps, 
    ClusterfunClientModel, ITelemetryLogger, 
    IStorage, ITypeHelper } from "libs";
import { action, makeObservable, observable } from "mobx";
import { StressatoPresenterRelayWithReturnEndpoint, StressatoPresenterRelayWithoutReturnEndpoint } from "./stressatoEndpoints";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getStressatoClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "StressatoClientModel",
        getTypeName(o) {
            switch (o.constructor) {
                case StressatoClientModel: return "StressatoClientModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "StressatoClientModel":
                    return new StressatoClientModel(
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

export enum StressatoClientState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

const RATE_UNIT = 1000 * 60
const SEED_STRING = "_abcdefjhijklmnopqrstuvwxyzABCDEFJHIKJLMNOPQRSTUVWXYZ012345678909876543210abcdefjhijklmnopqrstuvwxyz.".repeat(100)

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class StressatoClientModel extends ClusterfunClientModel  {

    @observable  private _sendRate = 0
    get sendRate() {return this._sendRate}
    set sendRate(value) {action(()=>{
        this._sendRate = value
        this.nextSend = this.sendRate 
        ? this.gameTime_ms + (RATE_UNIT/this.sendRate)
        : this.gameTime_ms + 10000000000
    })() }

    @observable  private _messageSize = 0
    get messageSize() {return this._messageSize}
    set messageSize(value) {action(()=>{this._messageSize = value})()}

    @observable  private _returnMessageSize = 0
    get returnMessageSize() {return this._returnMessageSize}
    set returnMessageSize(value) {action(()=>{this._returnMessageSize = value})()}
    
    
    nextSend = 10000000000
    
    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("StressatoClient", sessionHelper, playerName, logger, storage);

        makeObservable(this);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.onTick.subscribe("TestClientTick", async (t) => {
            if(t > this.nextSend) {
                try {
                    await this.sendAction(SEED_STRING.substring(0,this.messageSize))
                } catch (err) {
                    console.error("Could not send to presenter", err);
                }

                this.nextSend = this.sendRate 
                    ? t + (RATE_UNIT/this.sendRate)
                    : t + 10000000000
            }
        })
    }

    requestGameStateFromPresenter = (): Promise<void> => {
        return Promise.resolve(undefined);
    }

    // -------------------------------------------------------------------
    // sendAction 
    // -------------------------------------------------------------------
    protected async sendAction(actionData: any = null) {
        if (this.returnMessageSize) {
            await this.session.requestPresenter(
                StressatoPresenterRelayWithReturnEndpoint, 
                { returnSize: this.returnMessageSize, actionData });
        } else {
            this.session.sendMessageToPresenter(
                StressatoPresenterRelayWithoutReturnEndpoint, 
                { actionData });
        }
    }
}
