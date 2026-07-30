import {
  EventThing,
  GameInstanceProperties,
  IMessageThing,
  IStorage,
  ITelemetryLogger,
  ITelemetryLoggerFactory,
  UIProperties,
} from "../../libs";
import { action, makeObservable, observable } from "mobx";
import Logger from "js-logger";
import { PlayerIdentityStore } from "../../libs/storage/PlayerIdentityStore";
import { GLOBALS } from "../../Globals";
import { GameEndReason } from "../../libs/GameModel/BaseGameModel";

// What we know about a failed join, for the player to read or send on.  Join
// problems happen on somebody else's phone, at a party, once - so the details
// have to be visible there and then, not only in a server log.
export interface JoinDiagnostics {
  when: string;
  roomId: string;
  playerName: string;
  reason: string; // the server's own words, if it gave any
  category: JoinFailureCategory;
  status?: number;
  url: string;
}

export type JoinFailureCategory =
  "no_such_room" | "bad_request" | "server_error" | "offline" | "unknown";

export enum LobbyMode {
  Unchosen,
  Client,
  Presenter,
}

export enum LobbyState {
  Fresh = "Fresh Lobby",
  ReadyToPlay = "Ready to play!",
}

const LOBBY_STATE_NAME = "lobby_state";

export interface ILobbyDependencies {
  serverCall: <T>(this: unknown, url: string, payload: any) => Promise<T>;
  storage: IStorage;
  telemetryFactory: ITelemetryLoggerFactory;
  messageThingFactory: (this: unknown, gameProperties: GameInstanceProperties) => IMessageThing;
  onGameEnded: (reason?: GameEndReason) => void;
}

export interface HealthColumn {
  label: string;
  data: { count: number; sum: number };
}
export interface HealthData {
  version: string;
  uptime: string;
  rooms: {
    roomCount: number;
    activeRooms: number;
    activeUsers: number;
  };
  summary: HealthColumn[];
  series: { date: number; columns: HealthColumn[] }[];
}

// -------------------------------------------------------------------
// The LobbyModel
// -------------------------------------------------------------------
export class LobbyModel {
  get id() {
    return this._rootKey + "_" + this._instanceCount;
  }
  private _rootKey: string;
  private _instanceCount = 0;
  @observable _playerName: string = "";
  get playerName(): string {
    return this._playerName;
  }
  set playerName(value: string) {
    if (value.length > 16) value = value.substring(0, 16);
    action(() => {
      this._playerName = value;
    })();
    this._identity?.save({ playerName: value });
    this.saveState();
  }

  @observable _avatarId: number = 0;
  get avatarId(): number {
    return this._avatarId;
  }
  set avatarId(value: number) {
    action(() => {
      this._avatarId = value;
      this.saveState();
    })();
    this._identity?.save({ avatarId: value });
  }

  @observable _avatarColor: number = 0;
  get avatarColor(): number {
    return this._avatarColor;
  }
  set avatarColor(value: number) {
    action(() => {
      this._avatarColor = value;
      this.saveState();
    })();
    this._identity?.save({ avatarColor: value });
  }

  playerId: string = "";
  @observable _roomId: string = "";
  get roomId(): string {
    return this._roomId;
  }
  set roomId(value: string) {
    value = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (value.length > 4) value = value.substring(0, 4);
    action(() => {
      this._roomId = value;
      this.saveState();
    })();
    this._identity?.save({ roomId: value });
  }

  public showTags = observable<string[]>(["production", "beta", "alpha"]);

  @observable private _lobbyState: LobbyState = LobbyState.Fresh;
  get lobbyState(): LobbyState {
    return this._lobbyState;
  }
  set lobbyState(value: LobbyState) {
    action(() => {
      this._lobbyState = value;
    })();
  }

  @observable _userChosenMode = LobbyMode.Unchosen;
  get userChosenMode() {
    return this._userChosenMode;
  }
  set userChosenMode(value: LobbyMode) {
    action(() => {
      this._userChosenMode = value;
      this.onUserChoseAMode.invoke();
    })();
  }
  onUserChoseAMode = new EventThing("User Mode Selection");

  @observable private _gameProperties = observable<GameInstanceProperties | null>([null]);
  get gameProperties() {
    return this._gameProperties[0];
  }
  set gameProperties(value) {
    action(() => {
      this._gameProperties[0] = value;
    })();
  }

  @observable private _lobbyErrorMessage: string | undefined = "";
  get lobbyErrorMessage() {
    return this._lobbyErrorMessage;
  }
  set lobbyErrorMessage(value) {
    action(() => {
      this._lobbyErrorMessage = value;
    })();
  }

  get canJoin() {
    return this.playerName.trim() !== "" && this.roomId.trim() !== "";
  }

