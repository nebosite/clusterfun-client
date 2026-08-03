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
import { OneOhOneGameState } from "./PresenterModel";
import { WIN_POSITION, bustLimitFor } from "./oneOhOneLogic";
import {
  OneOhOneMoveSummary,
  OneOhOneOnboardClientEndpoint,
  OneOhOneRoundPhase,
  OneOhOneRoundResultEndpoint,
  OneOhOneRoundResultMessage,
  OneOhOneRoundStartEndpoint,
  OneOhOneRoundStartMessage,
  OneOhOneSetGuessEndpoint,
  PieceSnapshot,
} from "./oneOhOneEndpoints";

// -------------------------------------------------------------------
// Type helper for save/restore
// -------------------------------------------------------------------
export const getOneOhOneClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "OneOhOneClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case OneOhOneClientModel:
          return "OneOhOneClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "OneOhOneClientModel":
          return new OneOhOneClientModel(
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
      switch (propertyName) {
        case "myPieces":
          return observable(rehydratedObject as PieceSnapshot[]);
        case "allResults":
          return observable(rehydratedObject as OneOhOneMoveSummary[]);
        case "winnerIds":
        case "winnerNames":
          return observable(rehydratedObject as string[]);
      }
      return rehydratedObject;
    },
  };
};

export enum OneOhOneClientState {
  Playing = "Playing",
}

// -------------------------------------------------------------------
// Client data and logic - the phone is a thin controller: it shows the
// player's pieces and sends picks; the presenter owns the race.
// -------------------------------------------------------------------
export class OneOhOneClientModel extends ClusterfunClientModel {
  myPieces = observable<PieceSnapshot>([]);
  // Every piece's move from the last resolved round (with names) - shown on
  // the phone so players can follow along without the big screen
  allResults = observable<OneOhOneMoveSummary>([]);
  winnerIds = observable<string>([]);
  winnerNames = observable<string>([]);
  // How far the track runs this game - the host picks it, so nothing on the phone may
  // assume the game's namesake 101.
  @observable winPosition = WIN_POSITION;
  get bustLimit() {
    return bustLimitFor(this.winPosition);
  }

  @observable phase: OneOhOneRoundPhase = OneOhOneRoundPhase.Collecting;
  @observable secondsLeft = 0;

  // gameTime_ms value when the current pick phase ends
  private _pickDeadline_ms = 0;

  // Did one of MY pieces win?
  get iWon(): boolean {
    return this.myPieces.some((p) => this.winnerIds.includes(p.pieceId));
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("OneOhOneClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire up presenter push listeners + the countdown ticker
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(OneOhOneRoundStartEndpoint, this.handleRoundStart);
    this.listenToEndpointFromPresenter(OneOhOneRoundResultEndpoint, this.handleRoundResult);

    this.onTick.subscribe("pick countdown", () => {
      const remaining =
        this.phase === OneOhOneRoundPhase.Collecting
          ? Math.max(0, Math.ceil((this._pickDeadline_ms - this.gameTime_ms) / 1000))
          : 0;
      if (remaining !== this.secondsLeft) {
        action(() => (this.secondsLeft = remaining))();
      }
    });
  }

  // -------------------------------------------------------------------
  // requestGameStateFromPresenter - full rebuild from the onboard response
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const response = await this.session.requestPresenter(OneOhOneOnboardClientEndpoint, {});
    this.roundNumber = response.roundNumber;
    this.winPosition = response.winPosition ?? WIN_POSITION;
    this.phase = response.phase;
    this._pickDeadline_ms = this.gameTime_ms + response.secondsLeft * 1000;
    this.myPieces.replace(response.myPieces);
    this.allResults.replace(response.lastResults);
    this.winnerIds.replace(response.winnerIds);
    this.winnerNames.replace(response.winnerNames);

    switch (response.gameState) {
      case OneOhOneGameState.Playing:
        this.gameState = OneOhOneClientState.Playing;
        break;
      case GeneralGameState.GameOver:
        this.gameState = GeneralGameState.GameOver;
        break;
      default:
        Logger.debug(`Presenter is in state: ${response.gameState}`);
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
    }
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleRoundStart - a new collecting phase opened
  // -------------------------------------------------------------------
  protected handleRoundStart = (message: OneOhOneRoundStartMessage) => {
    this.roundNumber = message.roundNumber;
    this.phase = OneOhOneRoundPhase.Collecting;
    this._pickDeadline_ms = this.gameTime_ms + message.secondsAllowed * 1000;
    this.myPieces.forEach((p) => {
      p.guess = null;
      p.confirmed = false;
    });
    if (this.gameState === GeneralClientGameState.WaitingToStart) {
      this.gameState = OneOhOneClientState.Playing;
    }
    // Safety net: if we somehow don't know our pieces yet (missed the round-1
    // invalidate), rebuild from the presenter
    if (this.myPieces.length === 0) {
      this.requestGameStateFromPresenter();
    }
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // handleRoundResult - apply my pieces' moves and keep everyone's summary
  // (the presenter also sends the standard GameOver request after the reveal).
  // -------------------------------------------------------------------
  protected handleRoundResult = (message: OneOhOneRoundResultMessage) => {
    this.phase = OneOhOneRoundPhase.Reveal;
    this.myPieces.forEach((piece) => {
      const result = message.results.find((r) => r.pieceId === piece.pieceId);
      if (result) {
        piece.position = result.newPosition;
        piece.lastMove = result;
      }
    });
    this.allResults.replace(message.results);
    this.winnerIds.replace(message.winnerIds);
    this.winnerNames.replace(message.winnerNames);
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // selectGuess - pick (or change) a number for one of my pieces.
  // Unconfirmed picks still count if the round timer runs out.
  // -------------------------------------------------------------------
  async selectGuess(pieceId: string, guess: number): Promise<void> {
    const piece = this.myPieces.find((p) => p.pieceId === pieceId);
    if (!piece || piece.confirmed) return;

    const response = await this.session.requestPresenter(OneOhOneSetGuessEndpoint, {
      pieceId,
      guess,
      confirmed: false,
    });
    if (response.accepted) {
      piece.guess = guess;
      this.saveCheckpoint();
    } else {
      Logger.info(`Guess rejected: ${response.reason}`);
    }
  }

  // -------------------------------------------------------------------
  // confirmGuess - lock this piece's pick in.  The round resolves once
  // every human piece is confirmed.
  // -------------------------------------------------------------------
  async confirmGuess(pieceId: string): Promise<void> {
    const piece = this.myPieces.find((p) => p.pieceId === pieceId);
    // `== null` catches undefined too - see the note in PresenterModel's
    // resolveCurrentRound about nulls lost in older checkpoints.
    // eslint-disable-next-line eqeqeq
    if (!piece || piece.confirmed || piece.guess == null) return;

    const response = await this.session.requestPresenter(OneOhOneSetGuessEndpoint, {
      pieceId,
      guess: piece.guess,
      confirmed: true,
    });
    if (response.accepted) {
      piece.confirmed = true;
      this.saveCheckpoint();
    } else {
      Logger.info(`Confirm rejected: ${response.reason}`);
    }
  }
}
