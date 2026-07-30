import Logger from "js-logger";
import {
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  GeneralGameState,
  ITypeHelper,
  SafeBrowser,
} from "libs";
import { action, makeObservable, observable } from "mobx";
import { EittrisGameState } from "./PresenterModel";
import {
  EittrisBoardSnapshot,
  EittrisBoardUpdateEndpoint,
  EittrisCommandEndpoint,
  EittrisCommandMessage,
  EittrisOnboardClientEndpoint,
  EittrisSpecialEventEndpoint,
  EittrisSpecialEventMessage,
  EittrisThumbnailEntry,
  EittrisThumbnailsEndpoint,
  EittrisThumbnailsMessage,
} from "./eittrisEndpoints";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EittrisPiece,
  encodeGrid,
  emptyGrid,
  START_INTERVAL_MS,
} from "./eittrisLogic";

// -------------------------------------------------------------------
// Type helper for save/restore
// -------------------------------------------------------------------
export const getEittrisClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "EittrisClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case EittrisClientModel:
          return "EittrisClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "EittrisClientModel":
          return new EittrisClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      // The event banner is a momentary flash - checkpointing it made it
      // reappear after a refresh and linger into the next game
      if (propertyName === "lastSpecialEvent") return false;
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

export enum EittrisClientState {
  Playing = "Playing",
  Dead = "Dead", // own board topped out; spectating it until the round ends
}

// -------------------------------------------------------------------
// Client data and logic - the phone is a thin controller: it mirrors its
// own board from presenter pushes and translates gestures into commands.
// NO game rules live here.
// -------------------------------------------------------------------
export class EittrisClientModel extends ClusterfunClientModel {
  @observable gridString: string = encodeGrid(emptyGrid());
  @observable piece: EittrisPiece | null = null;
  @observable nextTypes: number[] = [];
  @observable score = 0;
  @observable rows = 0;
  @observable alive = true;
  @observable intervalMs = START_INTERVAL_MS;
  @observable backgroundIndex = 0;
  // Bumped by the presenter on every spawn - the gesture tracker watches it
  // so a gesture can't carry over onto the next piece
  @observable pieceSeq = 0;
  @observable targetId: string | null = null;
  // Specials on my settled blocks, my banked antidotes, and my shield timer
  @observable specials: { i: number; t: number }[] = [];
  @observable antidotes = 0;
  @observable speedupStacks = 0;
  @observable slowdownStacks = 0;
  @observable seeShadows = false;
  @observable crystalBall = false;
  @observable evilPieces = false;
  @observable crazyIvan = false;
  @observable freezeDried = false;
  @observable transparency = false;
  // Milliseconds left on each affliction, in AFFLICTION_TIMERS order
  @observable afflictionMs: number[] = [];
  // A row clear in progress on my board (see BoardGrid)
  @observable clearing: {
    rows: number[];
    elapsedMs: number;
    eatMs: number;
    fallMs: number;
  } | null = null;
  @observable psychoSeed = 0;
  @observable psychoOverlay: string | null = null;
  @observable shieldMs = 0;
  @observable forcedSpecial: number | null = null;
  @observable aiControlled = false;
  // The most recent special that fired anywhere, for a brief phone banner
  @observable lastSpecialEvent: EittrisSpecialEventMessage | null = null;
  @observable winnerName: string | null = null;
  @observable youWon = false;

  // The latest 1-bit snapshot of every board (for the target list)
  @observable roster: EittrisThumbnailEntry[] = [];

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("EittrisClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire up the presenter's board pushes
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(EittrisBoardUpdateEndpoint, this.handleBoardUpdate);
    this.listenToEndpointFromPresenter(EittrisThumbnailsEndpoint, this.handleThumbnails);
    this.listenToEndpointFromPresenter(EittrisSpecialEventEndpoint, this.handleSpecialEvent);
  }

  // -------------------------------------------------------------------
  // requestGameStateFromPresenter - full rebuild from the onboard response
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    // A rejected join still triggers this (framework behavior) - keep the
    // join-error screen instead of adopting a board we don't have
    if (this.gameState === GeneralClientGameState.JoinError) return;

