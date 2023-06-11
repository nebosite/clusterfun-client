import { action, makeObservable, observable } from "mobx"
import { ClusterFunPlayer, ISessionHelper, 
    ClusterFunGameProps, ClusterfunHostModel, 
    ITelemetryLogger, IStorage, ITypeHelper, 
    HostGameState} from "libs";
import { StressatoHostRelayEndpoint } from "./stressatoEndpoints";


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

// TODO: This should be a continuously generated random string -
// this specific string might have a particular compression pattern
const seedString = "_abcdefjhijklmnopqrstuvwxyzABCDEFJHIKJLMNOPQRSTUVWXYZ012345678909876543210abcdefjhijklmnopqrstuvwxyz.".repeat(100)

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getStressatoHostTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "StressatoHostModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case StressatoHostModel: return "StressatoHostModel";
                case StressatoPlayer: return "StressatoPlayer";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "StressatoHostModel": return new StressatoHostModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "StressatoPlayer": return new StressatoPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof StressatoHostModel)
            {
                const doNotSerializeMe = 
                [
                    "Name_of_host_property_to_not_serialize",
                    // TODO:  put names of properties here that should not be part
                    //        of the saved game state  
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "StressatoHostModel")
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

interface ServerDatum {
    count: number
    sum: number
}

interface LabeledData {
    label: string
    data: ServerDatum
}
export interface ServerHealthInfo {
    version: string
    uptime: string
    rooms: {
        roomCount: number
        activeRooms: number
        activeUsers: number
    },
    summary: LabeledData[],
    series: {
        date: number
        columns: LabeledData[]
    }[]
    cpuUsage: {
        user: number
        system: number
    },
    memoryUsage: {
        rss: number
        heapTotal: number
        heapUsed: number
        external: number
        arrayBuffers: number
    }
}

// -------------------------------------------------------------------
// host data and logic
// -------------------------------------------------------------------
export class StressatoHostModel extends ClusterfunHostModel<StressatoPlayer> {

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
        
        this.allowedJoinStates = [HostGameState.Gathering, StressatoGameState.Playing]
        this.minPlayers = 1;

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
        this.listenToEndpoint(StressatoHostRelayEndpoint, this.handlePlayerAction);
    }


    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): StressatoPlayer
    {
        const newPlayer = new StressatoPlayer();
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
        this.gameState = HostGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {

    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    startNextRound(): void {
        
    }

    // -------------------------------------------------------------------
    //  handlePlayerAction
    // -------------------------------------------------------------------
    handlePlayerAction = (sender: string, message: { returnSize: number, actionData: string }) => {
        if(message.returnSize) {
            return { actionData: seedString.substring(0, message.returnSize)};
        } else {
            return undefined;
        }

    }

}
