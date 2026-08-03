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

// How long a player can go unheard-from before the host shows them as
// disconnected.  The phone pings every 10s, so this is three missed pings -
// long enough to ride out a lift or a wobbly router, short enough that the
// room can see who has actually dropped.
export const DISCONNECT_TIMEOUT_MS = 30 * 1000;

export class ClusterFunPlayer {
  // The private token from the device that owns this seat: one per
  // (device, player name).  Reconnecting is matched on it, so nobody can
  // claim a seat by typing somebody else's name.
  playerToken: string = "";

  // STABLE for the whole game.  Set once, from the connection this player
  // first arrived on, and never reassigned - so anything a game keys by
  // playerId (a board, a piece, a photo, a team) survives a reconnect
  // untouched.  The token is what re-finds the seat; this is what names it.
  //
  // Deliberately NOT derived from playerToken: this value travels in every
  // roster to every phone, while the token is the private proof of who owns
  // a seat.  Publishing a function of the token would hand everyone in the
  // room what they need to claim somebody else's seat.
  //
  // This is NOT a relay address either.  See connectionId.
  playerId: string = "";

  // Where the relay can reach this player RIGHT NOW.  The relay issues a
  // fresh id on every connection, so this changes each time the phone comes
  // back.  Never key game state on it; the base class does the addressing.
  connectionId: string = "";

  // False once we have not heard from the phone for DISCONNECT_TIMEOUT_MS.
  // The player keeps their seat and all their state - they are expected
  // back.  Games should show them greyed out rather than removing them.
  @observable isConnected: boolean = true;

  // Wall-clock ms of the last message we had from this player.
  lastSeenMs: number = 0;

  @observable name: string = "";
  // The avatar mark the player picked in the lobby (see PlayerAvatar).
  // Games should show this next to the player's name during play.
  @observable avatarId: number = 0;
  // Palette slot the player picked in the lobby (see AVATAR_COLORS)
  @observable avatarColor: number = 0;
}

// What the host learned about a player coming back, handed to
// onPlayerReturned so a game can react to the interesting cases.
export interface ReconnectInfo {
  // The relay id they had before this reconnect.  Only useful for
  // debugging now that playerId is stable - kept because it is the one
  // piece of "what just happened" a game cannot recover otherwise.
  previousConnectionId: string;
  // True if they were actually shown as disconnected, rather than just
  // re-sending a Join over a live connection.
  wasDisconnected: boolean;
  // How they proved who they were.
  matchedBy: "token" | "connection" | "name";
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

  // A player was booted by the host.  They are out of `players` and their
  // seat is free.  Distinct from disconnecting, which keeps the seat.
  protected onPlayerExited(_player: PlayerType) {}

  // A player has gone quiet - phone asleep, tunnel, flat battery.  They KEEP
  // their seat and all their state and are expected back, so the useful
  // things to do here are cosmetic (grey them out) or continuity (hand their
  // seat to a bot).  Do not delete their state.
  protected onPlayerDisconnected(_player: PlayerType) {}

  // -------------------------------------------------------------------
  // onPlayerReturned - a player came back.
  //
  // ABSTRACT ON PURPOSE.  Reconnecting mid-game is the most common thing
  // that happens to a party game, and a game that has not thought about it
  // is a game that breaks in front of guests.  So every game has to say what
  // it does here, even if the answer is "nothing" - a one-line body with a
  // comment explaining why is a real answer, and it will not compile if
  // somebody forgets.
  //
  // `playerId` is STABLE across reconnects, so there is no state to migrate:
  // boards, pieces, scores and teams keyed by playerId are still theirs.
  // The base class has already restored their connection and marked them
  // connected before this runs.  Games mostly use this to hand a seat back
  // from a bot, or to push fresh state at the returning phone.
  // -------------------------------------------------------------------
  protected abstract onPlayerReturned(player: PlayerType, info: ReconnectInfo): void;