    const response = await this.session.requestPresenter(EittrisOnboardClientEndpoint, {});
    action(() => {
      if (this.gameState === GeneralClientGameState.JoinError) return;
      // A resync means a new game/round or a rejoin - drop any stale banner
      this.lastSpecialEvent = null;
      if (response.board) this.applySnapshot(response.board);
      this.winnerName = response.winnerName;
      this.youWon = response.youWon;
      // Dev prefs come from the player, so they survive the pre-game wait
      this.aiControlled = response.aiControlled;
      this.forcedSpecial = response.forcedSpecial;

      switch (response.gameState) {
        case EittrisGameState.Playing:
          if (response.board) {
            this.gameState = this.alive ? EittrisClientState.Playing : EittrisClientState.Dead;
          } else {
            // Round in progress but we have no board (join was refused
            // mid-game) - wait for the next round rather than showing a
            // zombie empty board
            this.gameState = GeneralClientGameState.WaitingToStart;
          }
          break;
        case GeneralGameState.GameOver:
          this.gameState = GeneralGameState.GameOver;
          break;
        default:
          Logger.debug(`Presenter is in state: ${response.gameState}`);
          this.gameState = GeneralClientGameState.WaitingToStart;
          break;
      }
    })();
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleGameOverMessage - the base class only flips the state; re-fetch
  // from the presenter so winnerName/youWon arrive without a refresh
  // -------------------------------------------------------------------
  handleGameOverMessage = (message: unknown) => {
    this.gameState = GeneralGameState.GameOver;
    this.requestGameStateFromPresenter();
    this.saveCheckpoint();
    return {};
  };

