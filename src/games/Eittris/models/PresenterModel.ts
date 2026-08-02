import { action, makeObservable, observable, runInAction } from "mobx";
import {
  ClusterFunPlayer,
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunPresenterModel,
  ITelemetryLogger,
  IStorage,
  ITypeHelper,
  PresenterGameState,
  GeneralGameState,
} from "libs";
import Logger from "js-logger";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";
import {
  SimulationContext,
  SimulationEvents,
  applyCommand,
  applyIncomingSpecial,
  applyReportToBoard,
  spendAntidote,
  stepBoard,
} from "./eittrisSimulation";
import {
  EittrisBoardSnapshot,
  EittrisCommandEndpoint,
  EittrisCommandMessage,
  EittrisOnboardClientEndpoint,
  EittrisOnboardClientMessage,
  EittrisBoardUpdateEndpoint,
  EittrisBoardReportEndpoint,
  EittrisBoardReportMessage,
  EittrisDeliverSpecialEndpoint,
  EittrisStartPlayingEndpoint,
  EittrisSpecialEventEndpoint,
  EittrisThumbnailEntry,
  EittrisThumbnailsMessage,
  EittrisRosterEntry,
  EittrisThumbnailsEndpoint,
} from "./eittrisEndpoints";
import {
  EittrisBoard,
  encodeGrid,
  encodeThumbnail,
  initTargetRing,
  makeBoard,
  NEXT_PREVIEW_COUNT,
  CRYSTAL_BALL_PREVIEW,
  rankBoards,
  retargetOnDeath,
  effectiveIntervalMs,
  SpecialType,
  defaultSettings,
  sanitizeSettings,
  SPEED_CHOICES,
  EittrisSpeed,
  MAX_ROBOTS_STRESS,
  EittrisRobot,
  robotRoster,
  AFFLICTION_TIMERS,
  afflictionMsLeft,
  encodePsychoOverlay,
} from "./eittrisLogic";
import type { EittrisSettings } from "./eittrisLogic";
import { LATE_JOIN_GRACE_MS, THUMBNAIL_INTERVAL_MS, GRID_MIN_INTERVAL_MS } from "./GameSettings";

// In the Test Lobby every player is a bot by default so a game can be
// watched end to end without touching four phones.
const IS_DEV = process.env.REACT_APP_DEVMODE === "development";

export class EittrisPlayer extends ClusterFunPlayer {
  // Dev preferences, kept on the player so they survive the wait for the
  // game to start and every subsequent round (boards are rebuilt each game).
  // Plain fields: nothing renders them per-player, so no makeObservable needed.
  aiControlled: boolean = IS_DEV;
  forcedSpecial: SpecialType | null = null;
}

// -------------------------------------------------------------------
// The Game state
// -------------------------------------------------------------------
export enum EittrisGameState {
  Playing = "Playing",
}

// -------------------------------------------------------------------
// Game events (views subscribe for sounds)
// -------------------------------------------------------------------
export enum EittrisGameEvent {
  GameStarted = "GameStarted",
  PieceLocked = "PieceLocked", // a piece settled by gravity or drag-release (Dot)
  PieceBumped = "PieceBumped", // a slam or hard-drop landing (Bump)
  RowsCleared = "RowsCleared", // args: playerId, rows cleared (picks ClearNLines)
  SpecialCollected = "SpecialCollected", // args: playerId, SpecialType
  SpecialFired = "SpecialFired", // args: attackerId, victimId, type, repelled
  AntidoteUsed = "AntidoteUsed", // args: playerId
  QuakeStarted = "QuakeStarted", // args: playerId - the ground is moving
  AfflictionEnded = "AfflictionEnded", // args: playerId, SpecialType[] that lifted
  JumbleNudge = "JumbleNudge", // args: playerId - a block just skittered
  PlayerDied = "PlayerDied",
  WinnerAnnounced = "WinnerAnnounced",
}

