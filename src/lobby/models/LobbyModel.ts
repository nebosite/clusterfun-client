
import { EventThing, JoinResponse, IMessageThing, IStorage, ITelemetryLogger, ITelemetryLoggerFactory, UIProperties } from "../../libs";
import { action, makeObservable, observable } from "mobx";
import Logger from "js-logger";

export enum LobbyMode 
{
    Unchosen,
    Client,
    Presenter
}

export enum LobbyState {
    Fresh = "Fresh Lobby",
    ReadyToPlay = "Ready to play!", 
}

const LOBBY_STATE_NAME = "lobby_state"

export interface ILobbyDependencies {
    serverCall: <T>(this: unknown, url: string, payload: any) => Promise<T>;
    storage: IStorage;
    telemetryFactory: ITelemetryLoggerFactory;
    messageThingFactory: (this: unknown, joinResponse: JoinResponse) => IMessageThing;
    onGameEnded: () => void
}

export interface HealthColumn {
    label: string,
    data: {count: number, sum: number}
}
export interface HealthData {
    version: string,
    uptime: string,
    rooms: {
        roomCount: number,
        activeRooms: number,
        activeUsers: number,
    }
    summary: HealthColumn[],
    series:  { date: number, columns: HealthColumn[]}[],
}

// -------------------------------------------------------------------
// The LobbyModel
// -------------------------------------------------------------------
export class LobbyModel {
    get id() {return this._rootKey + "_" + this._instanceCount }
    private _rootKey:string;
    private _instanceCount = 0;
    @observable _playerName: string = "";
    get playerName(): string { return this._playerName; }
    set playerName(value: string) {
        if(value.length > 16) value = value.substring(0,16);
        this._playerName = value; 
        this.saveState()}

    playerId: string = "";
    @observable _roomId: string = "";
    get roomId(): string { return this._roomId; }
    set roomId(value: string) {
        value = value.replace(/[^A-Z^0-9]/g, "")
        if(value.length > 4) value = value.substring(0,4);
        action(()=>{
            this._roomId = value
            this.saveState()
        })()
    }

    public showTags = observable<string[]>(["production", "beta", "alpha"])

    @observable private _lobbyState: LobbyState = LobbyState.Fresh;
    get lobbyState(): LobbyState { return this._lobbyState; }
    set lobbyState(value: LobbyState) {action(()=>{this._lobbyState = value})()}
    
    @observable _userChosenMode = LobbyMode.Unchosen;
    get userChosenMode() { return this._userChosenMode}
    set userChosenMode(value: LobbyMode) {
        action(()=>{
            this._userChosenMode = value;
            this.onUserChoseAMode.invoke()
        })()
    }
    onUserChoseAMode = new EventThing("User Mode Selection");

    @observable  private _joinResponse = observable<JoinResponse | null>([null]);
    get joinResponse() {return this._joinResponse[0]}
    set joinResponse(value) {action(()=>{this._joinResponse[0] = value})()}
    

    @observable  private _lobbyErrorMessage: string| undefined = ""
    get lobbyErrorMessage() {return this._lobbyErrorMessage}
    set lobbyErrorMessage(value) {action(()=>{this._lobbyErrorMessage = value})()}
    

    get canJoin() { return this.playerName.trim() !== "" && this.roomId.trim() !== ""; }

    private _telemetry: ITelemetryLoggerFactory;
    private _logger: ITelemetryLogger;
    private _serverCall: <T>(url: string, payload: any) => Promise<T>;
    private _messageThingFactory: (gameProperties: JoinResponse) => IMessageThing;
    private _onGameEnded: () => void
    private _storage: IStorage
    private _dependencies: ILobbyDependencies 

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(dependencies: ILobbyDependencies, rootKey: string)
    {
        makeObservable(this);
        this._dependencies = dependencies;
        this._rootKey = rootKey;

        let tempCount = this._instanceCount + 1;
        this._playerName = sessionStorage.getItem("clusterfun_playername") ?? "";
        this.playerId = "";
        this._roomId = sessionStorage.getItem("clusterfun_roomid") ?? "";
        this.lobbyState = LobbyState.Fresh;
        this.lobbyErrorMessage = "";
        
        this._storage = dependencies.storage;
        this._telemetry = dependencies.telemetryFactory;
        this._serverCall = dependencies.serverCall;
        this._messageThingFactory = dependencies.messageThingFactory;
        this._onGameEnded = dependencies.onGameEnded;

        this._logger = this._telemetry.getLogger("lobby");
        this.loadState();
        this._instanceCount = tempCount;

        this._logger.logPageView("/")
    }

