import { action, makeObservable, observable } from "mobx";
import { LetterBlockModel } from "./LetterBlockModel";
import { LetterGridModel } from "./LetterGridModel";
import { chainActionFor } from "./dragSelection";
import { LexibleGameEvent } from "./PresenterModel";
import {
  ISessionHelper,
  ClusterFunGameProps,
  Vector2,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  ITypeHelper,
} from "libs";
import Logger from "js-logger";
import { applyHomeConnections } from "./teamAreas";
import {
  LexibleBoardUpdateEndpoint,
  LexibleBoardUpdateNotification,
  LexibleEndOfRoundMessage,
  LexibleEndRoundEndpoint,
  LexibleOnboardClientEndpoint,
  LexibleRecentlyTouchedLettersMessage,
  LexibleReportTouchLetterEndpoint,
  LexibleRequestWordHintsEndpoint,
  LexibleServerRecentlyTouchedLettersEndpoint,
  LexibleSubmitWordEndpoint,
  LexibleSwitchTeamEndpoint,
  LexibleWordSubmissionRequest,
  PlayBoard,
} from "./lexibleEndpoints";

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getLexibleClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "LexibleClientModel",
    getTypeName(o) {
      switch (o.constructor) {
        case LetterGridModel:
          return "LetterGridModel";
        case LetterBlockModel:
          return "LetterBlockModel";
        case Vector2:
          return "Vector2";
        case LexibleClientModel:
          return "LexibleClientModel";
        default:
          return undefined;
      }
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "LetterGridModel":
          return new LetterGridModel();
        case "LetterBlockModel":
          return new LetterBlockModel("_");
        case "Vector2":
          return new Vector2(0, 0);
        case "LexibleClientModel":
          return new LexibleClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      switch (propertyName) {
        case "__blockid":
        // Transient animation state.  The names must be the PRIVATE fields: the
        // serializer walks real properties, so "failFade" (the getter) never
        // matched and a checkpoint taken mid-flash restored a tile stuck red
        // with no animator left running to clear it.
        case "_failFade":
        case "_captureSeq":
          return false;
      }

      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      switch (propertyName) {
        case "selectMap":
          return observable(rehydratedObject as string[]);
        case "letterChain":
          return observable(rehydratedObject as LetterBlockModel[]);
      }

      return rehydratedObject;
    },
  };
};