  private _telemetry: ITelemetryLoggerFactory;
  private _logger: ITelemetryLogger;
  private _serverCall: <T>(url: string, payload: any) => Promise<T>;
  private _messageThingFactory: (gameProperties: GameInstanceProperties) => IMessageThing;
  private _onGameEnded: (reason?: GameEndReason) => void;
  private _storage: IStorage;
  private _dependencies: ILobbyDependencies;
  // Name and avatar live in localStorage, so they survive closing the browser.
  // The rest of the lobby's state is sessionStorage on purpose - a saved game
  // should not outlive the session.
  private _identity: PlayerIdentityStore;
  // Recorded in diagnostics so a report says which build it came from
  private _version = GLOBALS.Version;

  // Set when a join fails, for the diagnostics panel.  Cleared on a new attempt.
  @observable private _joinDiagnostics: JoinDiagnostics | null = null;
  get joinDiagnostics() {
    return this._joinDiagnostics;
  }
  private setJoinDiagnostics(value: JoinDiagnostics | null) {
    action(() => {
      this._joinDiagnostics = value;
    })();
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(dependencies: ILobbyDependencies, rootKey: string) {
    makeObservable(this);
    this._dependencies = dependencies;
    this._rootKey = rootKey;

    let tempCount = this._instanceCount + 1;
    // Who you were last time.  This is why opening the lobby shows your own
    // name, avatar and (until the game ends) room code already filled in.
    this._identity = new PlayerIdentityStore();
    const remembered = this._identity.load();
    this._playerName = remembered.playerName;
    this._avatarId = remembered.avatarId;
    this._avatarColor = remembered.avatarColor;
    this.playerId = "";
    this._roomId = remembered.roomId;
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

    this._logger.logPageView("/");
  }

  // -------------------------------------------------------------------
  // getGameConfig
  // -------------------------------------------------------------------
  public getGameConfig(uiProperties: UIProperties) {
    if (!this.gameProperties)
      throw Error("getGameConfig called when there were no game properties");
    return {
      uiProperties,
      gameProperties: this.gameProperties,
      playerName: this.playerName,
      avatarId: this.avatarId,
      avatarColor: this.avatarColor,
      messageThing: this._messageThingFactory(this.gameProperties!),
      logger: this.getGameLogger(),
      storage: this._storage,
      onGameEnded: this.onGameEnded,
      serverCall: this._dependencies.serverCall,
    };
  }

  // -------------------------------------------------------------------
  // onGameOver
  // -------------------------------------------------------------------
  private onGameEnded = (reason?: GameEndReason) => {
    Logger.debug(`Gameover signalled (${reason ?? "unknown"})`);
    this.lobbyState = LobbyState.Fresh;
    if (this._onGameEnded) this._onGameEnded(reason);
    this.gameProperties = null;
    // Only retire the code when the HOST ended things - then it is a dead room
    // and offering it again would send the player nowhere.  A player who taps
    // Quit is just stepping out, and should find their lobby exactly as they
    // left it: name, avatar and code all still filled in.
    if (reason === "hostEnded" || reason === "terminated") {
      this._identity.forgetRoom();
      action(() => {
        this._roomId = "";
      })();
    }
    this.saveState();
  };

  // -------------------------------------------------------------------
  // forgetMe - drop the remembered identity entirely
  // -------------------------------------------------------------------
  public forgetMe() {
    this._identity.forgetAll();
    this.playerName = "";
    this.avatarId = 0;
    this.avatarColor = 0;
    this.roomId = "";
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
    setTimeout(() => {
      this._storage.clear();
      this.lobbyState = LobbyState.Fresh;
    }, 10);
  }

  // -------------------------------------------------------------------
  // startGame
  // -------------------------------------------------------------------
  public startGame(gameName: string) {
    if (this.lobbyState !== LobbyState.Fresh) {
      throw new Error(`Should not be able to start game from state '${this.lobbyState}'`);
    }
    this._logger.logEvent("Start Game", "Started " + gameName);

    const payload: any = { gameName };
    const previousData = sessionStorage.getItem("clusterfun_roominfo");
    if (previousData) {
      Logger.info(`Found previous data: ${previousData}`);
      const oldProps = JSON.parse(previousData) as GameInstanceProperties;
      payload.existingRoom = {
        id: oldProps.roomId,
        presenterId: oldProps.presenterId,
        presenterSecret: oldProps.personalSecret,
      };
    }

    this._serverCall<GameInstanceProperties>("/api/startgame", payload)
      .then((properties) => {
        this.gameProperties = properties;
        const data = JSON.stringify(properties);
        Logger.info(`Storing ${data}`);
        sessionStorage.setItem("clusterfun_roominfo", data);
        this.lobbyState = LobbyState.ReadyToPlay;
        this.lobbyErrorMessage = undefined;
        this.saveState();
      })
      .catch((e) => {
        this.lobbyErrorMessage =
          "There was an error trying to start the game. Please try again later.";
        Logger.error(e);
        this.lobbyState = LobbyState.Fresh;
      });
  }

  // -------------------------------------------------------------------
  // saveState
  // -------------------------------------------------------------------
  saveState() {
    const state = {
      _playerName: this._playerName,
      _avatarId: this._avatarId,
      _avatarColor: this._avatarColor,
      playerId: this.playerId,
      _roomId: this._roomId,
      gameProperties: this.gameProperties,
      _lobbyState: this._lobbyState,
      _rootKey: this._rootKey,
    };
    const saveMe = JSON.stringify(state);
    this._storage.set(LOBBY_STATE_NAME, saveMe);
  }

  // -------------------------------------------------------------------
  // loadState
  // -------------------------------------------------------------------
  private loadState() {
    try {
      const stateJson = this._storage.get(LOBBY_STATE_NAME);
      if (stateJson) {
        Object.assign(this, JSON.parse(stateJson));
        if (!this.gameProperties) this.lobbyState = LobbyState.Fresh;
      }
    } catch (err) {
      this.clearStorage();
      this._logger.logEvent("Lobby", "Reconnect Error", (err as any).message);
    }
  }

  // -------------------------------------------------------------------
  // joinGame
  // -------------------------------------------------------------------
  public async joinGame() {
    const attemptedRoom = this.roomId;
    this._identity.save({
      playerName: this.playerName,
      avatarId: this.avatarId,
      avatarColor: this.avatarColor,
      roomId: attemptedRoom,
    });
    this.setJoinDiagnostics(null);
    this._logger.logAnalyticsEvent("cf_join_attempt", {
      game: "Lobby",
      entity: "lobby",
      room_id_length: attemptedRoom.length,
    });

    // Note: this does not establish a web socket
    this._serverCall<GameInstanceProperties>("/api/joingame", {
      roomId: attemptedRoom,
      playerName: this.playerName,
    })
      .then((properties) => {
        this.gameProperties = properties;
        this.lobbyState = LobbyState.ReadyToPlay;
        this.lobbyErrorMessage = undefined;
        this.setJoinDiagnostics(null);
        this.saveState();
      })
      .catch((e) => {
        this.recordJoinFailure(attemptedRoom, e);
        this.lobbyState = LobbyState.Fresh;
      });
  }

  // -------------------------------------------------------------------
  // recordJoinFailure - a join failed on someone else's phone, at a party,
  // once.  "Unable to join that room code" was all we used to say, and the
  // real reason only existed in the server's log under a timecode - so this
  // keeps the details where the player can read them out or send them on,
  // and reports the category to analytics so failures in the wild show up
  // without anybody having to describe them.
  // -------------------------------------------------------------------
  private recordJoinFailure(attemptedRoom: string, error: unknown) {
    const raw = (error as any)?.message ? String((error as any).message) : String(error);
    // serverCall throws "Server call failed" + the response body, which is
    // JSON with an errorMessage for anything the server chose to explain.
    let reason = raw;
    let status: number | undefined;
    const statusMatch = raw.match(/(4\d\d|5\d\d)/);
    if (statusMatch) status = parseInt(statusMatch[1], 10);
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(raw.slice(jsonStart));
        if (body?.errorMessage) reason = String(body.errorMessage);
      } catch {
        /* not JSON after all - keep the raw text */
      }
    }