    // -------------------------------------------------------------------
    // getGameConfig 
    // -------------------------------------------------------------------
    public getGameConfig(uiProperties: UIProperties) {
        if(!this.joinResponse) throw Error("getGameConfig called when there were no game properties")
        return {
            uiProperties,
            joinResponse:       this.joinResponse,
            playerName:         this.playerName,
            messageThing:       this._messageThingFactory(this.joinResponse!),  
            logger:             this.getGameLogger(),    
            storage:            this._storage,
            onGameEnded:        this.onGameEnded,
            serverCall:         this._dependencies.serverCall
        }
    }

    // -------------------------------------------------------------------
    // onGameOver 
    // -------------------------------------------------------------------
    private onGameEnded = () => {
        Logger.debug("Gameover signalled")
        this.lobbyState = LobbyState.Fresh;
        if(this._onGameEnded) this._onGameEnded();
        this.joinResponse = null;
        this.saveState();
    }

    // -------------------------------------------------------------------
    // getGameLogger 
    // -------------------------------------------------------------------
    public getGameLogger() {
        return this._telemetry.getLogger(this.joinResponse?.gameName ?? "unknown_game");
    }

    // -------------------------------------------------------------------
    // clearStorage - except the player name
    // -------------------------------------------------------------------
    clearStorage() {
        const temp = this.playerName;
        this._storage.clear();
        this.playerName = temp;
    }


    // -------------------------------------------------------------------
    // clearError - except the player name
    // -------------------------------------------------------------------
    clearError() {
        setTimeout(()=>{
            this._storage.clear();
            this.lobbyState = LobbyState.Fresh;
        },10)
    }

    // -------------------------------------------------------------------
    // startGame 
    // -------------------------------------------------------------------
    public startGame(gameName: string) {
        if(this.lobbyState !== LobbyState.Fresh)
        {
            throw new Error(`Should not be able to start game from state '${this.lobbyState}'`);
        }
        this._logger.logEvent("Start Game", "Started " + gameName)

        const payload: any = { gameName }
        const previousData = sessionStorage.getItem("clusterfun_joinResponse")
        if(previousData) {
            Logger.info(`Found previous data: ${previousData}`)
            const oldProps = JSON.parse(previousData) as JoinResponse
            payload.existingRoom = {
                id: oldProps.roomId,
                presenterId: oldProps.presenterId,
                presenterSecret: oldProps.personalSecret
            }
        }
        
        this._serverCall<JoinResponse>("/api/startgame", payload)
            .then(response =>
                {
                    this.joinResponse = response;
                    const data = JSON.stringify(response)
                    Logger.info(`Storing ${data}`)
                    sessionStorage.setItem("clusterfun_joinResponse", data)
                    this.lobbyState = LobbyState.ReadyToPlay
                    this.lobbyErrorMessage = undefined;
                    this.saveState();
                })
            .catch(e => {
                this.lobbyErrorMessage = "There was an error trying to start the game. Please try again later.";
                Logger.error(e);
                this.lobbyState = LobbyState.Fresh

            })

    }

    // -------------------------------------------------------------------
    // saveState 
    // -------------------------------------------------------------------
    saveState()
    {
        const state = {
            _playerName: this._playerName,
            playerId: this.playerId,
            _roomId: this._roomId,
            gameProperties: this.joinResponse,
            _lobbyState: this._lobbyState,
            _rootKey: this._rootKey,
        }
        const saveMe = JSON.stringify(state);
        this._storage.set(LOBBY_STATE_NAME, saveMe);
    }

    // -------------------------------------------------------------------
    // loadState 
    // -------------------------------------------------------------------
    private loadState()
    {
        try {
            const stateJson = this._storage.get(LOBBY_STATE_NAME);
            if(stateJson) {
                Object.assign(this, JSON.parse(stateJson) )
                if(!this.joinResponse) this.lobbyState = LobbyState.Fresh;
            }
        }
        catch(err)
        {
            this.clearStorage();
            this._logger.logEvent("Lobby", "Reconnect Error", (err as any).message)
        }
    }


    // -------------------------------------------------------------------
    // joinGame 
    // -------------------------------------------------------------------
    public async joinGame() {
        sessionStorage.setItem("clusterfun_playername",this.playerName) 
        sessionStorage.setItem("clusterfun_roomid",this.roomId) 
        // Note: this does not establish a web socket
        this._serverCall<JoinResponse>("/api/joingame", { roomId: this.roomId, playerName: this.playerName })
            .then(properties =>
                {
                    this.joinResponse = properties;
                    this.lobbyState = LobbyState.ReadyToPlay
                    this.lobbyErrorMessage = undefined;
                    this.saveState();
                })
            .catch(e => {
                this.lobbyErrorMessage = "Unable to join that room code";
                Logger.error(e);
                this.lobbyState = LobbyState.Fresh
            })
    }
}