  // -------------------------------------------------------------------
  // handleBoardUpdate - the presenter pushed this phone's own board
  // -------------------------------------------------------------------
  protected handleBoardUpdate = (message: EittrisBoardSnapshot) => {
    action(() => {
      this.applySnapshot(message);
      if (this.gameState === GeneralClientGameState.WaitingToStart) {
        this.gameState = this.alive ? EittrisClientState.Playing : EittrisClientState.Dead;
      } else if (this.gameState === EittrisClientState.Playing && !this.alive) {
        this.gameState = EittrisClientState.Dead;
      }
    })();
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // handleThumbnails - the shared everyone's-boards snapshot for the
  // target list (arrives ~1/s while boards change)
  // -------------------------------------------------------------------
  protected handleThumbnails = (message: EittrisThumbnailsMessage) => {
    action(() => {
      this.roster = message.players.slice();
    })();
  };

  // -------------------------------------------------------------------
  // handleSpecialEvent - somebody's special fired; flash it briefly
  // -------------------------------------------------------------------
  protected handleSpecialEvent = (message: EittrisSpecialEventMessage) => {
    // Only what happened TO ME.  Two other players trading powerups across the
    // room is noise on a phone the size of a playing card, and it crowds out
    // the one message that actually needs acting on.
    if (message.victimId !== this.playerId) return;
    action(() => (this.lastSpecialEvent = message))();
    const mine = message.attackerId === this.playerId || message.victimId === this.playerId;
    if (mine) SafeBrowser.vibrate([40, 40, 40]);
    setTimeout(
      () =>
        action(() => {
          if (this.lastSpecialEvent === message) this.lastSpecialEvent = null;
        })(),
      3000,
    );
  };

  // A banner announcing a hit on me is meaningless once I'm cured
  private clearStaleBanner() {
    const event = this.lastSpecialEvent;
    if (!event) return;
    if (event.victimId === this.playerId && !event.repelled && !this.isAfflicted) {
      this.lastSpecialEvent = null;
    }
  }

  get isAfflicted(): boolean {
    return this.speedupStacks > 0;
  }

  private applySnapshot(snapshot: EittrisBoardSnapshot) {
    this.gridString = snapshot.grid;
    this.piece = snapshot.piece;
    this.nextTypes = snapshot.next.slice();
    this.score = snapshot.score;
    this.rows = snapshot.rows;
    this.alive = snapshot.alive;
    this.intervalMs = snapshot.intervalMs;
    this.backgroundIndex = snapshot.backgroundIndex;
    this.specials = snapshot.specials ?? [];
    this.antidotes = snapshot.antidotes ?? 0;
    this.speedupStacks = snapshot.speedupStacks ?? 0;
    this.slowdownStacks = snapshot.slowdownStacks ?? 0;
    this.seeShadows = snapshot.seeShadows ?? false;
    this.crystalBall = snapshot.crystalBall ?? false;
    this.evilPieces = snapshot.evilPieces ?? false;
    this.crazyIvan = snapshot.crazyIvan ?? false;
    this.freezeDried = snapshot.freezeDried ?? false;
    this.transparency = snapshot.transparency ?? false;
    this.afflictionMs = (snapshot.afflictionMs ?? []).slice();
    this.clearing = snapshot.clearing ?? null;
    this.psychoSeed = snapshot.psychoSeed ?? 0;
    this.psychoOverlay = snapshot.psychoOverlay ?? null;
    this.shieldMs = snapshot.shieldMs ?? 0;
    this.forcedSpecial = snapshot.forcedSpecial ?? null;
    this.aiControlled = snapshot.aiControlled ?? false;
    this.clearStaleBanner();
    this.pieceSeq = snapshot.pieceSeq;
    this.targetId = snapshot.targetId;
  }

  // -------------------------------------------------------------------
  // Gesture commands - fire-and-forget; the presenter is authoritative
  // -------------------------------------------------------------------
  private sendCommand(message: EittrisCommandMessage) {
    if (this.gameState !== EittrisClientState.Playing) return;
    this.session.sendMessageToPresenter(EittrisCommandEndpoint, message);
  }

  // Free 2D drag: aim the piece at a board cell (never up; presenter clamps)
  dragTo(column: number, row: number) {
    this.sendCommand({
      command: "dragTo",
      column: Math.max(0, Math.min(BOARD_WIDTH - 1, Math.round(column))),
      row: Math.max(0, Math.min(BOARD_HEIGHT - 1, Math.round(row))),
    });
  }

  // Pointer-up after a drag: locks only if the piece is resting
  release() {
    this.sendCommand({ command: "release" });
  }

  hardDrop() {
    this.sendCommand({ command: "hardDrop" });
  }

  slamLeft() {
    this.sendCommand({ command: "slamLeft" });
  }

  slamRight() {
    this.sendCommand({ command: "slamRight" });
  }

  rotate() {
    this.sendCommand({ command: "rotate" });
  }

  // A double tap lands the piece the way a downward flick would - the
  // presenter takes back the first tap's rotation before dropping it.
  doubleTapDrop() {
    this.sendCommand({ command: "doubleTapDrop" });
  }

  // -------------------------------------------------------------------
  // Keyboard / controller actions.  One cell at a time, unlike the phone's
  // gestures, which are absolute drags and full-width slams.
  // -------------------------------------------------------------------
  moveLeft() {
    this.sendCommand({ command: "moveLeft" });
  }

  moveRight() {
    this.sendCommand({ command: "moveRight" });
  }

  moveDown() {
    this.sendCommand({ command: "moveDown" });
  }

  rotateLeft() {
    this.sendCommand({ command: "rotateCCW" });
  }

  // -------------------------------------------------------------------
  // cycleTarget - step through the living opponents.  Wraps around, skips
  // yourself and anyone already out, and is a no-op in a solo game.
  // -------------------------------------------------------------------
  cycleTarget(step: 1 | -1) {
    const candidates = this.roster.filter((p) => p.playerId !== this.playerId && p.alive);
    if (candidates.length === 0) return;
    const current = candidates.findIndex((p) => p.playerId === this.targetId);
    // Not currently on a living opponent: start at either end of the list
    const nextIndex =
      current < 0
        ? step > 0
          ? 0
          : candidates.length - 1
        : (current + step + candidates.length) % candidates.length;
    this.pickTarget(candidates[nextIndex].playerId);
  }

  // Fire a banked antidote.  Uses the raw send so it works during the
  // post-lock spawn gap (sendCommand requires a live piece).
  useAntidote() {
    if (this.antidotes <= 0) return;
    this.session.sendMessageToPresenter(EittrisCommandEndpoint, { command: "useAntidote" });
  }

  // DEV ONLY: pin which special spawns (null = normal random play)
  setForcedSpecial(specialType: number | null) {
    action(() => (this.forcedSpecial = specialType))();
    this.session.sendMessageToPresenter(EittrisCommandEndpoint, {
      command: "setForcedSpecial",
      specialType,
    });
  }

  // DEV ONLY: fire the selected special as though it had just been cleared
  fireSelectedSpecial() {
    if (this.forcedSpecial === null) return;
    this.session.sendMessageToPresenter(EittrisCommandEndpoint, {
      command: "fireSpecial",
      specialType: this.forcedSpecial,
    });
  }

  // DEV ONLY: hand this board to the computer player
  setAiControlled(aiControlled: boolean) {
    action(() => (this.aiControlled = aiControlled))();
    this.session.sendMessageToPresenter(EittrisCommandEndpoint, {
      command: "setAiControlled",
      aiControlled,
    });
  }

  pickTarget(targetId: string) {
    if (targetId === this.playerId) return;
    this.sendCommand({ command: "pickTarget", targetId });
  }

  // Handy for the view: board dimensions without importing logic there
  get boardWidth() {
    return BOARD_WIDTH;
  }
  get boardHeight() {
    return BOARD_HEIGHT;
  }
}