    let category: JoinFailureCategory = "unknown";
    let message: string;
    if (/not open/i.test(reason) || /invalid room/i.test(reason)) {
      category = "no_such_room";
      message = reason;
    } else if (/failed to fetch|networkerror|load failed/i.test(raw)) {
      category = "offline";
      message = "Could not reach the server. Check the phone's wifi or signal and try again.";
    } else if (/server error/i.test(reason)) {
      category = "server_error";
      message = "The server hit a problem joining that room. The details below say where.";
    } else if (status && status < 500) {
      category = "bad_request";
      message = reason;
    } else {
      message = "Unable to join that room code.";
    }

    this.lobbyErrorMessage = message;
    this.setJoinDiagnostics({
      when: new Date().toISOString(),
      roomId: attemptedRoom,
      playerName: this.playerName,
      reason,
      category,
      status,
      url: "/api/joingame",
    });
    Logger.error(`Join failed (${category}) for room '${attemptedRoom}': ${raw}`);
    this._logger.logAnalyticsEvent("cf_join_failed", {
      game: "Lobby",
      entity: "lobby",
      category,
      status: status ?? 0,
    });
  }

  // A single block of text the player can read out or paste into a message
  public joinDiagnosticsText(): string {
    const d = this._joinDiagnostics;
    if (!d) return "";
    return [
      `ClusterFun join problem`,
      `time:   ${d.when}`,
      `room:   ${d.roomId || "(blank)"}`,
      `name:   ${d.playerName || "(blank)"}`,
      `kind:   ${d.category}${d.status ? ` (HTTP ${d.status})` : ""}`,
      `server: ${d.reason}`,
      `client: v${this._version}`,
    ].join("\n");
  }
}