// -------------------------------------------------------------------
// Type helper for save/restore
// -------------------------------------------------------------------
export const getEittrisPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "EittrisPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case EittrisPresenterModel:
          return "EittrisPresenterModel";
        case EittrisPlayer:
          return "EittrisPlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "EittrisPresenterModel":
          return new EittrisPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "EittrisPlayer":
          return new EittrisPlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (typeName === "EittrisPresenterModel") {
        switch (propertyName) {
          // Per-tick bookkeeping - rebuilt fresh after a restore
          case "dirtyPlayerIds":
          case "_lastSimTime_ms":
          case "_lastThumbTime_ms":
          case "_thumbsChanged":
          case "_lastThumbs":
          case "_lastRosterKey":
          case "_lastGridSent":
          case "_gridPending":
          case "_gridUrgent":
            return false;
        }
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      if (typeName === "EittrisPresenterModel") {
        switch (propertyName) {
          case "boards":
            return observable(rehydratedObject as EittrisBoard[]);
        }
      }
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// presenter data and logic - the host is the source of truth for EVERY
// board: it runs gravity, collision, locking, clears, and scoring for
// all players on its tick.  Phones only send commands (see DESIGN.md).
// -------------------------------------------------------------------
export class EittrisPresenterModel extends ClusterfunPresenterModel<EittrisPlayer> {
  // One board per player, built at game start.  Plain serializable structs;
  // the observable array deep-observes them for the presenter view.
  boards = observable<EittrisBoard>([]);

  @observable winnerId: string | null = null;
  @observable winnerName: string | null = null;

  // How many robot players the host has asked for (0-4).  Robots are boards
  // the host simulates - deliberately NOT entries in `players`, because a
  // player id the relay has never heard of would be handed real network
  // messages by every broadcast.  Only their identity needs inventing, and
  // that is derived from the index, so nothing extra has to be serialized.
  // What the host chose on the gathering screen.  Plain data, so it rides the
  // checkpoint and survives a refresh mid-setup.
  @observable settings: EittrisSettings = defaultSettings();

  setSpeed(speed: EittrisSpeed) {
    if (!SPEED_CHOICES.includes(speed)) return;
    this.settings = sanitizeSettings({ ...this.settings, speed });
    this.saveCheckpoint();
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
  }

  setStartingAntidotes(count: number) {
    action(() => {
      this.settings = sanitizeSettings({ ...this.settings, startingAntidotes: count });
    })();
    this.saveCheckpoint();
  }

  setFourRowAward(type: SpecialType) {
    action(() => {
      this.settings = sanitizeSettings({ ...this.settings, fourRowAward: type });
    })();
    this.saveCheckpoint();
  }

  toggleAllowedSpecial(type: SpecialType) {
    action(() => {
      const on = this.settings.allowedSpecials.includes(type);
      const allowedSpecials = on
        ? this.settings.allowedSpecials.filter((t) => t !== type)
        : [...this.settings.allowedSpecials, type];
      this.settings = sanitizeSettings({ ...this.settings, allowedSpecials });
    })();
    this.saveCheckpoint();
  }

  isSpecialAllowed(type: SpecialType) {
    return this.settings.allowedSpecials.includes(type);
  }

  @observable robotCount = 0;
  setRobotCount(count: number) {
    action(() => {
      this.robotCount = Math.max(0, Math.min(MAX_ROBOTS_STRESS, Math.floor(count)));
    })();
    this.saveCheckpoint();
  }

  get robots(): EittrisRobot[] {
    return robotRoster(this.robotCount);
  }

  // Name and avatar for any board, human or robot
  identityFor(playerId: string): { name: string; avatarId: number; avatarColor: number } {
    const human = this.players.find((p) => p.playerId === playerId);
    if (human) {
      return { name: human.name, avatarId: human.avatarId, avatarColor: human.avatarColor };
    }
    const robot = this.robots.find((r) => r.playerId === playerId);
    if (robot)
      return { name: robot.name, avatarId: robot.avatarId, avatarColor: robot.avatarColor };
    return { name: "?", avatarId: 0, avatarColor: 0 };
  }

  // How many boards have died so far (for death-order ranking)
  deathCount = 0;

  // Boards that changed since the last flush - each gets a board-update push.
  // Per-tick bookkeeping, excluded from the checkpoint.
  private dirtyPlayerIds = new Set<string>();

  // gameTime_ms at the last simulation step (-1 = not started / just restored)
  private _lastSimTime_ms = -1;

  // Thumbnail broadcast throttle: last push time and whether anything changed
  private _lastThumbTime_ms = -1;
  private _thumbsChanged = false;
  // What each phone was last told each board looks like, so an unchanged board can be
  // left out.  Rebuilt after a restore, which just costs one full broadcast.
  private _lastThumbs = new Map<string, { thumb: string; alive: boolean }>();
  private _lastRosterKey = "";
  // What settled grid each phone was last sent, and when.  Rebuilt after a restore,
  // which costs one extra grid per player and nothing else.
  private _lastGridSent = new Map<string, { grid: string; atMs: number }>();
  private _gridPending = new Set<string>();
  // Boards whose grid must go out NOW, cap or no cap.  The row-clear animation runs off
  // its own clock on each phone against the grid it holds, so a grid that arrives late
  // makes the phone animate the wrong thing - the cleared row reappears during the fall
  // and then snaps away.  Correctness beats the byte budget for these.
  private _gridUrgent = new Set<string>();

  get aliveBoards(): EittrisBoard[] {
    return this.boards.filter((b) => b.alive);
  }

  get canStart() {
    return this.players.length >= this.minPlayers;
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("Eittris", sessionHelper, logger, storage);
    Logger.info(`Constructing EittrisPresenterModel ${this.gameState}`);

    // Boards are fixed at start, so new players may only join while gathering
    // (rejoin of existing players works automatically in any state)
    this.allowedJoinStates = [PresenterGameState.Gathering];

    this.minPlayers = 1; // solo boards are handy for testing the mechanics
    // Nobody else should have to sit and wait because one phone went flat.
    // A robot takes the empty seat instead - see onPlayerExited.
    this.pauseWhenTooFewPlayers = false;
    this.maxPlayers = 16;

    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire up listeners (runs fresh AND after restore)
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpoint(EittrisOnboardClientEndpoint, this.handleOnboardClient);
    this.listenToEndpoint(EittrisCommandEndpoint, this.handleCommand);
    this.listenToEndpoint(EittrisBoardReportEndpoint, this.handleBoardReport);
  }

  // -------------------------------------------------------------------
  // createFreshPlayerEntry
  // -------------------------------------------------------------------
  createFreshPlayerEntry(name: string, id: string): EittrisPlayer {
    const newPlayer = new EittrisPlayer();
    newPlayer.playerId = id;
    newPlayer.name = name;
    newPlayer.aiControlled = IS_DEV; // test mode: everyone is a bot by default
    return newPlayer;
  }

  // -------------------------------------------------------------------
  // onPlayerExited / onPlayerReturned - a phone went flat, or its owner
  // wandered off.  Rather than pausing everyone else, a robot picks up their
  // board and plays it until they come back.
  // -------------------------------------------------------------------
  // Somebody who tapped join as the host tapped start should get in, not be
  // told the room is closed.  Returning players are handled separately and are
  // always welcome back; this is only about brand new ones.
  protected allowsLateJoin(): boolean {
    if (this.gameState !== EittrisGameState.Playing) return false;
    if (!this._gameStartedAtMs) return false;
    return Date.now() - this._gameStartedAtMs <= LATE_JOIN_GRACE_MS;
  }

  protected onPlayerExited(player: EittrisPlayer) {
    const board = this.boards.find((b) => b.playerId === player.playerId);
    if (!board || !board.alive) return;
    // boards is a deep observable, so these belong in an action
    action(() => {
      board.robotTakeover = true;
      board.aiControlled = true;
      board.aiTimerMs = 0;
    })();
    this.dirtyPlayerIds.add(board.playerId);
    this.saveCheckpoint();
  }

  protected onPlayerReturned(player: EittrisPlayer, previousPlayerId: string) {
    // Boards are keyed by player id, and a reconnect arrives on a brand new
    // one - so the board has to be moved across, along with every other
    // board's aim at it.  Without this the player rejoins to a seat they
    // cannot reach: their commands find no board and nothing responds.
    const board =
      this.boards.find((b) => b.playerId === previousPlayerId) ??
      this.boards.find((b) => b.playerId === player.playerId);
    if (!board) return;

    action(() => {
      if (previousPlayerId !== player.playerId) {
        board.playerId = player.playerId;
        for (const other of this.boards) {
          if (other.targetId === previousPlayerId) other.targetId = player.playerId;
        }
        this.dirtyPlayerIds.add(player.playerId);
      }

      if (board.robotTakeover) {
        board.robotTakeover = false;
        // Back to whatever the player themselves had set, not simply "off"
        board.aiControlled = player.aiControlled;
      }
    })();
    this.dirtyPlayerIds.add(board.playerId);
    // Hand the board itself back.  From the moment they are a player again the host stops
    // simulating their board - so if the phone is not given one to run, nobody runs it and
    // the game sits frozen in front of them.
    this.handOverBoard(board);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handOverBoard - give a board to the phone that owns it, in whatever state it is in.
  //
  // Used whenever a board changes hands mid-game: somebody rejoining and taking their
  // seat back from a robot, or a late joiner picking up a board the host made for them.
  // -------------------------------------------------------------------
  private handOverBoard(board: EittrisBoard) {
    if (this.gameState !== EittrisGameState.Playing) return;
    this.sendToEveryone(EittrisStartPlayingEndpoint, (player) =>
      player.playerId === board.playerId
        ? {
            settings: this.settings,
            round: this.currentRound,
            targetId: board.targetId,
            // A copy, not the live object: what goes on the wire must not be something
            // the host is still mutating.
            board: JSON.parse(JSON.stringify(board)) as EittrisBoard,
          }
        : undefined,
    );
  }

  // -------------------------------------------------------------------
  // prepareFreshGame
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.boards.clear();
    this.winnerId = null;
    this.winnerName = null;
    this.deathCount = 0;
  };

  // -------------------------------------------------------------------
  // prepareFreshRound - build one board per player
  // -------------------------------------------------------------------
  prepareFreshRound = () => {
    const rand = () => this.randomDouble(1.0);
    const humanBoards = this.players.map((player) => {
      const board = makeBoard(player.playerId, rand, this.settings.speed);
      board.antidotes = this.settings.startingAntidotes;
      board.aiControlled = player.aiControlled;
      board.forcedSpecial = player.forcedSpecial;
      if (board.forcedSpecial !== null) board.specialTimerMs = 0;
      return board;
    });
    // Robots get a board each, always computer-driven.  They fill out a game
    // for one or two people without anyone else having to pick up a phone.
    const robotBoards = this.robots.map((robot) => {
      const board = makeBoard(robot.playerId, rand, this.settings.speed);
      board.antidotes = this.settings.startingAntidotes;
      board.aiControlled = true;
      return board;
    });
    this.boards.replace([...humanBoards, ...robotBoards]);
    initTargetRing(this.boards);
    this.winnerId = null;
    this.winnerName = null;
    this.deathCount = 0;
  };

  // -------------------------------------------------------------------
  // startNextRound - increment 1 has a single continuous round
  // -------------------------------------------------------------------
  startNextRound = () => {
    // The round number is the token a phone uses to tell "here is a new round, build a
    // board" from a stray repeat of the round it is already playing.  It therefore has to
    // keep counting UP for as long as this presenter lives: rewinding it to zero between
    // games meant the second game announced round 1 to phones that had just finished
    // round 1, so every phone decided it had already been told and carried on with its
    // finished board.  Nothing here counts rounds for the game's own sake.
    this.currentRound++;
    this._lastSimTime_ms = -1;
    this._lastThumbTime_ms = -1;
    this._thumbsChanged = true; // seed everyone's target list right away
    if (this.gameState !== EittrisGameState.Playing) {
      this.gameState = EittrisGameState.Playing;
    }
    this.invokeEvent(EittrisGameEvent.GameStarted);
    // Hand every phone its own board: here are the rules, off you go.  From this point a
    // player's board is simulated on their phone and the host only watches it.
    this.sendToEveryone(EittrisStartPlayingEndpoint, (player) => {
      const board = this.boards.find((b) => b.playerId === player.playerId);
      return {
        settings: this.settings,
        round: this.currentRound,
        targetId: board?.targetId ?? null,
      };
    });
    // Make every phone onboard so it learns the line-up
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // handleTick - simulate every live board with real elapsed time, then
  // push updates for the boards that changed
  // -------------------------------------------------------------------
  handleTick() {
    if (this.gameState !== EittrisGameState.Playing) return;

    if (this._lastSimTime_ms < 0 || this._lastSimTime_ms > this.gameTime_ms) {
      this._lastSimTime_ms = this.gameTime_ms; // fresh start or post-restore
    }
    const dtMs = this.gameTime_ms - this._lastSimTime_ms;
    this._lastSimTime_ms = this.gameTime_ms;
    if (dtMs <= 0) return;

    // Only the robots.  A player's board is simulated on their own phone and arrives
    // here as a report - the host is a viewer of it, not its author.
    for (const board of this.boards) {
      if (this.isOwnedByAPhone(board)) continue;
      stepBoard(board, dtMs, this.simContext);
    }
    this.flushDirtyBoards();
    this.maybeBroadcastThumbnails();
  }

  // -------------------------------------------------------------------
  // The simulation plumbing.  Every board the presenter runs itself is stepped by the
  // shared simulator - the same code a phone runs for its own board - so the two can
  // never drift apart on the rules.  What is left here is what only the host knows:
  // who else is playing, what a death means for the game, and how a powerup reaches
  // its victim.
  // -------------------------------------------------------------------
  private get simEvents(): SimulationEvents {
    return {
      changed: (board) => this.dirtyPlayerIds.add(board.playerId),
      locked: (board, bumped) => {
        this.invokeEvent(
          bumped ? EittrisGameEvent.PieceBumped : EittrisGameEvent.PieceLocked,
          board.playerId,
        );
        // A locked grid with its rows still standing has to reach the phone before the
        // phone starts eating them - it animates against the grid it holds.
        if (board.clearing) this._gridUrgent.add(board.playerId);
      },
      rowsCleared: (board, count) =>
        this.invokeEvent(EittrisGameEvent.RowsCleared, board.playerId, count),
      clearCollapsed: (board) => this._gridUrgent.add(board.playerId),
      specialCollected: (board, type) =>
        this.invokeEvent(EittrisGameEvent.SpecialCollected, board.playerId, type),
      fireSpecial: (board, type) => this.fireAtTarget(board, type),
      selfSpecial: (board, type) => this.announceSelfSpecial(board, type),
      afflictionEnded: (board, types) =>
        this.invokeEvent(EittrisGameEvent.AfflictionEnded, board.playerId, types),
      antidoteUsed: (board) => this.invokeEvent(EittrisGameEvent.AntidoteUsed, board.playerId),
      quakeStarted: (board) => this.invokeEvent(EittrisGameEvent.QuakeStarted, board.playerId),
      jumbleNudge: (board) => this.invokeEvent(EittrisGameEvent.JumbleNudge, board.playerId),
      slammed: (board) => this.invokeEvent(EittrisGameEvent.PieceBumped, board.playerId),
      died: (board) => this.onBoardDied(board),
      persist: () => this.saveCheckpoint(),
    };
  }

  private get simContext(): SimulationContext {
    return {
      settings: this.settings,
      random: () => this.randomDouble(1.0),
      boards: () => this.boards,
      devFast: this.devFast,
      events: this.simEvents,
    };
  }

  // -------------------------------------------------------------------
  // A board belongs to a phone if a real player is behind it.  Robots have nobody to
  // run them, so the host does.
  // -------------------------------------------------------------------
  private isOwnedByAPhone(board: EittrisBoard): boolean {
    return this.players.some((p) => p.playerId === board.playerId);
  }

  // -------------------------------------------------------------------
  // handleBoardReport - a phone's account of its own board.
  //
  // The host does not second-guess it.  It copies the board in so the shared screen is
  // right, plays the sounds for what happened, and passes any attack along to whoever
  // has to live with it.
  // -------------------------------------------------------------------
  handleBoardReport = (sender: string, message: EittrisBoardReportMessage): void => {
    if (this.gameState !== EittrisGameState.Playing) return;
    const board = this.boards.find((b) => b.playerId === sender);
    if (!board) return;

    // Remember this BEFORE the report lands: the snapshot carries alive=false, so by the
    // time the events below are read the board already looks dead and any test of
    // board.alive says nothing about whether the death has been dealt with yet.
    const wasAlive = board.alive;

    runInAction(() => applyReportToBoard(board, message.board));
    this.dirtyPlayerIds.add(sender);

    for (const event of message.events ?? []) {
      switch (event.kind) {
        case "locked":
          this.invokeEvent(
            event.bumped ? EittrisGameEvent.PieceBumped : EittrisGameEvent.PieceLocked,
            sender,
          );
          break;
        case "slammed":
          this.invokeEvent(EittrisGameEvent.PieceBumped, sender);
          break;
        case "rowsCleared":
          this.invokeEvent(EittrisGameEvent.RowsCleared, sender, event.count);
          break;
        case "collected":
          this.invokeEvent(EittrisGameEvent.SpecialCollected, sender, event.special);
          break;
        case "selfSpecial":
          this.announceSelfSpecial(board, event.special as SpecialType);
          break;
        case "fire":
          this.relayAttack(board, event.special as SpecialType, event.targetId);
          break;
        case "hit":
          // The victim has already applied it - this is the room being told.
          this.announceAttack(
            event.attackerId,
            sender,
            event.special as SpecialType,
            event.repelled,
          );
          break;
        case "afflictionEnded":
          this.invokeEvent(EittrisGameEvent.AfflictionEnded, sender, event.types ?? []);
          break;
        case "antidoteUsed":
          this.invokeEvent(EittrisGameEvent.AntidoteUsed, sender);
          break;
        case "jumbleNudge":
          this.invokeEvent(EittrisGameEvent.JumbleNudge, sender);
          break;
        case "died":
          // Nothing to do here - the death is noticed below, from the board itself.
          break;
      }
    }

    // A death is the one thing that must not depend on an event surviving the trip: it
    // ends the round.  The snapshot says so plainly, so take it from there and treat the
    // event as no more than a hint.  This is also the LAST thing done with the report,
    // because finishGame pushes the final boards out and announces a winner - anything
    // still queued behind it would arrive after the game was over.
    if (wasAlive && !board.alive) this.onBoardDied(board);

    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // relayAttack - a phone set off an offensive powerup.  Getting it to its victim is the
  // one thing a phone cannot do for itself: it cannot see anybody else's board.
  //
  // A robot victim is hit here and now.  A human victim is TOLD, and applies it the moment
  // it arrives - the host does not wait for permission or hold the attack up.
  // -------------------------------------------------------------------
  private relayAttack(attacker: EittrisBoard, type: SpecialType, targetId: string | null) {
    const victim = this.boards.find((b) => b.playerId === (targetId ?? attacker.targetId));
    if (!victim || !victim.alive) return; // nobody to hit (solo game, or the target died)

    if (!this.isOwnedByAPhone(victim)) {
      const repelled = applyIncomingSpecial(victim, type, this.simContext, attacker);
      this.dirtyPlayerIds.add(victim.playerId);
      this.announceAttack(attacker.playerId, victim.playerId, type, repelled);
      return;
    }

    // SwitchScreens trades two boards, so it has to be run where both are visible.
    if (type === SpecialType.SwitchScreens) {
      applyIncomingSpecial(victim, type, this.simContext, attacker);
      this.dirtyPlayerIds.add(victim.playerId);
    }

    this.sendToEveryone(EittrisDeliverSpecialEndpoint, (player) =>
      player.playerId === victim.playerId
        ? {
            special: type,
            attackerId: attacker.playerId,
            attackerName: this.nameFor(attacker.playerId),
          }
        : undefined,
    );
  }

  // Tell the room what just happened to whom.
  private announceAttack(
    attackerId: string,
    victimId: string,
    type: SpecialType,
    repelled: boolean,
  ) {
    this.invokeEvent(EittrisGameEvent.SpecialFired, attackerId, victimId, type, repelled);
    const payload = {
      type,
      attackerId,
      attackerName: this.nameFor(attackerId),
      victimId,
      victimName: this.nameFor(victimId),
      repelled,
    };
    this.sendToEveryone(EittrisSpecialEventEndpoint, () => payload);
  }

  // -------------------------------------------------------------------
  // onBoardDied - the simulator kills a board; what that death MEANS for the game is
  // the host's business: the order people went out in, re-aiming anyone who was
  // shooting at them, and whether that was the last one standing.
  // -------------------------------------------------------------------
  private onBoardDied(board: EittrisBoard) {
    board.deathOrder = ++this.deathCount;
    for (const changedId of retargetOnDeath(this.boards.slice(), board.playerId)) {
      this.dirtyPlayerIds.add(changedId);
    }
    this.invokeEvent(EittrisGameEvent.PlayerDied, board.playerId);
    this.dirtyPlayerIds.add(board.playerId);
    this.checkForGameEnd();
  }

  // -------------------------------------------------------------------
  // fireAtTarget - send an offensive special at this board's target.  An
  // antidote shield on the victim turns it away harmlessly.
  // -------------------------------------------------------------------
  private fireAtTarget(board: EittrisBoard, type: SpecialType) {
    const victim = this.boards.find((b) => b.playerId === board.targetId && b.alive);
    if (!victim) return; // nobody to hit (solo game, or the target died)

    // What the attack DOES is the simulator's business - the same code a phone runs when
    // an attack is delivered to it.  What is left here is only the part that needs the
    // room: telling everyone what just happened to whom.
    const repelled = applyIncomingSpecial(victim, type, this.simContext, board);

    this.dirtyPlayerIds.add(victim.playerId);
    this.invokeEvent(
      EittrisGameEvent.SpecialFired,
      board.playerId,
      victim.playerId,
      type,
      repelled,
    );
    const payload = {
      type,
      attackerId: board.playerId,
      attackerName: this.nameFor(board.playerId),
      victimId: victim.playerId,
      victimName: this.nameFor(victim.playerId),
      repelled,
    };
    this.sendToEveryone(EittrisSpecialEventEndpoint, () => payload);
    this.saveCheckpoint();
  }

  // Tell the room about a special somebody kept for themselves
  private announceSelfSpecial(board: EittrisBoard, type: SpecialType) {
    this.invokeEvent(EittrisGameEvent.SpecialFired, board.playerId, board.playerId, type, false);
    const payload = {
      type,
      attackerId: board.playerId,
      attackerName: this.nameFor(board.playerId),
      victimId: board.playerId,
      victimName: this.nameFor(board.playerId),
      repelled: false,
    };
    this.sendToEveryone(EittrisSpecialEventEndpoint, () => payload);
  }

  private nameFor(playerId: string): string {
    return this.identityFor(playerId).name;
  }

  // -------------------------------------------------------------------
  // checkForGameEnd - last player standing wins (solo boards play to death)
  // -------------------------------------------------------------------
  private checkForGameEnd() {
    if (this.gameState !== EittrisGameState.Playing) return;
    const aliveCount = this.aliveBoards.length;
    const soloGame = this.boards.length <= 1;
    if ((soloGame && aliveCount === 0) || (!soloGame && aliveCount <= 1)) {
      this.finishGame();
    }
  }

  // -------------------------------------------------------------------
  // finishGame
  // -------------------------------------------------------------------
  private finishGame() {
    const ranked = rankBoards(this.boards.slice());
    const winnerBoard = ranked[0];
    this.winnerId = winnerBoard?.playerId ?? null;
    this.winnerName = this.winnerId ? this.identityFor(this.winnerId).name : null;

    // Push the final board state to everyone before announcing the end
    this.flushDirtyBoards();
    this.gameState = GeneralGameState.GameOver;
    this.invokeEvent(EittrisGameEvent.WinnerAnnounced, this.winnerName);
    this.requestEveryone(GameOverEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleCommand - apply a phone gesture to the sender's board.  All
  // rule decisions delegate to the pure logic module.
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // useAntidote - spend a charge.  The rules live in the simulator; the host only
  // needs to know that the board changed.
  // -------------------------------------------------------------------
  private useAntidote(board: EittrisBoard) {
    spendAntidote(board, this.simContext);
  }

  // -------------------------------------------------------------------
  // applyPickTarget - aim this board at another living player.  Returns
  // whether anything changed.
  // -------------------------------------------------------------------
  private applyPickTarget(board: EittrisBoard, targetId: string): boolean {
    const target = this.boards.find((b) => b.playerId === targetId);
    if (!target || !target.alive || target.playerId === board.playerId) return false;
    board.targetId = target.playerId;
    this.saveCheckpoint();
    return true;
  }

  handleCommand = (sender: string, message: EittrisCommandMessage): void => {
    // Dev preferences are stored on the player, so they work in ANY state -
    // including while gathering, before a board exists
    const player = this.players.find((p) => p.playerId === sender);
    const isDevPreference =
      message.command === "setAiControlled" || message.command === "setForcedSpecial";
    if (!isDevPreference && this.gameState !== EittrisGameState.Playing) return;
    if (message.command === "setAiControlled") {
      const on = !!message.aiControlled;
      if (player) player.aiControlled = on;
      const myBoard = this.boards.find((b) => b.playerId === sender);
      if (myBoard) {
        myBoard.aiControlled = on;
        myBoard.aiTimerMs = 0;
        this.dirtyPlayerIds.add(sender);
      }
      this.saveCheckpoint();
      return;
    }
    if (message.command === "setForcedSpecial") {
      const wanted = message.specialType;
      const value = wanted === undefined || wanted === null ? null : (wanted as SpecialType);
      if (player) player.forcedSpecial = value;
      const myBoard = this.boards.find((b) => b.playerId === sender);
      if (myBoard) {
        myBoard.forcedSpecial = value;
        if (value !== null) myBoard.specialTimerMs = 0;
        this.dirtyPlayerIds.add(sender);
      }
      this.saveCheckpoint();
      return;
    }

    const board = this.boards.find((b) => b.playerId === sender);
    if (!board || !board.alive) return;

    // These don't touch the falling piece, so they work even in the
    // post-lock gap
    if (message.command === "pickTarget") {
      if (message.targetId !== undefined && this.applyPickTarget(board, message.targetId)) {
        this.dirtyPlayerIds.add(board.playerId);
      }
      return;
    }
    // Everything that only touches this one board is the simulator's job - the same code
    // a phone runs on its own board, with no round trip in the way.
    applyCommand(board, message, this.simContext);
  };

  // -------------------------------------------------------------------
  // flushDirtyBoards - push each changed board to ITS player only
  // -------------------------------------------------------------------
  private flushDirtyBoards() {
    // A grid change held back by the rate cap goes out as soon as the cap allows, even
    // if nothing else about that board has changed since - otherwise a board that goes
    // quiet right after an attack would sit there showing the old stack.
    for (const playerId of this._gridPending) {
      const last = this._lastGridSent.get(playerId);
      if (!last || this.gameTime_ms - last.atMs >= GRID_MIN_INTERVAL_MS) {
        this.dirtyPlayerIds.add(playerId);
      }
    }
    if (this.dirtyPlayerIds.size === 0) return;
    const dirty = this.dirtyPlayerIds;
    this.dirtyPlayerIds = new Set<string>();
    this._thumbsChanged = true;
    // Only to phones that do NOT own their board.  Pushing a board back at the phone that
    // is simulating it would be the host arguing with the authority - a stale mirror
    // overwriting a live game.  In practice that means nobody once a game is running, and
    // it stays here for the states where the host still owns everything.
    this.sendToEveryone(EittrisBoardUpdateEndpoint, (player) => {
      if (!dirty.has(player.playerId)) return undefined;
      const board = this.boards.find((b) => b.playerId === player.playerId);
      if (board && this.isOwnedByAPhone(board) && this.gameState === EittrisGameState.Playing) {
        return undefined;
      }
      return this.snapshotFor(player.playerId);
    });
  }

  // -------------------------------------------------------------------
  // maybeBroadcastThumbnails - every ~THUMBNAIL_INTERVAL_MS, if anything
  // changed, push ONE shared 1-bit snapshot of every board to everyone
  // (the phones' target lists)
  // -------------------------------------------------------------------
  private maybeBroadcastThumbnails() {
    if (!this._thumbsChanged) return;
    if (
      this._lastThumbTime_ms >= 0 &&
      this.gameTime_ms - this._lastThumbTime_ms < THUMBNAIL_INTERVAL_MS
    ) {
      return;
    }
    this._lastThumbTime_ms = this.gameTime_ms;
    this._thumbsChanged = false;

    // Identity first: names, avatars and ids never change mid-game, so they go out
    // when the line-up does and not once a second forever.
    const roster: EittrisRosterEntry[] = this.boards.map((board) => {
      const who = this.identityFor(board.playerId);
      return {
        playerId: board.playerId,
        name: who.name,
        avatarId: who.avatarId,
        avatarColor: who.avatarColor,
      };
    });
    const rosterKey = roster.map((r) => `${r.playerId}:${r.name}:${r.avatarId}`).join("|");
    const rosterChanged = rosterKey !== this._lastRosterKey;

    // Then only the boards that actually look different.  With the falling piece out
    // of the thumbnail, a board that is merely dropping a piece has nothing to say.
    const boards: EittrisThumbnailEntry[] = [];
    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      const thumb = encodeThumbnail(board.grid);
      const previous = this._lastThumbs.get(board.playerId);
      if (
        !rosterChanged &&
        previous &&
        previous.thumb === thumb &&
        previous.alive === board.alive
      ) {
        continue;
      }
      this._lastThumbs.set(board.playerId, { thumb, alive: board.alive });
      boards.push({ i, alive: board.alive, thumb });
    }
    if (!rosterChanged && boards.length === 0) return; // nothing to say at all

    this._lastRosterKey = rosterKey;
    const payload: EittrisThumbnailsMessage = rosterChanged ? { roster, boards } : { boards };
    this.sendToEveryone(EittrisThumbnailsEndpoint, () => payload);
  }

  // The line-up, for the onboard response - a phone that joins or reconnects
  // mid-game needs it before the index-based thumbnail broadcasts mean anything.
  rosterSnapshot(): EittrisRosterEntry[] {
    return this.boards.map((board) => {
      const who = this.identityFor(board.playerId);
      return {
        playerId: board.playerId,
        name: who.name,
        avatarId: who.avatarId,
        avatarColor: who.avatarColor,
      };
    });
  }

  // -------------------------------------------------------------------
  // gridForWire - the settled grid, but only when it is worth the bytes.
  //
  // It is by far the biggest field in a snapshot and by far the least likely to have
  // changed: most updates are the falling piece moving a row.  So it goes out only when
  // it differs from what this phone was last told, and never more often than
  // GRID_MIN_INTERVAL_MS.  A change suppressed by that cap is remembered and sent the
  // moment the cap expires - see flushDirtyBoards - so a board can never be left
  // showing a stale stack.
  // -------------------------------------------------------------------
  private gridForWire(board: EittrisBoard, force: boolean): string | undefined {
    const grid = encodeGrid(board.grid);
    const last = this._lastGridSent.get(board.playerId);
    const changed = !last || last.grid !== grid;
    if (!changed) {
      this._gridPending.delete(board.playerId);
      this._gridUrgent.delete(board.playerId);
      return undefined;
    }
    const urgent = this._gridUrgent.delete(board.playerId);
    const cooledDown = !last || this.gameTime_ms - last.atMs >= GRID_MIN_INTERVAL_MS;
    if (!force && !urgent && !cooledDown) {
      this._gridPending.add(board.playerId);
      return undefined;
    }
    this._gridPending.delete(board.playerId);
    this._lastGridSent.set(board.playerId, { grid, atMs: this.gameTime_ms });
    return grid;
  }

  // -------------------------------------------------------------------
  // snapshotFor - one player's compact board state for the wire
  // -------------------------------------------------------------------
  snapshotFor(playerId: string, opts?: { forceGrid?: boolean }): EittrisBoardSnapshot | undefined {
    const board = this.boards.find((b) => b.playerId === playerId);
    if (!board) return undefined;
    return {
      grid: this.gridForWire(board, opts?.forceGrid ?? false),
      piece: board.piece ? { ...board.piece } : null,
      next: board.nextQueue.slice(0, board.crystalBall ? CRYSTAL_BALL_PREVIEW : NEXT_PREVIEW_COUNT),
      rows: board.rows,
      alive: board.alive,
      intervalMs: Math.round(
        effectiveIntervalMs(board.intervalMs, board.speedupStacks, board.slowdownStacks),
      ),
      backgroundIndex: board.backgroundIndex,
      targetId: board.targetId,
      pieceSeq: board.pieceSeq,
      specials: board.specials.map((m) => ({ i: m.index, t: m.type })),
      antidotes: board.antidotes,
      earthquakes: board.earthquakes,
      quakeMs: Math.round(board.quakeMs),
      speedupStacks: board.speedupStacks,
      slowdownStacks: board.slowdownStacks,
      seeShadows: board.seeShadows,
      seeShadowsMs: Math.round(board.seeShadowsMs),
      crystalBall: board.crystalBall,
      evilPieces: board.evilPieces,
      crazyIvan: board.crazyIvan,
      freezeDried: board.freezeDried,
      transparency: board.transparency,
      clearing: board.clearing ? { ...board.clearing, rows: board.clearing.rows.slice() } : null,
      psychoSeed: board.psychoSeed,
      afflictionMs: AFFLICTION_TIMERS.map((spec) =>
        Math.max(0, Math.round(afflictionMsLeft(board, spec.type))),
      ),
      psychoOverlay: board.psychoOverlay ? encodePsychoOverlay(board.psychoOverlay) : null,
      shieldMs: Math.round(board.shieldMs),
      forcedSpecial: board.forcedSpecial,
      aiControlled: board.aiControlled,
    };
  }

  // -------------------------------------------------------------------
  // handleOnboardClient - full own-board state for one player's phone
  // -------------------------------------------------------------------
  handleOnboardClient = (sender: string, message: unknown): EittrisOnboardClientMessage => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    const player = this.players.find((p) => p.playerId === sender);
    return {
      gameState: this.gameState,
      roster: this.rosterSnapshot(),
      board: this.snapshotFor(sender, { forceGrid: true }) ?? null,
      aiControlled: player?.aiControlled ?? false,
      forcedSpecial: player?.forcedSpecial ?? null,
      winnerName: this.winnerName,
      youWon: this.winnerId !== null && this.winnerId === sender,
    };
  };
}
