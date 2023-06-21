import { action, makeObservable, observable } from "mobx"
import { ClusterFunPlayer, ISessionHelper, 
    ClusterFunGameProps, 
    ITelemetryLogger, IStorage, ITypeHelper, HostGameState} from "libs";
import { ServerHealthInfo } from "libs/messaging/serverCall";
import { ClusterfunPresenterModel } from "libs/GameModel/ClusterfunPresenterModel";


export enum StressatoPlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class StressatoPlayer extends ClusterFunPlayer {
    @observable status = StressatoPlayerStatus.Unknown;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum StressatoGameState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum StressatoGameEvent {
    ResponseReceived = "ResponseReceived",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getStressatoPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "StressatoPresenterModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case StressatoPresenterModel: return "StressatoPresenterModel";
                case StressatoPlayer: return "StressatoPlayer";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "StressatoPresenterModel": return new StressatoPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "StressatoPlayer": return new StressatoPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof StressatoPresenterModel)
            {
                const doNotSerializeMe = 
                [
                    "Name_of_Presenter_property_to_not_serialize",
                    // TODO:  put names of properties here that should not be part
                    //        of the saved game state  
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "StressatoPresenterModel")
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
// Presenter data and logic
// -------------------------------------------------------------------
export class StressatoPresenterModel extends ClusterfunPresenterModel<StressatoPlayer> {

    @observable  private _serverHealth = {} as ServerHealthInfo
    get serverHealth() {return this._serverHealth}
    set serverHealth(value) {action(()=>{this._serverHealth = value})()}
    
    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Stressato", sessionHelper, logger, storage);

        setTimeout(this.pingServerHealth,0);
        setInterval(this.pingServerHealth,5000)

        makeObservable(this);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    pingServerHealth = async() => {
        this.serverHealth = await this.session.serverCall.amIHealthy();
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
    }

    requestGameStateFromHost(): Promise<void> {
        return Promise.resolve(); // nothing to request
    }

    // -------------------------------------------------------------------
    //  prepareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.gameState = HostGameState.Gathering;
        this.currentRound = 0;
    }
}
