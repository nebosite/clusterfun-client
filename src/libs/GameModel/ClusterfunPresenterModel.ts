import { ITypeHelper, ISessionHelper, ITelemetryLogger, IStorage } from "../../libs";
import { AnalyticsEntity, GameOutcome } from "../telemetry/AnalyticsTypes";
import { action, makeObservable, observable } from "mobx";
import { BaseGameModel, GeneralGameState } from "./BaseGameModel";
import Logger from "js-logger";
import {
  JoinEndpoint,
  PauseGameEndpoint,
  PingEndpoint,
  QuitEndpoint,
  ResumeGameEndpoint,
  TerminateGameEndpoint,
} from "libs/messaging/basicEndpoints";
import MessageEndpoint from "libs/messaging/MessageEndpoint";

// All games have these states which are managed
// in the base classes
export enum PresenterGameState {
  Gathering = "Gathering",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum PresenterGameEvent {
  PlayerJoined = "PlayerJoined",
}

export class ClusterFunPlayer {
  // The private token from the device that owns this seat.  Reconnecting is
  // matched on it, so nobody can claim a player by typing their name.
  playerToken: string = "";
  playerId: string = "";
  @observable name: string = "";
  // The avatar mark the player picked in the lobby (see PlayerAvatar).
  // Games should show this next to the player's name during play.
  @observable avatarId: number = 0;
  // Palette slot the player picked in the lobby (see AVATAR_COLORS)
  @observable avatarColor: number = 0;
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getPresenterTypeHelper = (derivedClassHelper: ITypeHelper): ITypeHelper => {
  return {
    rootTypeName: derivedClassHelper.rootTypeName,
    getTypeName(o: object) {
      switch (o.constructor) {
        case ClusterFunPlayer:
          return "ClusterFunPlayer";
      }
      return derivedClassHelper.getTypeName(o);
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "ClusterFunPlayer":
          return new ClusterFunPlayer();
      }
      return derivedClassHelper.constructType(typeName);
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      return derivedClassHelper.shouldStringify(typeName, propertyName, object);
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      switch (propertyName) {
        case "players":
        case "_exitedPlayers":
          return observable<ClusterFunPlayer>(rehydratedObject as ClusterFunPlayer[]);
      }
      return derivedClassHelper.reconstitute(typeName, propertyName, rehydratedObject);
    },
  };
};

// -------------------------------------------------------------------
// Base class for all clusterfun game presenters.
// This handles:
//      - Player list management, joining, rejoinging, etx.
//      - General game lifecycle control
// -------------------------------------------------------------------
export abstract class ClusterfunPresenterModel<
  PlayerType extends ClusterFunPlayer,
> extends BaseGameModel {
  players = observable<PlayerType>([]);
  _exitedPlayers = new Array<PlayerType>();
  public get isStageOver() {
    return this.gameTime_ms > this.timeOfStageEnd;
  }
  // The time since game start in milliseconds
  @observable timeOfStageEnd: number = 1;
  @observable secondsLeftInStage: number = 0; // calculated based on timeOfStageEnd
  @observable isPaused: boolean = false;
  @observable currentRound = 0;
  @observable totalRounds = 3;

  @observable private _showDebugInfo = false;
  get showDebugInfo() {
    return this._showDebugInfo;
  }
  set showDebugInfo(value) {
    action(() => {
      this._showDebugInfo = value;
    })();
  }

  // When a player leaves and the game drops below minPlayers, pause and wait
  // for them.  A game that can carry on without them - by handing their seat
  // to a bot, say - sets this false and takes over in onPlayerExited.
  protected pauseWhenTooFewPlayers = true;

  // A game may let a brand new player in outside allowedJoinStates - joining
  // a few seconds late is a slow phone, not a gatecrasher.  Returning players
  // are always let back in and never reach this.
  protected allowsLateJoin(): boolean {
    return false;
  }

  // Hooks for a game that wants to do something about a player coming and
  // going mid-match.  Both are no-ops by default.
  protected onPlayerExited(_player: PlayerType) {}
  // `previousPlayerId` is what they were known by before this reconnect.  The
  // relay issues a NEW id on every join, so anything a game keys by player id
  // - a board, a target, a score row - has to be moved across, or the player
  // comes back to a seat they can no longer reach.
  protected onPlayerReturned(_player: PlayerType, _previousPlayerId: string) {}

  // General Game Settings
  minPlayers = 3;
  maxPlayers = 8;
  allowRejoinOnNameOnly = true;
  allowedJoinStates: string[] = [PresenterGameState.Gathering];

  private _stateBeforePause: string = "";
  private _fullyInitialized = false;

  // Analytics bookkeeping.  Both are plain serializable fields so a host that
  // refreshes mid-game still reports an honest duration and does not
  // double-report an ending.
  protected _gameStartedAtMs = 0;
  private _gameEndReported = false;

  protected get analyticsEntity(): AnalyticsEntity {
    return "host";
  }

  // Wall-clock seconds since this game started (0 if it never did)
  private get _gameDurationSeconds(): number {
    if (!this._gameStartedAtMs) return 0;
    return (Date.now() - this._gameStartedAtMs) / 1000;
  }

  // -------------------------------------------------------------------
  // reportGameEnded - fired once per game, whichever way it ends.  Reaching
  // GameOver is "completed"; being destroyed while still playing is
  // "abandoned".  A game nobody ever started is not reported at all.
  // -------------------------------------------------------------------
  private reportGameEnded(outcome: GameOutcome) {
    if (this._gameEndReported || !this._gameStartedAtMs) return;
    this._gameEndReported = true;
    this.analytics.gameEnded(outcome, this.players.length, this._gameDurationSeconds);
  }

  abstract createFreshPlayerEntry(name: string, id: string): PlayerType;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    name: string,
    sessionHelper: ISessionHelper,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super(name, sessionHelper, logger, storage);
    makeObservable(this);

    this.gameTime_ms = 0;

    this.gameState = PresenterGameState.Gathering;
  }

