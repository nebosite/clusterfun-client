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
} from "libs";
import { action, makeObservable, observable } from "mobx";
import { EittrisGameState } from "./PresenterModel";
import {
  EittrisBoardSnapshot,
  EittrisBoardUpdateEndpoint,
  EittrisCommandEndpoint,
  EittrisCommandMessage,
  EittrisOnboardClientEndpoint,
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
      if (response.board) this.applySnapshot(response.board);
      this.winnerName = response.winnerName;
      this.youWon = response.youWon;

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

  private applySnapshot(snapshot: EittrisBoardSnapshot) {
    this.gridString = snapshot.grid;
    this.piece = snapshot.piece;
    this.nextTypes = snapshot.next.slice();
    this.score = snapshot.score;
    this.rows = snapshot.rows;
    this.alive = snapshot.alive;
    this.intervalMs = snapshot.intervalMs;
    this.backgroundIndex = snapshot.backgroundIndex;
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