export enum LexibleClientState {
  Playing = "Playing",
  EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class LexibleClientModel extends ClusterfunClientModel {
  @observable theGrid = new LetterGridModel();
  @observable letterChain = observable(new Array<LetterBlockModel>());

  @observable private _myTeam = "_";
  get myTeam() {
    return this._myTeam;
  }
  set myTeam(value) {
    action(() => {
      this._myTeam = value;
    })();
  }

  @observable private _winningTeam = "";
  get winningTeam() {
    return this._winningTeam;
  }
  set winningTeam(value) {
    action(() => {
      this._winningTeam = value;
    })();
  }

  @observable private _wordList = [] as string[];
  get wordList() {
    const prefix = this.activeWord;
    return this._wordList.filter((w) => w.startsWith(prefix));
  }
  set wordList(value) {
    action(() => {
      this._wordList = value;
    })();
  }

  get activeWord() {
    let output = "";
    this.letterChain.forEach((b) => (output += b.letter.toUpperCase()));
    return output;
  }

  startFromTeamArea = true;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("LexibleClient", sessionHelper, playerName, logger, storage);

    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(
      LexibleServerRecentlyTouchedLettersEndpoint,
      this.handleRecentlyTouchedMessage,
    );
    this.listenToEndpointFromPresenter(LexibleEndRoundEndpoint, this.handleEndOfRoundMessage);
    this.listenToEndpointFromPresenter(LexibleBoardUpdateEndpoint, this.handleBoardUpdateMessage);
    this.theGrid.processBlocks((b) => this.setBlockHandlers(b));
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const onboardState = await this.session.requestPresenter(LexibleOnboardClientEndpoint, {});
    if (onboardState.gameState === "Gathering") {
      this.gameState = GeneralClientGameState.WaitingToStart;
    } else {
      this.gameState = onboardState.gameState;
    }
    if (this.gameState === GeneralClientGameState.WaitingToStart) {
      this.telemetryLogger.logEvent("Client", "Start");
    }
    this.roundNumber = onboardState.roundNumber;
    this.myTeam = onboardState.teamName;
    this.startFromTeamArea = onboardState.settings.startFromTeamArea;

    this.setupPlayBoard(onboardState.playBoard);

    this.saveCheckpoint();
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  toggleSelect(block: LetterBlockModel, playerId: string) {
    let selectable = true;
    let isSelected = block.isSelectedByPlayer(playerId);
    if (!isSelected) {
      if (!this.canStartWordAt(block)) {
        selectable = false;
      }
    }

    if (selectable) {
      block.selectForPlayer(playerId, !isSelected);
    }
  }

  // -------------------------------------------------------------------
  //  canStartWordAt - may a word BEGIN on this letter?
  //
  //  With "words must start from team territory" on, only your own tiles will
  //  do.  This is also what decides, on touch-down, whether a drag spells a
  //  word or scrolls the board - see dragSelection.ts.
  // -------------------------------------------------------------------
  canStartWordAt(block: LetterBlockModel): boolean {
    if (this.letterChain.length > 0) return true;
    if (!this.startFromTeamArea) return true;
    return block.team === this.myTeam;
  }

  // -------------------------------------------------------------------
  //  canDragFrom - would starting a drag on this letter DO anything?
  //
  //  This is what decides spell-vs-scroll on touch-down, and it is not the
  //  same question as canStartWordAt.  Once a word is in progress
  //  canStartWordAt is true for every letter on the board, so using it here
  //  meant that after one drag EVERY press was captured for spelling and the
  //  board could not be scrolled again until the word was submitted.
  //
  //  A press only spells if it would actually extend or retract the word.
  //  Anything else belongs to the scroller.
  // -------------------------------------------------------------------
  canDragFrom(block: LetterBlockModel): boolean {
    const chain = this.letterChain.map((l) => l.coordinates);
    const action = chainActionFor(chain, block.coordinates, this.canStartWordAt(block));
    return action.kind !== "none";
  }

  // -------------------------------------------------------------------
  //  dragSelectTo - the finger has moved onto this letter mid-drag.
  //
  //  Adds it, or takes the last one off if the finger has retraced.  Doing
  //  nothing is a perfectly normal outcome - a finger crosses plenty of
  //  letters it is not allowed to reach.
  // -------------------------------------------------------------------
  dragSelectTo(block: LetterBlockModel, playerId: string) {
    const chain = this.letterChain.map((l) => l.coordinates);
    const action = chainActionFor(chain, block.coordinates, this.canStartWordAt(block));

    switch (action.kind) {
      case "start":
      case "extend":
        block.selectForPlayer(playerId, true);
        break;
      case "retract": {
        const last = this.letterChain[this.letterChain.length - 1];
        if (last) last.selectForPlayer(playerId, false);
        break;
      }
      case "none":
        break;
    }
  }

  // -------------------------------------------------------------------
  // submitWord
  // -------------------------------------------------------------------
  async submitWord() {
    if (this.letterChain.length === 0) {
      Logger.warn("WEIRD:  should have been letters in the letter chain");
      return;
    }

    const submissionData: LexibleWordSubmissionRequest = {
      letters: this.letterChain.map((l) => ({ letter: l.letter, coordinates: l.coordinates })),
    };

    const response = await this.session.requestPresenter(LexibleSubmitWordEndpoint, submissionData);
    if (response.success) {
      this.invokeEvent(LexibleGameEvent.WordAccepted);
    } else {
      response.letters.forEach((l) => {
        const block = this.theGrid.getBlock(l.coordinates);
        if (!block) {
          Logger.warn(`WEIRD: No block at ${JSON.stringify(l.coordinates)}`);
        } else block.fail();
      });
    }

    this.letterChain[0].selectForPlayer(this.playerId, false);
  }

  // -------------------------------------------------------------------
  //  updateHomeConnections - redraw the team outlines after the board moves.
  //
  //  The same call the presenter makes, so the phone in your hand and the
  //  screen the room is watching agree about where your chain is broken.
  //
  //  This replaced a copy of the presenter's A* "hot path" animation, which
  //  each phone ran on EVERY accepted word, glowing one tile per 50ms along a
  //  route that ran through unclaimed and enemy squares.
  // -------------------------------------------------------------------
  updateHomeConnections() {
    applyHomeConnections(this.theGrid);
  }

  protected handleBoardUpdateMessage = (message: LexibleBoardUpdateNotification) => {
    let capturedCount = 0;
    message.letters.forEach((l) => {
      const block = this.theGrid.getBlock(l.coordinates);
      if (!block) {
        Logger.warn(`WEIRD: No block at ${l.coordinates}`);
        return;
      }
      // The presenter sends every letter of the word, including tiles that did not
      // move.  The firework is only for tiles taken off the OTHER TEAM, which is
      // the same rule the presenter applies - so the phones and the big screen
      // celebrate the same moments.
      const stolen =
        block.team !== "_" && block.team !== message.scoringTeam && message.score > block.score;
      block.setScore(Math.max(message.score, block.score), message.scoringTeam);
      if (stolen) {
        block.capture();
        capturedCount++;
      }
    });
    this.updateHomeConnections();
    this.saveCheckpoint();
    if (capturedCount > 0) this.invokeEvent(LexibleGameEvent.TilesCaptured, capturedCount);
    this.invokeEvent(LexibleGameEvent.WordAccepted);
  };

  // -------------------------------------------------------------------
  // handleRecentlyTouchedMessage
  // -------------------------------------------------------------------
  protected handleRecentlyTouchedMessage = (message: LexibleRecentlyTouchedLettersMessage) => {
    message.letterCoordinates.forEach((c) => {
      const block = this.theGrid.getBlock(c);
      if (!block) {
        Logger.warn(`WEIRD: No block at ${JSON.stringify(c)}`);
      } else block.fail();
    });
  };

  // -------------------------------------------------------------------
  // handleEndOfRoundMessage
  // -------------------------------------------------------------------
  protected handleEndOfRoundMessage = (message: LexibleEndOfRoundMessage) => {
    this.winningTeam = message.winningTeam;
    this.gameState = LexibleClientState.EndOfRound;

    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // setBlockHandlers
  // -------------------------------------------------------------------
  setBlockHandlers(block: LetterBlockModel) {
    const isNextLetter = () => {
      if (this.letterChain.length > 0) {
        const previousBlock = this.letterChain[this.letterChain.length - 1];
        if (Math.abs(previousBlock.coordinates.x - block.coordinates.x) > 1) {
          return false;
        } else if (Math.abs(previousBlock.coordinates.y - block.coordinates.y) > 1) {
          return false;
        }
      }
      return true;
    };

    const deleteBlocksFromIndex = (index: number, playerId: string) => {
      if (index > -1) {
        const deletedBlocks = this.letterChain.splice(index);
        deletedBlocks.forEach((b) => b.selectForPlayer(playerId, false));
      }
    };

    block.onSelectedChanged = (playerId, selectedValue) => {
      let isFirst = false;
      action(() => {
        if (selectedValue) {
          if (this.letterChain.length === 0) {
            isFirst = true;
          } else if (!isNextLetter()) {
            deleteBlocksFromIndex(0, playerId);
            isFirst = true;
          }
          this.letterChain.push(block);
        } else {
          const index = this.letterChain.findIndex((b) => b.__blockid === block.__blockid);
          deleteBlocksFromIndex(index, playerId);

          if (this.letterChain.length === 0) this.wordList = [];
        }

        this.session.sendMessageToPresenter(LexibleReportTouchLetterEndpoint, {
          touchPoint: block.coordinates,
        });
        if (isFirst) {
          this.session
            .requestPresenter(LexibleRequestWordHintsEndpoint, {
              currentWord: this.letterChain.map((block) => ({
                letter: block.letter,
                coordinates: block.coordinates,
              })),
            })
            .then((hintResponse) => {
              action(() => {
                this.wordList = hintResponse.wordList;
              })();
              this.saveCheckpoint();
            });
        }
      })();
    };
  }

  // -------------------------------------------------------------------
  // setupPlayBoard
  // -------------------------------------------------------------------
  setupPlayBoard(playBoard: PlayBoard) {
    const newGrid = new LetterGridModel(playBoard.gridWidth, playBoard.gridHeight);
    newGrid.deserialize(playBoard.gridData);
    newGrid.processBlocks((b) => this.setBlockHandlers(b));
    action(() => {
      this.theGrid = newGrid;
    })();
  }

  // -------------------------------------------------------------------
  //
  // -------------------------------------------------------------------
  async requestSwitchTeam() {
    const response = await this.session.requestPresenter(LexibleSwitchTeamEndpoint, {
      desiredTeam: this.myTeam === "A" ? "B" : "A",
    });

    this.myTeam = response.currentTeam;
  }
}