  reconstitute(): void {
    super.reconstitute();
    // Setting gameState raises an event named after the state, so the two ways
    // a game can end are just two subscriptions.  Destroyed fires for both a
    // deliberate quit and a torn-down room, and reportGameEnded is idempotent,
    // so a game that ends properly and is then destroyed reports once.
    this.subscribe(GeneralGameState.GameOver, "Analytics GameOver", () =>
      this.reportGameEnded("completed"),
    );
    this.subscribe(GeneralGameState.Destroyed, "Analytics Destroyed", () =>
      this.reportGameEnded("abandoned"),
    );
    this.subscribe(GeneralGameState.Destroyed, "Presenter EndGame", async () => {
      if (this._fullyInitialized) {
        await this.requestEveryone(TerminateGameEndpoint, (p, ie) => ({}));
        setTimeout(() => {
          this.session.serverCall<void>("/api/terminategame", {
            roomId: this.roomId,
            presenterSecret: this.session.personalSecret,
          });
        }, 200);
      }
    });
    this.onTick.subscribe("PresenterState", () => this.manageState());

    this.listenToEndpoint(JoinEndpoint, this.handleJoinMessage);
    this.listenToEndpoint(QuitEndpoint, this.handlePlayerQuitMessage);
    this.listenToEndpoint(PingEndpoint, this.handlePing);
    setTimeout(() => (this._fullyInitialized = true), 500);
  }

