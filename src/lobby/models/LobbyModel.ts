
import { ClusterFunGameAndUIProps, EventThing, GameInstanceProperties, GameRole, IMessageThing, IStorage, ITelemetryLogger, ITelemetryLoggerFactory, MessagePortMessageThing, UIProperties, getStorage } from "../../libs";
import { action, makeObservable, observable } from "mobx";
import Logger from "js-logger";
import { getGameHostInitializer } from "GameChooser";
import * as Comlink from "comlink";
import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";
import { IServerCall } from "libs/messaging/serverCall";

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
    serverCall: IServerCall<unknown>;
    storage: IStorage;
    telemetryFactory: ITelemetryLoggerFactory;
    messageThingFactory: (this: unknown, gameProperties: GameInstanceProperties) => IMessageThing;
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

    public showTags = observable<string[]>(
        (process.env.REACT_APP_SHOW_DEBUG_GAMES)
            ? ["production", "beta", "alpha", "debug"]
            : ["production", "beta", "alpha"]
        )

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

    @observable private _hostController = observable<Comlink.Remote<IClusterfunHostLifecycleController> | null>([null]);
    @observable private _isHosting: boolean = false;
    get hostController() {
        if (this._isHosting !== !!(this._hostController[0])) {
            Logger.warn("WEIRD: isHosting does not match having the host controller")
        }
        return this._hostController[0] 
    }
    set hostController(value) {action(()=>{
        this._hostController[0] = value;
        this._isHosting = !!value;
    })()}

    @observable  private _gameProperties = observable<GameInstanceProperties | null>([null]);
    get gameProperties() {return this._gameProperties[0]}
    set gameProperties(value) {action(()=>{this._gameProperties[0] = value})()}
    

    @observable  private _lobbyErrorMessage: string| undefined = ""
    get lobbyErrorMessage() {return this._lobbyErrorMessage}
    set lobbyErrorMessage(value) {action(()=>{this._lobbyErrorMessage = value})()}
    

    get canJoin() { return this.playerName.trim() !== "" && this.roomId.trim() !== ""; }

    private _telemetry: ITelemetryLoggerFactory;
    private _logger: ITelemetryLogger;
    private _serverCall: IServerCall<unknown>;
    private _messageThingFactory: (gameProperties: GameInstanceProperties) => IMessageThing;
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
    public getGameConfig(uiProperties: UIProperties): ClusterFunGameAndUIProps {
        if(!this.gameProperties) throw Error("getGameConfig called when there were no game properties")
        return {
            uiProperties,
            hostController:     this.hostController,
            gameProperties:     this.gameProperties,
            playerName:         this.playerName,
            messageThing:       this._messageThingFactory(this.gameProperties!),  
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
        this.gameProperties = null;
        this.saveState();
    }

    // -------------------------------------------------------------------
    // getGameLogger 
    // -------------------------------------------------------------------
    public getGameLogger() {
        return this._telemetry.getLogger(this.gameProperties?.gameName ?? "unknown_game");
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
    public async startGame(gameName: string) {
        if(this.lobbyState !== LobbyState.Fresh)
        {
            throw new Error(`Should not be able to start game from state '${this.lobbyState}'`);
        }
        this._logger.logEvent("Start Game", "Started " + gameName)

        try {
            await this.ensureHostWorker(gameName);
            this.playerName = crypto.randomUUID();
            // Once we have the host thread, join the game as a presenter, setting the lobby to Ready at that point
            await this.joinGame(GameRole.Presenter);
        } catch (e) {
            this.lobbyErrorMessage = "There was an error trying to start the game. Please try again later.";
            Logger.error(e);
            this.lobbyState = LobbyState.Fresh
        }
    }

    // -------------------------------------------------------------------
    // Ensure that the host worker is running, setting the local room ID accordingly
    // -------------------------------------------------------------------
    private async ensureHostWorker(gameName: string) {
        try {
            // Spin up a host thread to host the game
            const gameInitializer = await getGameHostInitializer(gameName);
            if (!gameInitializer) {
                throw new Error("Could not get host initializer for " + gameName);
            } else {
                const reportedGameName = await gameInitializer.getGameName();
                if (reportedGameName !== gameName) {
                    throw new Error("Unexpected game name " + reportedGameName + " returned from worker for " + gameName);
                }
            }
            if (await gameInitializer.isHostAvailable(this.roomId)) {
                // no need to create the game again, return
                return;
            }
            let serverCallSeed = undefined;
            try {
                serverCallSeed = this._serverCall.getSeed();
            } catch {
                serverCallSeed = undefined;
            }
            if (typeof serverCallSeed === "string") {
                // server is a real server, create a server call on the other side
                this.roomId = await gameInitializer.startNewGameOnRemoteOrigin(serverCallSeed, Comlink.proxy(getStorage("clusterfun_host")));
            } else {
                // server is a mocked server running on this thread
                this.roomId = await gameInitializer.startNewGameOnMockedServer(
                    Comlink.proxy(this._serverCall), 
                    Comlink.proxy((gp: GameInstanceProperties) => {
                        const messageThing = this._messageThingFactory(gp);
                        if (messageThing instanceof MessagePortMessageThing) {
                            return Comlink.transfer(messageThing.messagePort, [messageThing.messagePort]);
                        } else {
                            throw new Error("Mocked server provided alongside non-MessagePort-based MessageThing factory")
                        }
                    }),
                    Comlink.proxy(getStorage("clusterfun_host")));
            }
        } catch (e) {
            this.lobbyErrorMessage = "There was an error trying to start the game. Please try again later.";
            Logger.error(e);
            this.lobbyState = LobbyState.Fresh
        }
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
            gameProperties: this.gameProperties,
            _lobbyState: this._lobbyState,
            _rootKey: this._rootKey,
            _isHosting: this._isHosting,
        }
        const saveMe = JSON.stringify(state);
        this._storage.set(LOBBY_STATE_NAME, saveMe);
    }

    // -------------------------------------------------------------------
    // loadState 
    // -------------------------------------------------------------------
    private async loadState()
    {
        try {
            const stateJson = await this._storage.get(LOBBY_STATE_NAME);
            if(stateJson) {
                Object.assign(this, JSON.parse(stateJson) )
                if(!this.gameProperties) {
                    this.lobbyState = LobbyState.Fresh;
                } else if (this._isHosting) {
                    await this.ensureHostWorker(this.gameProperties.gameName);
                    const gameInitializer = (await getGameHostInitializer(this.gameProperties.gameName))!;
                    const lifecycleControllerPort = await gameInitializer.getLifecycleControllerPort(this.roomId);
                    if (lifecycleControllerPort) {
                        this.hostController = Comlink.wrap(lifecycleControllerPort) as Comlink.Remote<IClusterfunHostLifecycleController>;
                    } else {
                        throw new Error("This device is supposed to be hosting")
                    }
                }
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
    public async joinGame(role: GameRole) {
        sessionStorage.setItem("clusterfun_playername",this.playerName) 
        sessionStorage.setItem("clusterfun_roomid",this.roomId) 
        // Note: this does not establish a web socket
        try {
            const properties = await this._serverCall.joinGame(this.roomId, this.playerName, role);
            this.gameProperties = properties;

            const gameName = this.gameProperties.gameName;
            const gameInitializer = (await getGameHostInitializer(gameName))!;
            if (!gameInitializer) {
                throw new Error("Could not get host initializer for " + gameName);
            } else {
                const reportedGameName = await gameInitializer.getGameName();
                if (reportedGameName !== gameName) {
                    throw new Error("Unexpected game name " + reportedGameName + " returned from worker for " + gameName);
                }
            }
            const lifecycleControllerPort = await gameInitializer.getLifecycleControllerPort(this.roomId);
            if (lifecycleControllerPort) {
                this.hostController = Comlink.wrap(lifecycleControllerPort) as Comlink.Remote<IClusterfunHostLifecycleController>;
            }

            this.lobbyState = LobbyState.ReadyToPlay
            this.lobbyErrorMessage = undefined;
            this.saveState();
        } catch (e) {
            this.lobbyErrorMessage = "Unable to join that room code";
            console.error(e);
            this.lobbyState = LobbyState.Fresh
        }
    }
}
