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
} from "./eittrisLogic";
import { THUMBNAIL_INTERVAL_MS } from "./GameSettings";

export class EittrisPlayer extends ClusterFunPlayer {}

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
    this.boards.replace(this.players.map((player) => makeBoard(player.playerId, rand)));
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
    if (!board.alive || !board.piece) return;

    board.intervalMs = gravityStep(board.intervalMs, dtMs / 1000);
    board.dropTimerMs += dtMs;
    for (;;) {
      if (board.dropTimerMs < board.intervalMs || !board.alive || !board.piece) break;
      board.dropTimerMs -= board.intervalMs;
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
    this.invokeEvent(lockEvent, board.playerId);
    if (result.cleared > 0) {
      this.invokeEvent(EittrisGameEvent.RowsCleared, board.playerId, result.cleared);
    }

    const spawned = spawnNextFromQueue(board.nextQueue, () => this.randomDouble(1.0));
    board.nextQueue = spawned.queue;
    board.dropTimerMs = 0;
    board.pieceSeq++; // phones end any in-flight gesture on this piece
    if (collides(board.grid, pieceCells(spawned.piece))) {
      board.piece = null;
      board.alive = false;
      board.deathOrder = ++this.deathCount;
      // Everyone aiming at the dead board re-targets; their phones need to know
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
  handleCommand = (sender: string, message: EittrisCommandMessage): void => {
    if (this.gameState !== EittrisGameState.Playing) return;
    const board = this.boards.find((b) => b.playerId === sender);
    if (!board || !board.alive || !board.piece) return;

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
      case "pickTarget": {
        const target = this.boards.find((b) => b.playerId === message.targetId);
        if (target && target.alive && target.playerId !== sender) {
          board.targetId = target.playerId;
          changed = true;
          this.saveCheckpoint();
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
      intervalMs: Math.round(board.intervalMs),
      backgroundIndex: board.backgroundIndex,
      targetId: board.targetId,
      pieceSeq: board.pieceSeq,
    };
  }

  // -------------------------------------------------------------------
  // handleOnboardClient - full own-board state for one player's phone
  // -------------------------------------------------------------------
  handleOnboardClient = (sender: string, message: unknown): EittrisOnboardClientMessage => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    return {
      gameState: this.gameState,
      board: this.snapshotFor(sender) ?? null,
      winnerName: this.winnerName,
      youWon: this.winnerId !== null && this.winnerId === sender,
    };
  };
}