  // -------------------------------------------------------------------
  //  handleJoinMessage
  // -------------------------------------------------------------------
  handleJoinMessage = async (
    sender: string,
    message: {
      playerName: string;
      avatarId?: number;
      avatarColor?: number;
      playerToken?: string;
    },
  ): Promise<{ isRejoin: boolean; didJoin: boolean; joinError?: string }> => {
    Logger.info(`Join message from ${sender}`);

    // If a player has already joined, any additional Join messages should be idempotent.
    // Do send an Ack in case it's needed, though.
    let resendingPlayer = this.players.find((p) => p.playerId === sender) as unknown as PlayerType;
    // ...or the same person back on a new connection, which the relay gives a
    // new id.  Their token still names them, so move the seat to the new id.
    if (!resendingPlayer && message.playerToken) {
      const sameDevice = this.players.find(
        (p) => p.playerToken && p.playerToken === message.playerToken,
      ) as unknown as PlayerType;
      if (sameDevice) {
        const previousPlayerId = sameDevice.playerId;
        action(() => {
          sameDevice.playerId = sender;
        })();
        this.onPlayerReturned(sameDevice, previousPlayerId);
        this.saveCheckpoint();
        resendingPlayer = sameDevice;
      }
    }
    if (resendingPlayer) {
      Logger.debug(`Repeated join message: ${resendingPlayer.name}`);
      return {
        didJoin: true,
        isRejoin: true,
      };
    }

    // Finding a returning player, in order of how much we trust the evidence.
    //
    // The private token comes first: a phone keeps it for itself, so it proves
    // the device really is the one that held the seat.  The relay hands out a
    // brand new playerId on every join, so after a genuine disconnect the id
    // is useless - the token is what makes reconnecting work at all.
    let matchedByName = false;
    const token = message.playerToken;
    let returningPlayer = (token
      ? this._exitedPlayers.find((p) => p.playerToken === token)
      : undefined) as unknown as PlayerType;

    // Then the player id, for a client that never really went away
    if (!returningPlayer) {
      returningPlayer = this._exitedPlayers.find(
        (p) => p.playerId === sender,
      ) as unknown as PlayerType;
    }

    // Name matching is the last resort, and only for a game that asks for it:
    // names are public - they are on the big screen - so anyone could type one
    // in and take a seat.  A device that presented a token is never matched
    // this way, because a token that does not match means it is NOT them.
    if (!returningPlayer && this.allowRejoinOnNameOnly && !token) {
      returningPlayer = this._exitedPlayers.find(
        (p) => p.name === message.playerName,
      ) as unknown as PlayerType;
      matchedByName = !!returningPlayer;
    }

    if (returningPlayer) {
      Logger.info(`Returning player: ${returningPlayer.name}`);
      const previousPlayerId = returningPlayer.playerId;
      // players is observable, so the reseating belongs in an action
      action(() => {
        returningPlayer.playerId = sender;
        if (message.playerToken) returningPlayer.playerToken = message.playerToken;
        if (message.avatarId !== undefined) returningPlayer.avatarId = message.avatarId;
        if (message.avatarColor !== undefined) returningPlayer.avatarColor = message.avatarColor;
        const index = this._exitedPlayers.indexOf(returningPlayer);
        this._exitedPlayers.splice(index, 1);
        this.players.push(returningPlayer);
      })();
      this.telemetryLogger.logEvent("Presenter", "JoinRequest", "ApproveRejoin");
      // A returning player is the lost-connection signal: this branch is only
      // reached for somebody the host had already lost.  `matchedBy` says
      // whether their device remembered its id or they had to be found by
      // name, which is what a full device reboot looks like.
      this.analytics.playerRejoined(this.players.length, matchedByName ? "name" : "id");
      this.onPlayerReturned(returningPlayer, previousPlayerId);
      this.invokeEvent(PresenterGameEvent.PlayerJoined, returningPlayer);
      return {
        didJoin: true,
        isRejoin: true,
      };
    } else if (this.allowedJoinStates.find((s) => s === this.gameState) || this.allowsLateJoin()) {
      Logger.info(`New Player`);
      if (this.players.length < this.maxPlayers) {
        let existingPlayer = this.players.find(
          (p) => p.name === message.playerName,
        ) as unknown as PlayerType;
        Logger.info(`Existing Player:: ${existingPlayer?.name}`);
        if (existingPlayer) {
          Logger.info(`Denying join because name exists`);
          this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Name Taken)");
          this.analytics.joinDenied("name_taken");
          return { didJoin: false, isRejoin: false, joinError: `That name is taken` };
        } else {
          const entry = this.createFreshPlayerEntry(message.playerName, sender);
          entry.playerToken = message.playerToken ?? "";
          entry.avatarId = message.avatarId ?? 0;
          entry.avatarColor = message.avatarColor ?? 0;
          this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Approve");
          action(() => {
            this.players.push(entry);
          })();
          this.saveCheckpoint();
          this.invokeEvent(PresenterGameEvent.PlayerJoined, entry);
          this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Approve new player");
          this.analytics.playerJoined(this.players.length);
          return { didJoin: true, isRejoin: false };
        }
      } else {
        this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Full)");
        this.analytics.joinDenied("room_full");
        return {
          didJoin: false,
          isRejoin: false,
          joinError: "The room is full",
        };
      }
    } else {
      this.telemetryLogger.logEvent("Presenter", "JoinRequest", "Deny (Not Allowed)");
      this.analytics.joinDenied("room_closed");
      return {
        didJoin: false,
        isRejoin: false,
        joinError: `The room is currently closed (game state: ${this.gameState})`,
      };
    }
  };

  // -------------------------------------------------------------------
  //  handlePlayerQuitMessage
  // -------------------------------------------------------------------
  handlePlayerQuitMessage = (sender: string, message: any) => {
    if (this.gameState === GeneralGameState.Destroyed) return;
    Logger.info("received quit message from " + sender);
    this.telemetryLogger.logEvent("Presenter", "QuitRequest");
    this.analytics.playerQuit(Math.max(0, this.players.length - 1));
    const player = this.players.find((p) => p.playerId === sender);
    if (player) {
      this.players.remove(player);
      this._exitedPlayers.push(player);
      this.onPlayerExited(player as unknown as PlayerType);

      if (
        this.pauseWhenTooFewPlayers &&
        this.players.length < this.minPlayers &&
        this.gameState !== PresenterGameState.Gathering
      ) {
        this.pauseGame();
      }
      this.saveCheckpoint();
    }
  };

  // -------------------------------------------------------------------
  //  run a method to check for a state transition
  // -------------------------------------------------------------------
  private manageState() {
    this.secondsLeftInStage = Math.max(
      0,
      Math.floor((this.timeOfStageEnd - this.gameTime_ms) / 1000),
    );
    this.handleTick();
  }

  // -------------------------------------------------------------------
  //  playAgain - reset the player list and start the game over
  // -------------------------------------------------------------------
  playAgain(resetPlayerList: boolean) {
    if (resetPlayerList) {
      this.players.clear();
    }

    const players = this.players.slice(0);
    this.players.clear();
    players.forEach((player) => {
      this.players.push(this.createFreshPlayerEntry(player.name, player.playerId));
    });
    this.telemetryLogger.logEvent("Presenter", "PlayAgain");

    this.prepareFreshGame();
    this.startGame();
  }

  // -------------------------------------------------------------------
  //  startGame
  // -------------------------------------------------------------------
  startGame = () => {
    const replay = this._gameStartedAtMs > 0;
    this._gameStartedAtMs = Date.now();
    this._gameEndReported = false;
    this.gameState = GeneralGameState.Playing;
    this.prepareFreshRound();
    this.startNextRound();
    this.saveCheckpoint();
    this.telemetryLogger.logEvent("Presenter", "Start");
    this.analytics.gameStarted(this.players.length, replay);
  };

  // -------------------------------------------------------------------
  //  reset the stage end time to a new value
  // -------------------------------------------------------------------
  setStageEndTime(millisecondsAhead: number) {
    this.timeOfStageEnd = this.gameTime_ms + millisecondsAhead;
  }

  // -------------------------------------------------------------------
  // handle the passage of time. This should include a check for
  // the game state ending when its time expires
  // -------------------------------------------------------------------
  abstract handleTick(): void;

  // -------------------------------------------------------------------
  // Start a game round
  // -------------------------------------------------------------------
  abstract startNextRound(): void;

  // -------------------------------------------------------------------
  // Start a game round
  // -------------------------------------------------------------------
  abstract prepareFreshRound(): void;

  // -------------------------------------------------------------------
  // Start a whole new game
  // -------------------------------------------------------------------
  abstract prepareFreshGame(): void;

  // -------------------------------------------------------------------
  //  resumeGame
  // -------------------------------------------------------------------
  resumeGame = () => {
    if (this._stateBeforePause === GeneralGameState.Unknown) {
      Logger.warn(
        `WEIRD:  Attempted resuming with previous unknown state. Current state is ${this.gameState}`,
      );
    } else {
      this.gameState = this._stateBeforePause;
      this.requestEveryone(ResumeGameEndpoint, (p, exited) => ({}));
    }
    this.isPaused = false;
  };

  // -------------------------------------------------------------------
  //  pauseGame
  // -------------------------------------------------------------------
  pauseGame = () => {
    this._stateBeforePause = this.gameState;
    this.gameState = GeneralGameState.Paused;
    this.requestEveryone(PauseGameEndpoint, (p, exited) => ({}));
    this.isPaused = true;
  };

  // -------------------------------------------------------------------
  //  handle a ping message from the player
  // -------------------------------------------------------------------
  handlePing = (
    sender: string,
    message: { pingTime: number },
  ): { pingTime: number; localTime: number } => {
    return { pingTime: message.pingTime, localTime: Date.now() };
  };

  // -------------------------------------------------------------------
  //  requestEveryone - make a request to all players, bundling the responses
  //  in a Promise.all() style array
  //  generateMessage should return falsy if a message should not go
  //  to that player
  // -------------------------------------------------------------------
  async requestEveryone<REQUEST, RESPONSE>(
    endpoint: MessageEndpoint<REQUEST, RESPONSE>,
    generateRequest: (player: PlayerType, isExited: boolean) => REQUEST | undefined,
  ): Promise<(RESPONSE | undefined)[]> {
    const sendToPlayer =
      (isExited: boolean) =>
      async (player: PlayerType): Promise<RESPONSE | undefined> => {
        // Don't send to self
        if (player.playerId !== this.session.personalId) {
          const request = generateRequest(player, isExited);
          if (request) {
            const promise = this.session.request<REQUEST, RESPONSE>(
              endpoint,
              player.playerId,
              request,
            );
            return promise;
          } else {
            return Promise.resolve(undefined);
          }
        }
      };

    return Promise.all(this.players.map(sendToPlayer(false)));
  }

  // -------------------------------------------------------------------
  //  sendToEveryone - send a fire-and-forget message to all players
  //  generateMessage should return falsy if a message should not go
  //  to that player
  // -------------------------------------------------------------------
  sendToEveryone<MESSAGE>(
    endpoint: MessageEndpoint<MESSAGE, void>,
    generateRequest: (player: PlayerType, isExited: boolean) => MESSAGE | undefined,
  ): void {
    const sendToPlayer =
      (isExited: boolean) =>
      async (player: PlayerType): Promise<void> => {
        // Don't send to self
        if (player.playerId !== this.session.personalId) {
          const request = generateRequest(player, isExited);
          if (request) {
            this.session.sendMessage(endpoint, player.playerId, request);
          }
        }
      };

    this.players.forEach(sendToPlayer(false));
  }
}
