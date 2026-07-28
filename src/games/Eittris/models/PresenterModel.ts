import { makeObservable, observable } from "mobx";
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
  EittrisBoardSnapshot,
  EittrisCommandEndpoint,
  EittrisCommandMessage,
  EittrisOnboardClientEndpoint,
  EittrisOnboardClientMessage,
  EittrisBoardUpdateEndpoint,
  EittrisSpecialEventEndpoint,
  EittrisThumbnailEntry,
  EittrisThumbnailsEndpoint,
} from "./eittrisEndpoints";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  collides,
  dragTowards,
  DROP_POINTS_PER_ROW,
  EittrisBoard,
  encodeGrid,
  encodeThumbnail,
  gravityStep,
  hardDrop,
  initTargetRing,
  isResting,
  lockAndClear,
  makeBoard,
  NEXT_PREVIEW_COUNT,
  pieceCells,
  rankBoards,
  retargetOnDeath,
  slamHorizontal,
  spawnNextFromQueue,
  tryMove,
  tryRotateCW,
  ANTIDOTE_CHANCE,
  ANTIDOTE_DURATION_MS,
  ANTIDOTE_MAX,
  cureAfflictions,
  effectiveIntervalMs,
  isOffensive,
  collectAndShiftMarkers,
  pickSpecialCell,
  rollSpecialType,
  SPECIAL_INTERVAL_MS,
  SpecialType,
  EittrisPiece,
  liftPieceClear,
  stencilCellFor,
  stencilShapeFor,
  paintStencilRow,
  STENCIL_ROW_MS,
  hasAfflictions,
  nextAiMove,
  planPlacement,
} from "./eittrisLogic";
import { AI_MOVE_INTERVAL_MS, SPAWN_DELAY_MS, THUMBNAIL_INTERVAL_MS } from "./GameSettings";

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
  // prepareFreshGame
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
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
    this.boards.replace(
      this.players.map((player) => {
        const board = makeBoard(player.playerId, rand);
        board.aiControlled = player.aiControlled;
        board.forcedSpecial = player.forcedSpecial;
        if (board.forcedSpecial !== null) board.specialTimerMs = 0;
        return board;
      }),
    );
    initTargetRing(this.boards);
    this.winnerId = null;
    this.winnerName = null;
    this.deathCount = 0;
    this.currentRound = 0;
  };

  // -------------------------------------------------------------------
  // startNextRound - increment 1 has a single continuous round
  // -------------------------------------------------------------------
  startNextRound = () => {
    this.currentRound++;
    this._lastSimTime_ms = -1;
    this._lastThumbTime_ms = -1;
    this._thumbsChanged = true; // seed everyone's target list right away
    if (this.gameState !== EittrisGameState.Playing) {
      this.gameState = EittrisGameState.Playing;
    }
    this.invokeEvent(EittrisGameEvent.GameStarted);
    // Make every phone onboard so it learns its fresh board
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

    for (const board of this.boards) {
      this.simulateBoard(board, dtMs);
    }
    this.flushDirtyBoards();
    this.maybeBroadcastThumbnails();
  }

  // -------------------------------------------------------------------
  // simulateBoard - gravity acceleration + due gravity steps for one board.
  // -------------------------------------------------------------------
  private simulateBoard(board: EittrisBoard, dtMs: number) {
    if (!board.alive) return;

    this.tickSpecials(board, dtMs);
    this.tickStencil(board, dtMs);
    this.tickAi(board, dtMs);

    // The board is in the post-lock gap: nothing falls, and no command can
    // touch anything, until the next piece appears.
    if (!board.piece) {
      if (board.spawnDelayMs > 0) {
        board.spawnDelayMs -= dtMs;
        if (board.spawnDelayMs <= 0) {
          board.spawnDelayMs = 0;
          this.spawnNextPiece(board);
        }
      }
      return;
    }

    board.intervalMs = gravityStep(board.intervalMs, dtMs / 1000);
    board.dropTimerMs += dtMs;
    for (;;) {
      // Afflictions (Speedup) squeeze the natural curve without changing it
      const interval = effectiveIntervalMs(board.intervalMs, board.speedupStacks);
      if (board.dropTimerMs < interval || !board.alive || !board.piece) break;
      board.dropTimerMs -= interval;
      const moved = tryMove(board.grid, board.piece, 0, 1);
      if (moved) {
        board.piece = moved;
      } else {
        // No lock delay: a gravity step that collides locks immediately
        this.lockCurrentPiece(board, EittrisGameEvent.PieceLocked);
      }
      this.dirtyPlayerIds.add(board.playerId);
    }
  }

  // -------------------------------------------------------------------
  // tickSpecials - age the markers, run down an antidote shield, and tag a
  // fresh settled block every SPECIAL_INTERVAL_MS.  With a dev-forced type
  // the tag appears as soon as there is a block to put it on.
  // -------------------------------------------------------------------
  private tickSpecials(board: EittrisBoard, dtMs: number) {
    if (board.shieldMs > 0) {
      board.shieldMs = Math.max(0, board.shieldMs - dtMs);
      if (board.shieldMs === 0) this.dirtyPlayerIds.add(board.playerId);
    }

    // Only ever one special on the board: while it waits to be cleared,
    // the timer holds and nothing new appears
    if (board.specials.length > 0) return;

    board.specialTimerMs -= dtMs;
    if (board.specialTimerMs > 0) return;

    const rand = () => this.randomDouble(1.0);
    const index = pickSpecialCell(board.grid, board.specials, rand);
    if (index === null) {
      // Nothing settled to tag yet - try again next tick (a forced special
      // should land the instant the player has a block)
      board.specialTimerMs = board.forcedSpecial === null ? SPECIAL_INTERVAL_MS : 0;
      return;
    }
    const type = board.forcedSpecial ?? rollSpecialType(rand, ANTIDOTE_CHANCE);
    board.specials.push({ index, type });
    board.specialTimerMs = SPECIAL_INTERVAL_MS;
    this.dirtyPlayerIds.add(board.playerId);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // tickStencil - paint an incoming attack into the board one row at a
  // time (the original's ShapeDraw cadence), from the bottom up.
  // -------------------------------------------------------------------
  private tickStencil(board: EittrisBoard, dtMs: number) {
    const pending = board.pendingStencil;
    if (!pending) return;

    pending.timerMs -= dtMs;
    if (pending.timerMs > 0) return;
    pending.timerMs = STENCIL_ROW_MS;

    board.grid = paintStencilRow(
      board.grid,
      pending.shape,
      pending.row,
      pending.reverse,
      pending.blockCell,
    );
    pending.row++;
    if (pending.row >= pending.shape.length) board.pendingStencil = null;

    // Being buried can leave the falling piece inside solid blocks
    if (board.piece) {
      const lifted = liftPieceClear(board.grid, board.piece);
      if (lifted) {
        board.piece = lifted;
      } else {
        this.killBoard(board); // buried with nowhere to go
      }
    }
    this.dirtyPlayerIds.add(board.playerId);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // killBoard - this board is done; retarget anyone aiming at it
  // -------------------------------------------------------------------
  private killBoard(board: EittrisBoard) {
    if (!board.alive) return;
    board.piece = null;
    board.alive = false;
    board.pendingStencil = null;
    board.deathOrder = ++this.deathCount;
    for (const changedId of retargetOnDeath(this.boards.slice(), board.playerId)) {
      this.dirtyPlayerIds.add(changedId);
    }
    this.invokeEvent(EittrisGameEvent.PlayerDied, board.playerId);
    this.dirtyPlayerIds.add(board.playerId);
    this.checkForGameEnd();
  }

  // -------------------------------------------------------------------
  // tickAi - the computer player.  It only rotates and steps sideways (two
  // moves a second), lining the piece up so gravity drops it where the
  // planner wants.  It also knows to pop an antidote when afflicted.
  // -------------------------------------------------------------------
  private tickAi(board: EittrisBoard, dtMs: number) {
    if (!board.aiControlled) return;
    board.aiTimerMs -= dtMs;
    if (board.aiTimerMs > 0) return;
    board.aiTimerMs = AI_MOVE_INTERVAL_MS;

    // Cure first - playing well while afflicted is a losing game
    if (hasAfflictions(board) && board.antidotes > 0) {
      this.useAntidote(board);
      return;
    }

    if (!board.piece) return; // nothing to steer during the spawn gap
    const plan = planPlacement(board.grid, board.piece);
    if (!plan) return;

    const move = nextAiMove(board.piece, plan);
    if (move === null) return; // lined up - let gravity finish

    let moved: EittrisPiece | null = null;
    if (move === "rotate") moved = tryRotateCW(board.grid, board.piece);
    else moved = tryMove(board.grid, board.piece, move === "left" ? -1 : 1, 0);

    if (moved) {
      board.piece = moved;
      this.dirtyPlayerIds.add(board.playerId);
    }
  }

  // -------------------------------------------------------------------
  // collectSpecial - a marked block was cleared: bank or apply its effect
  // -------------------------------------------------------------------
  private collectSpecial(board: EittrisBoard, type: SpecialType) {
    this.invokeEvent(EittrisGameEvent.SpecialCollected, board.playerId, type);

    if (!isOffensive(type)) {
      // Defensive specials are kept by the collector
      if (type === SpecialType.Antidote) {
        board.antidotes = Math.min(ANTIDOTE_MAX, board.antidotes + 1);
        this.dirtyPlayerIds.add(board.playerId);
      } else {
        Logger.info(`Collected unimplemented special: ${SpecialType[type]}`);
      }
      return;
    }
    this.fireAtTarget(board, type);
  }

  // -------------------------------------------------------------------
  // fireAtTarget - send an offensive special at this board's target.  An
  // antidote shield on the victim turns it away harmlessly.
  // -------------------------------------------------------------------
  private fireAtTarget(board: EittrisBoard, type: SpecialType) {
    const victim = this.boards.find((b) => b.playerId === board.targetId && b.alive);
    if (!victim) return; // nobody to hit (solo game, or the target died)

    const repelled = victim.shieldMs > 0;
    if (!repelled) {
      switch (type) {
        case SpecialType.Speedup:
          victim.speedupStacks++;
          break;
        case SpecialType.TheWall:
        case SpecialType.Escalator:
        case SpecialType.Shackle:
        case SpecialType.TowerOfEit: {
          // Every shape-painting attack goes through the same machinery
          const shape = stencilShapeFor(type, () => this.randomDouble(1.0));
          if (!shape) return;
          victim.pendingStencil = {
            shape,
            row: 0,
            reverse: this.randomDouble(1.0) < 0.5,
            timerMs: 0,
            blockCell: stencilCellFor(type),
          };
          break;
        }
        default:
          Logger.warn(`Unhandled offensive special: ${SpecialType[type]}`);
          return;
      }
    }

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

  private nameFor(playerId: string): string {
    return this.players.find((p) => p.playerId === playerId)?.name ?? "?";
  }

  // -------------------------------------------------------------------
  // lockCurrentPiece - lock + clear + score, then spawn the next piece.
  // A fresh spawn that immediately collides kills the board (and every
  // board targeting it re-aims at the next living player).
  // -------------------------------------------------------------------
  private lockCurrentPiece(
    board: EittrisBoard,
    lockEvent: EittrisGameEvent.PieceLocked | EittrisGameEvent.PieceBumped,
  ) {
    const result = lockAndClear(board.grid, board.piece!);
    board.grid = result.grid;
    board.score += result.scoreGained;
    board.rows += result.cleared;

    // Cleared rows hand over any specials sitting on them; markers above
    // ride down with their blocks
    const harvest = collectAndShiftMarkers(board.specials, result.clearedRows);
    board.specials = harvest.markers;
    for (const type of harvest.collected) this.collectSpecial(board, type);
    this.invokeEvent(lockEvent, board.playerId);
    if (result.cleared > 0) {
      this.invokeEvent(EittrisGameEvent.RowsCleared, board.playerId, result.cleared);
    }

    // Open the no-piece gap.  The next piece appears SPAWN_DELAY_MS later,
    // which gives any in-flight gesture nothing to act on (see DESIGN.md).
    board.piece = null;
    board.dropTimerMs = 0;
    board.spawnDelayMs = SPAWN_DELAY_MS;
    board.pieceSeq++; // phones end any in-flight gesture on this piece

    this.dirtyPlayerIds.add(board.playerId);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // spawnNextPiece - the gap expired: bring in the next piece.  A spawn
  // that immediately collides kills the board (and every board targeting
  // it re-aims at the next living player).
  // -------------------------------------------------------------------
  private spawnNextPiece(board: EittrisBoard) {
    const spawned = spawnNextFromQueue(board.nextQueue, () => this.randomDouble(1.0));
    board.nextQueue = spawned.queue;
    board.dropTimerMs = 0;
    board.pieceSeq++;
    if (collides(board.grid, pieceCells(spawned.piece))) {
      board.piece = null;
      board.alive = false;
      board.deathOrder = ++this.deathCount;
      for (const changedId of retargetOnDeath(this.boards.slice(), board.playerId)) {
        this.dirtyPlayerIds.add(changedId);
      }
      this.invokeEvent(EittrisGameEvent.PlayerDied, board.playerId);
    } else {
      board.piece = spawned.piece;
    }

    this.dirtyPlayerIds.add(board.playerId);
    this.saveCheckpoint();
    this.checkForGameEnd();
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
    this.winnerName = this.players.find((p) => p.playerId === this.winnerId)?.name ?? null;

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
  // useAntidote - spend a charge: cures everything on this board and repels
  // incoming attacks for ANTIDOTE_DURATION_MS (nothing to cure yet - the
  // offensive specials arrive in later increments)
  // -------------------------------------------------------------------
  private useAntidote(board: EittrisBoard) {
    if (board.antidotes <= 0) return;
    board.antidotes--;
    // Wash off everything already applied, then shield against new hits
    cureAfflictions(board);
    board.shieldMs = ANTIDOTE_DURATION_MS;
    this.dirtyPlayerIds.add(board.playerId);
    this.invokeEvent(EittrisGameEvent.AntidoteUsed, board.playerId);
    this.saveCheckpoint();
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
    if (message.command === "useAntidote") {
      this.useAntidote(board);
      return;
    }
    // Everything else needs a live piece.  During the spawn gap there is
    // none, so stray commands from a finished gesture simply evaporate.
    if (!board.piece) return;

    let changed = false;
    switch (message.command) {
      case "dragTo": {
        // Free 2D drag: toward the column AND down toward the row at once.
        // Drag contact NEVER locks - `release` (or natural gravity) does that.
        if (message.column === undefined) break;
        const targetX = Math.max(0, Math.min(BOARD_WIDTH - 1, Math.floor(message.column)));
        const targetY = Math.min(BOARD_HEIGHT - 1, Math.floor(message.row ?? board.piece.y));
        const dragged = dragTowards(board.grid, board.piece, targetX, targetY);
        changed = dragged.piece.x !== board.piece.x || dragged.piece.y !== board.piece.y;
        if (dragged.rowsDescended > 0) {
          board.score += dragged.rowsDescended * DROP_POINTS_PER_ROW;
          board.dropTimerMs = 0; // give the player a full beat before gravity locks it
        }
        board.piece = dragged.piece;
        break;
      }
      case "release": {
        // Pointer-up after a drag: lock only if the piece is resting;
        // an airborne piece just resumes normal gravity
        if (isResting(board.grid, board.piece)) {
          this.lockCurrentPiece(board, EittrisGameEvent.PieceLocked);
          changed = true;
        }
        break;
      }
      case "hardDrop": {
        const dropped = hardDrop(board.grid, board.piece);
        board.piece = dropped.piece;
        board.score += dropped.rowsDropped * DROP_POINTS_PER_ROW;
        this.lockCurrentPiece(board, EittrisGameEvent.PieceBumped);
        changed = true;
        break;
      }
      case "slamLeft":
      case "slamRight": {
        const dir = message.command === "slamLeft" ? -1 : 1;
        const slammed = slamHorizontal(board.grid, board.piece, dir);
        changed = slammed.x !== board.piece.x;
        board.piece = slammed;
        if (changed) this.invokeEvent(EittrisGameEvent.PieceBumped, board.playerId);
        break;
      }
      case "rotate": {
        const rotated = tryRotateCW(board.grid, board.piece);
        if (rotated) {
          board.piece = rotated;
          changed = true;
        }
        break;
      }
    }

    if (changed) this.dirtyPlayerIds.add(board.playerId);
  };

  // -------------------------------------------------------------------
  // flushDirtyBoards - push each changed board to ITS player only
  // -------------------------------------------------------------------
  private flushDirtyBoards() {
    if (this.dirtyPlayerIds.size === 0) return;
    const dirty = this.dirtyPlayerIds;
    this.dirtyPlayerIds = new Set<string>();
    this._thumbsChanged = true;
    this.sendToEveryone(EittrisBoardUpdateEndpoint, (player) =>
      dirty.has(player.playerId) ? this.snapshotFor(player.playerId) : undefined,
    );
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

    const payload = {
      players: this.boards.map((board): EittrisThumbnailEntry => {
        const player = this.players.find((p) => p.playerId === board.playerId);
        return {
          playerId: board.playerId,
          name: player?.name ?? "?",
          avatarId: player?.avatarId ?? 0,
          avatarColor: player?.avatarColor ?? 0,
          alive: board.alive,
          thumb: encodeThumbnail(board.grid, board.piece),
        };
      }),
    };
    this.sendToEveryone(EittrisThumbnailsEndpoint, () => payload);
  }

  // -------------------------------------------------------------------
  // snapshotFor - one player's compact board state for the wire
  // -------------------------------------------------------------------
  snapshotFor(playerId: string): EittrisBoardSnapshot | undefined {
    const board = this.boards.find((b) => b.playerId === playerId);
    if (!board) return undefined;
    return {
      grid: encodeGrid(board.grid),
      piece: board.piece ? { ...board.piece } : null,
      next: board.nextQueue.slice(0, NEXT_PREVIEW_COUNT),
      score: board.score,
      rows: board.rows,
      alive: board.alive,
      intervalMs: Math.round(effectiveIntervalMs(board.intervalMs, board.speedupStacks)),
      backgroundIndex: board.backgroundIndex,
      targetId: board.targetId,
      pieceSeq: board.pieceSeq,
      specials: board.specials.map((m) => ({ i: m.index, t: m.type })),
      antidotes: board.antidotes,
      speedupStacks: board.speedupStacks,
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
      board: this.snapshotFor(sender) ?? null,
      aiControlled: player?.aiControlled ?? false,
      forcedSpecial: player?.forcedSpecial ?? null,
      winnerName: this.winnerName,
      youWon: this.winnerId !== null && this.winnerId === sender,
    };
  };
}