  // General Game Settings
  minPlayers = 3;
  maxPlayers = 8;
  allowRejoinOnNameOnly = true;
  allowedJoinStates: string[] = [PresenterGameState.Gathering];

  private _stateBeforePause: string = "";
  // True when the base class paused the game itself because too many phones
  // had dropped - as opposed to the host pausing it on purpose.  Only an
  // automatic pause is automatically undone.
  private _pausedWaitingForPlayers = false;
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

    // Join is the one endpoint that must see the RAW relay connection id -
    // it is what establishes the mapping everything else relies on.
    this.listenToConnection(JoinEndpoint, this.handleJoinMessage);
    this.listenToEndpoint(QuitEndpoint, this.handlePlayerQuitMessage);
    this.listenToEndpoint(PingEndpoint, this.handlePing);

    // A presenter that just restored from a checkpoint has not heard from
    // anybody yet.  Give every seat a fresh grace period rather than
    // declaring the whole room disconnected half a second after a refresh.
    const now = Date.now();
    for (const player of this.players) player.lastSeenMs = now;

    setTimeout(() => (this._fullyInitialized = true), 500);
  }

  // -------------------------------------------------------------------
  // listenToEndpoint - as the base class, but the `sender` handed to a
  // game's handler is the player's STABLE playerId, not the relay's
  // connection id.
  //
  // This is the pivot that makes stable ids work without every game
  // rewriting its handlers: `players.find(p => p.playerId === sender)`
  // keeps meaning what it always meant, and keeps being right after a
  // reconnect.  Receiving anything from a player also counts as hearing
  // from them, which is what drives disconnect detection.
  //
  // A message from someone holding no seat passes through untranslated, so
  // a game's lookup simply finds nobody - which is the safe answer.
  // -------------------------------------------------------------------
  protected listenToEndpoint<REQUEST, RESPONSE>(
    endpoint: MessageEndpoint<REQUEST, RESPONSE>,
    apiCallback: (sender: string, request: REQUEST) => RESPONSE | PromiseLike<RESPONSE>,
  ) {
    return super.listenToEndpoint(endpoint, (connectionId: string, request: REQUEST) => {
      const player = this.playerByConnection(connectionId);
      if (!player) return apiCallback(connectionId, request);
      player.lastSeenMs = Date.now();
      if (!player.isConnected) {
        // Heard from them again without a Join - the socket outlived the
        // gap.  Treat it as a return so games get their hook either way.
        action(() => {
          player.isConnected = true;
        })();
        this.onPlayerReturned(player, {
          previousConnectionId: connectionId,
          wasDisconnected: true,
          matchedBy: "connection",
        });
      }
      return apiCallback(player.playerId, request);
    });
  }

  // -------------------------------------------------------------------
  // listenToConnection - the untranslated form, for the handful of
  // endpoints that deal in connections rather than players.
  // -------------------------------------------------------------------
  protected listenToConnection<REQUEST, RESPONSE>(
    endpoint: MessageEndpoint<REQUEST, RESPONSE>,
    apiCallback: (connectionId: string, request: REQUEST) => RESPONSE | PromiseLike<RESPONSE>,
  ) {
    return super.listenToEndpoint(endpoint, apiCallback);
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
  ): Promise<{
    isRejoin: boolean;
    didJoin: boolean;
    joinError?: string;
    playerId?: string;
  }> => {
    Logger.info(`Join message from connection ${sender}`);

    // Finding a returning player, in order of how much we trust the evidence.
    //
    // The private token comes first: a phone keeps it for itself, so it
    // proves the device really is the one that holds the seat.  Nobody is
    // removed from `players` for going quiet, so a returning player is
    // almost always found right here.
    const token = message.playerToken;
    let matchedBy: ReconnectInfo["matchedBy"] = "token";
    let returningPlayer = (token
      ? this.findSeat((p) => p.playerToken === token)
      : undefined) as unknown as PlayerType;

    // Then the live connection, for a client that never really went away and
    // is just re-sending its Join.
    if (!returningPlayer) {
      returningPlayer = this.findSeat((p) => p.connectionId === sender) as unknown as PlayerType;
      if (returningPlayer) matchedBy = "connection";
    }

    // Name matching is the last resort, and only for a game that asks for it:
    // names are public - they are on the big screen - so anyone could type
    // one in and take a seat.  A device that presented a token is never
    // matched this way, because a token that does not match means it is NOT
    // them.
    if (!returningPlayer && this.allowRejoinOnNameOnly && !token) {
      returningPlayer = this.findSeat(
        (p) => p.name === message.playerName,
      ) as unknown as PlayerType;
      if (returningPlayer) matchedBy = "name";
    }

    if (returningPlayer) {
      const wasDisconnected = !returningPlayer.isConnected;
      const previousConnectionId = returningPlayer.connectionId;
      Logger.info(
        `Returning player: ${returningPlayer.name} (matched by ${matchedBy},` +
          ` was ${wasDisconnected ? "disconnected" : "connected"})`,
      );

      // Re-point the seat at the new connection.  playerId is deliberately
      // NOT touched - that is the whole point of it being stable.
      action(() => {
        returningPlayer.connectionId = sender;
        returningPlayer.isConnected = true;
        returningPlayer.lastSeenMs = Date.now();
        if (message.playerToken) returningPlayer.playerToken = message.playerToken;
        if (message.avatarId !== undefined) returningPlayer.avatarId = message.avatarId;
        if (message.avatarColor !== undefined) returningPlayer.avatarColor = message.avatarColor;
        // A booted player who talks their way back in rejoins the room.
        const exitedIndex = this._exitedPlayers.indexOf(returningPlayer);
        if (exitedIndex >= 0) {
          this._exitedPlayers.splice(exitedIndex, 1);
          this.players.push(returningPlayer);
        }
      })();

      this.telemetryLogger.logEvent("Presenter", "JoinRequest", "ApproveRejoin");
      // Only count it as a rejoin for analytics if they had actually been
      // lost - a phone re-sending Join over a live socket is not a
      // reconnection and should not look like one in the numbers.
      if (wasDisconnected) {
        this.analytics.playerRejoined(this.players.length, matchedBy === "name" ? "name" : "id");
      }
      this.onPlayerReturned(returningPlayer, {
        previousConnectionId,
        wasDisconnected,
        matchedBy,
      });
      this.resumeIfEnoughPlayersReturned();
      this.saveCheckpoint();
      this.invokeEvent(PresenterGameEvent.PlayerJoined, returningPlayer);
      return {
        didJoin: true,
        isRejoin: true,
        // Tell them the seat's permanent name, which is NOT the connection
        // they just arrived on.  Without this a reconnected phone would not
        // recognise itself in anything the host broadcasts.
        playerId: returningPlayer.playerId,
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
          // The seat's permanent name is the connection id it first arrived
          // on.  From here it never changes, no matter how many times the
          // phone reconnects - the token is what re-finds the seat.
          //
          // Deliberately NOT derived from playerToken: playerId travels in
          // every roster to every phone, while the token is the private
          // proof of who owns a seat.  Publishing a function of the token
          // would hand every player what they need to claim somebody's seat.
          const entry = this.createFreshPlayerEntry(message.playerName, sender);
          entry.playerId = sender;
          entry.playerToken = message.playerToken ?? "";
          entry.connectionId = sender;
          entry.isConnected = true;
          entry.lastSeenMs = Date.now();
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
          return { didJoin: true, isRejoin: false, playerId: entry.playerId };
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
  //  findSeat - look through everyone who holds a seat, connected or not,
  //  plus anyone the host booted (so they can be let back in).
  // -------------------------------------------------------------------
  private findSeat(match: (p: PlayerType) => boolean): PlayerType | undefined {
    return this.players.find(match) ?? this._exitedPlayers.find(match);
  }

  // -------------------------------------------------------------------
  //  playerByConnection / playerById
  // -------------------------------------------------------------------
  protected playerByConnection(connectionId: string): PlayerType | undefined {
    return this.players.find((p) => p.connectionId === connectionId) as unknown as PlayerType;
  }
  public playerById(playerId: string): PlayerType | undefined {
    return this.players.find((p) => p.playerId === playerId) as unknown as PlayerType;
  }

  // Everyone we can actually reach right now.
  public get connectedPlayers(): PlayerType[] {
    return this.players.filter((p) => p.isConnected) as unknown as PlayerType[];
  }

  // -------------------------------------------------------------------
  //  handlePlayerQuitMessage
  //
  //  A Quit only reaches us when a client tears itself down cleanly, which
  //  a phone going into a tunnel never does.  Rather than have two kinds of
  //  "gone" that behave differently, both land in the same place: the seat
  //  is HELD and the player shows as disconnected.  A host who actually
  //  wants the seat back calls bootPlayer().
  // -------------------------------------------------------------------
  handlePlayerQuitMessage = (sender: string, message: any) => {
    if (this.gameState === GeneralGameState.Destroyed) return;
    Logger.info("received quit message from " + sender);
    this.telemetryLogger.logEvent("Presenter", "QuitRequest");
    const player = this.playerById(sender);
    if (player) {
      this.analytics.playerQuit(Math.max(0, this.players.length - 1));
      this.markDisconnected(player);
    }
  };

  // -------------------------------------------------------------------
  //  markDisconnected - the player keeps their seat and every scrap of
  //  their state.  They are expected back.
  // -------------------------------------------------------------------
  private markDisconnected(player: PlayerType) {
    if (!player.isConnected) return;
    Logger.info(`Player disconnected: ${player.name}`);
    action(() => {
      player.isConnected = false;
    })();
    this.onPlayerDisconnected(player);

    if (
      this.pauseWhenTooFewPlayers &&
      this.connectedPlayers.length < this.minPlayers &&
      this.gameState !== PresenterGameState.Gathering
    ) {
      // Remember that WE paused it, so we know we are allowed to un-pause it
      // again.  A host who paused the game deliberately keeps it paused.
      this._pausedWaitingForPlayers = true;
      this.pauseGame();
    }
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  resumeIfEnoughPlayersReturned - the other half of the rule above.
  //  Without this a game that paused when somebody's phone slept stays
  //  paused after they come back, and the room has no idea why.
  // -------------------------------------------------------------------
  private resumeIfEnoughPlayersReturned() {
    if (!this._pausedWaitingForPlayers) return;
    if (this.connectedPlayers.length < this.minPlayers) return;
    this._pausedWaitingForPlayers = false;
    if (this.gameState === GeneralGameState.Paused) this.resumeGame();
  }

  // -------------------------------------------------------------------
  //  bootPlayer - the host removes somebody for good: a duplicate, a
  //  gatecrasher, or a phone that is never coming back and is holding up
  //  the game.  This is the ONLY way a seat is freed mid-game.
  // -------------------------------------------------------------------
  public bootPlayer(player: PlayerType) {
    if (!this.players.find((p) => p.playerId === player.playerId)) return;
    Logger.info(`Booting player: ${player.name}`);
    action(() => {
      this.players.remove(player);
      this._exitedPlayers.push(player);
    })();
    // Tell them, if we can still reach them, so their phone stops trying.
    if (player.isConnected) {
      this.sendToPlayer(TerminateGameEndpoint, player, {});
    }
    this.onPlayerExited(player);
    this.telemetryLogger.logEvent("Presenter", "BootPlayer");
    this.analytics.playerQuit(this.players.length);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  checkForDisconnectedPlayers - run off the tick.  Anyone we have not
  //  heard from in DISCONNECT_TIMEOUT_MS has dropped.
  // -------------------------------------------------------------------
  private checkForDisconnectedPlayers() {
    const now = Date.now();
    for (const player of this.players) {
      if (!player.isConnected || !player.lastSeenMs) continue;
      if (now - player.lastSeenMs > DISCONNECT_TIMEOUT_MS) {
        this.markDisconnected(player as unknown as PlayerType);
      }
    }
  }

  // -------------------------------------------------------------------
  //  run a method to check for a state transition
  // -------------------------------------------------------------------
  private manageState() {
    this.secondsLeftInStage = Math.max(
      0,
      Math.floor((this.timeOfStageEnd - this.gameTime_ms) / 1000),
    );
    this.checkForDisconnectedPlayers();
    this.handleTick();
  }

  // -------------------------------------------------------------------
  //  playAgain - reset the player list and start the game over
  // -------------------------------------------------------------------
  playAgain(resetPlayerList: boolean) {
    if (resetPlayerList) {
      this.players.clear();
    }

    // A fresh entry wipes the game's per-player fields, which is the point -
    // but identity and connection are not game state and must survive, or
    // every phone in the room is a stranger the moment you play again.
    const players = this.players.slice(0);
    this.players.clear();
    players.forEach((player) => {
      const entry = this.createFreshPlayerEntry(player.name, player.playerId);
      entry.playerId = player.playerId;
      entry.playerToken = player.playerToken;
      entry.connectionId = player.connectionId;
      entry.isConnected = player.isConnected;
      entry.lastSeenMs = player.lastSeenMs;
      entry.avatarId = player.avatarId;
      entry.avatarColor = player.avatarColor;
      this.players.push(entry);
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
    // Pausing an already-paused game must NOT record "Paused" as the state to
    // go back to, or the game can never be resumed again.  This happens for
    // real: a second player drops while the first is still away.
    if (this.gameState !== GeneralGameState.Paused) {
      this._stateBeforePause = this.gameState;
    }
    this.gameState = GeneralGameState.Paused;
    this.requestEveryone(PauseGameEndpoint, (p, exited) => ({}));
    this.isPaused = true;
  };

  // -------------------------------------------------------------------
  //  handle a ping message from the player
  // -------------------------------------------------------------------
  // The keepalive itself does nothing here: listenToEndpoint has already
  // stamped lastSeenMs for whoever sent it, which is the whole point of the
  // ping.  This just answers so the phone can measure the round trip.
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
              player.connectionId,
              request,
            );
            return promise;
          } else {
            return Promise.resolve(undefined);
          }
        }
      };

    // Only ask people we can actually reach.  A disconnected player would
    // never answer, and this is awaited - one sleeping phone would other-
    // wise hang the whole round.  They re-sync when they come back.
    return Promise.all(this.connectedPlayers.map(sendToPlayer(false)));
  }

  // -------------------------------------------------------------------
  //  sendToPlayer - fire-and-forget to one player.  Silently does nothing
  //  if they are not currently reachable; they will pull fresh state when
  //  they return, which is what requestGameStateFromPresenter is for.
  // -------------------------------------------------------------------
  sendToPlayer<MESSAGE>(
    endpoint: MessageEndpoint<MESSAGE, void>,
    player: PlayerType,
    message: MESSAGE,
  ): void {
    if (!player.isConnected || !player.connectionId) return;
    if (player.connectionId === this.session.personalId) return;
    this.session.sendMessage(endpoint, player.connectionId, message);
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
        if (player.connectionId !== this.session.personalId) {
          const request = generateRequest(player, isExited);
          if (request) {
            this.session.sendMessage(endpoint, player.connectionId, request);
          }
        }
      };

    // Skip anyone we cannot reach - the message would go nowhere, and they
    // rebuild their state on return anyway.
    this.connectedPlayers.forEach(sendToPlayer(false));
  }
}
