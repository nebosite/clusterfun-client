import { action, makeObservable, observable } from "mobx";

import { PLAYTIME_MS } from "./GameSettings";
import { LetterBlockModel } from "./LetterBlockModel";
import { WordTree } from "./WordTree";
import { LetterGridModel } from "./LetterGridModel";
import { TEAM_HOME_SCORE, connectedToLeftEdge, homeCells } from "./teamAreas";
import { DEFAULT_GRID_HEIGHT, gridWidthForHeight, sanitizeGridHeight } from "./gridLayout";
import { findWordsFrom } from "./wordSearch";
import {
  ClusterFunPlayer,
  ISessionHelper,
  ClusterFunGameProps,
  Vector2,
  ClusterfunPresenterModel,
  ReconnectInfo,
  ITelemetryLogger,
  IStorage,
  GeneralGameState,
  PresenterGameEvent,
  PresenterGameState,
  ITypeHelper,
} from "libs";
import Logger from "js-logger";
import { findHotPathInGrid, LetterGridPath } from "./LetterGridPath";
import {
  LetterChain,
  LexibleBoardUpdateEndpoint,
  LexibleEndRoundEndpoint,
  LexibleOnboardClientEndpoint,
  LexibleOnboardClientMessage,
  LexibleRecentlyTouchedLettersMessage,
  LexibleReportTouchLetterEndpoint,
  LexibleRequestWordHintsEndpoint,
  LexibleServerRecentlyTouchedLettersEndpoint,
  LexibleSubmitWordEndpoint,
  LexibleSwitchTeamEndpoint,
  LexibleSwitchTeamRequest,
  LexibleSwitchTeamResponse,
  LexibleTouchLetterRequest,
  LexibleWordHintRequest,
  LexibleWordHintResponse,
  LexibleWordSubmissionRequest,
  LexibleWordSubmissionResponse,
  PlayBoard,
} from "./lexibleEndpoints";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";

const LEXIBLE_SETTINGS_KEY = "lexible_settings";
const SEND_RECENT_LETTERS_INTERVAL_MS = 200;
/**
 * How long an accepted submission is remembered so a resend of it is ignored.  Comfortably
 * longer than the endpoint's 2s retry interval, and short enough that a player who genuinely
 * plays the same letters again later is not blocked.
 */
const SUBMISSION_MEMORY_MS = 15000;

export enum LexiblePlayerStatus {
  Unknown = "Unknown",
  WaitingForStart = "WaitingForStart",
}

export class LexiblePlayer extends ClusterFunPlayer {
  @observable totalScore = 0;
  @observable status = LexiblePlayerStatus.Unknown;
  @observable message = "";
  @observable colorStyle = "#ffffff";
  @observable x = 0;
  @observable y = 0;
  @observable teamName = "X";
  @observable longestWord = "";
  @observable captures = 0;
}

// -------------------------------------------------------------------
// The Game state
// -------------------------------------------------------------------
export enum LexibleGameState {
  EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum LexibleGameEvent {
  ResponseReceived = "ResponseReceived",
  WordAccepted = "WordAccepted",
  TeamWon = "TeamWon",
}

//--------------------------------------------------------------------------------------
//
//--------------------------------------------------------------------------------------
interface LexibleSettings {
  /** Rows the host asked for; the column count is derived from it. */
  gridHeight: number;
  startFromTeamArea: boolean;
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getLexiblePresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "LexiblePresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case LetterGridModel:
          return "LetterGridModel";
        case LetterBlockModel:
          return "LetterBlockModel";
        case LexiblePresenterModel:
          return "LexiblePresenterModel";
        case LexiblePlayer:
          return "LexiblePlayer";
        case Vector2:
          return "Vector2";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "LetterGridModel":
          return new LetterGridModel();
        case "LetterBlockModel":
          return new LetterBlockModel("_");
        case "LexiblePresenterModel":
          return new LexiblePresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "LexiblePlayer":
          return new LexiblePlayer();
        case "Vector2":
          return new Vector2(0, 0);
        // TODO: add your custom type handlers here
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      switch (propertyName) {
        case "__blockid":
        case "failFade":
        case "wordTree":
        case "wordSet":
          return false;
      }

      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      switch (propertyName) {
        case "selectMap":
          return observable(rehydratedObject as string[]);
      }

      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class LexiblePresenterModel extends ClusterfunPresenterModel<LexiblePlayer> {
  @observable theGrid = new LetterGridModel();

  @observable private _roundWinningTeam = "";
  get roundWinningTeam() {
    return this._roundWinningTeam;
  }
  set roundWinningTeam(value) {
    action(() => {
      this._roundWinningTeam = value;
    })();
  }

  @observable private _startFromTeamArea = true;
  get startFromTeamArea() {
    return this._startFromTeamArea;
  }
  set startFromTeamArea(value) {
    action(() => {
      this._startFromTeamArea = value;
      this.saveSettings();
    })();
  }

  // How many rows the host wants.  The tile size and the column count both fall
  // out of this and the size of the play area - see gridLayout.ts.  It replaces
  // the old Small/Medium/Large setting, which set a width from a player-count
  // guess and left the board not quite filling the screen at most sizes.
  @observable private _gridHeight = DEFAULT_GRID_HEIGHT;
  get gridHeight() {
    return this._gridHeight;
  }
  set gridHeight(value) {
    action(() => {
      this._gridHeight = sanitizeGridHeight(value);
      this.saveSettings();
    })();
  }

  /** The columns that fit beside that many rows. Derived, never stored. */
  get gridWidth() {
    return gridWidthForHeight(this._gridHeight);
  }

  get gameTimeMinutes() {
    return this.gameTime_ms / 60000;
  }

  letterData = [
    { letter: "E", ratio: 0.1013 },
    { letter: "A", ratio: 0.085 },
    { letter: "R", ratio: 0.0758 },
    { letter: "I", ratio: 0.0754 },
    { letter: "O", ratio: 0.0716 },
    { letter: "T", ratio: 0.0695 },
    { letter: "N", ratio: 0.0665 },
    { letter: "S", ratio: 0.0574 },
    { letter: "L", ratio: 0.0549 },
    { letter: "C", ratio: 0.0454 },
    { letter: "U", ratio: 0.0363 },
    { letter: "D", ratio: 0.0338 },
    { letter: "P", ratio: 0.0317 },
    { letter: "M", ratio: 0.0301 },
    { letter: "H", ratio: 0.03 },
    { letter: "G", ratio: 0.0247 },
    { letter: "B", ratio: 0.0207 },
    { letter: "F", ratio: 0.0181 },
    { letter: "Y", ratio: 0.0178 },
    { letter: "W", ratio: 0.0129 },
    { letter: "K", ratio: 0.011 },
    { letter: "V", ratio: 0.0101 },
    { letter: "X", ratio: 0.004 },
    { letter: "Z", ratio: 0.006 },
    { letter: "J", ratio: 0.005 },
    { letter: "Q", ratio: 0.005 },
  ];

  wordTree: WordTree;
  wordSet = new Set<string>();
  badWords = new Set<string>();

  gameTimeLastSentTouchedLetters_ms = 0;
  recentlyTouchedLetters = new Map<number, Vector2>();
  _teamPoints: number[] = observable([0, 0]);
  get gameWinningTeam() {
    if (this._teamPoints[0] > this._teamPoints[1]) return "A";
    if (this._teamPoints[0] < this._teamPoints[1]) return "B";
    else return undefined;
  }

  get longestWord() {
    let longestWord = { value: "_", playerName: "na" };
    this.players.forEach((p) => {
      if (p.longestWord.length > longestWord.value.length) {
        longestWord.value = p.longestWord;
        longestWord.playerName = p.name;
      }
    });
    return longestWord;
  }

  get mostCaptures() {
    let mostCaptures = { value: 0, playerName: "na" };
    this.players.forEach((p) => {
      if (p.captures > mostCaptures.value) {
        mostCaptures.value = p.captures;
        mostCaptures.playerName = p.name;
      }
    });
    return mostCaptures;
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("Lexible", sessionHelper, logger, storage);

    this.allowedJoinStates.push(
      GeneralGameState.Playing,
      GeneralGameState.Paused,
      GeneralGameState.Instructions,
    );

    this.minPlayers = 2;

    this.wordTree = WordTree.create([]);

    const savedSettingsValue = storage.get(LEXIBLE_SETTINGS_KEY);
    if (savedSettingsValue) {
      const savedSettings = JSON.parse(savedSettingsValue) as LexibleSettings;
      this.gridHeight = savedSettings.gridHeight ?? DEFAULT_GRID_HEIGHT;
      this.startFromTeamArea = savedSettings.startFromTeamArea ?? true;
    }

    makeObservable(this);
  }

  // -------------------------------------------------------------------
  //  reconstitute - add code here to fix up saved game data that
  //                 has been loaded after a refresh
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.populateWordSet();
    this.subscribe(PresenterGameEvent.PlayerJoined, this.name, this.handlePlayerJoin);
    this.listenToEndpoint(LexibleOnboardClientEndpoint, this.handleOnboardClient);
    this.listenToEndpoint(LexibleReportTouchLetterEndpoint, this.handleTouchLetterMessage);
    this.listenToEndpoint(LexibleRequestWordHintsEndpoint, this.handleWordHintMessage);
    this.listenToEndpoint(LexibleSubmitWordEndpoint, this.handleSubmitWordMessage);
    this.listenToEndpoint(LexibleSwitchTeamEndpoint, this.handleSwitchTeam);
    // TODO: Make this method cleanuppable
    // this.session.onError(err => {
    //     Logger.error(`Session error: ${err}`)
    //     this.quitApp();
    // })
    this.theGrid.processBlocks((block) => {
      this.setBlockHandlers(block);
    });
    // Derived from the board, not saved with it - recompute rather than trust
    // whatever a checkpoint happened to carry.
    this.updateHomeConnections();
  }

  // -------------------------------------------------------------------
  //  updateHomeConnections - mark which tiles are actually joined to their
  //  own team's starting area, and which sides of that region face out.
  //
  //  Cheap (one flood fill per team over the grid) and only run when the
  //  board changes, so it is not worth memoising further.
  // -------------------------------------------------------------------
  updateHomeConnections() {
    const connected: Record<string, Set<string>> = {
      A: connectedToLeftEdge(this.theGrid, "A"),
      B: connectedToLeftEdge(this.theGrid, "B"),
    };
    const isIn = (team: string, x: number, y: number) =>
      !!connected[team] && connected[team].has(`${x},${y}`);

    this.theGrid.processBlocks((block) => {
      const { x, y } = block.coordinates;
      const team = block.team;
      if (!isIn(team, x, y)) {
        block.setHomeConnection(false, 0);
        return;
      }
      // A side gets an edge only where the region stops, so the whole
      // connected blob ends up with a single outline around it.
      let mask = 0;
      if (!isIn(team, x, y - 1)) mask |= 1; // top
      if (!isIn(team, x + 1, y)) mask |= 2; // right
      if (!isIn(team, x, y + 1)) mask |= 4; // bottom
      if (!isIn(team, x - 1, y)) mask |= 8; // left
      block.setHomeConnection(true, mask);
    });
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  saveSettings() {
    const savedSettings: LexibleSettings = {
      gridHeight: this.gridHeight,
      startFromTeamArea: this.startFromTeamArea,
    };
    this.storage.set(LEXIBLE_SETTINGS_KEY, JSON.stringify(savedSettings, null, 2));
  }

  // -------------------------------------------------------------------
  //  populateWordSet - asynchronously load the words from the compressed
  //                    word list
  // -------------------------------------------------------------------
  private async populateWordSet() {
    // Both are presenter-only and both are lazy: a phone never downloads a
    // dictionary.  The word list is a compressed asset fetched at runtime
    // rather than a source module - see assets/words/wordList.ts.
    const wordListPromise = import("../assets/words/wordList").then((m) => m.loadWordList());
    const badWordsPromise = import("../assets/words/badwords");

    const wordList = await wordListPromise;
    let lastAwaitTime = window.performance.now();
    // Drop blanks.  The list is a text file and ends with a newline, so a plain
    // split leaves a trailing "" that would go into both the set and the trie -
    // an empty-string node in the tree and a word count one too high.
    const words = wordList.split("\n");
    this.wordTree = new WordTree("", undefined);
    for (const word of words) {
      if (window.performance.now() - lastAwaitTime > 10) {
        await this.waitForRealTime(0);
        if (this.isShutdown) return;
        lastAwaitTime = window.performance.now();
      }
      const trimmed = word.trim();
      if (!trimmed) continue;
      this.wordTree.add(trimmed);
      this.wordSet.add(trimmed);
    }
    Logger.info(`Loaded ${this.wordSet.size} words`);

    const { badWordList } = await badWordsPromise;
    const badWords = badWordList.split("\n");
    for (const badWord of badWords) {
      if (window.performance.now() - lastAwaitTime > 5) {
        await this.waitForRealTime(0);
        if (this.isShutdown) return;
        lastAwaitTime = window.performance.now();
      }
      const trimmed = badWord.trim();
      // Same reason as above - and an empty entry in the censor list would be
      // far worse than a miscount, since it matches everything it is tested on.
      if (!trimmed) continue;
      this.badWords.add(trimmed);
    }
    Logger.info(`Loaded ${this.badWords.size} censored words`);
  }

  // -------------------------------------------------------------------
  // handlePlayerJoin
  // -------------------------------------------------------------------
  handlePlayerJoin = (player: LexiblePlayer) => {
    if (player.teamName === "X") {
      // See how many players on each team
      const teamA = this.players.filter((p) => p.teamName === "A");
      const teamB = this.players.filter((p) => p.teamName === "B");

      // Add to smallest
      if (teamA.length < teamB.length) player.teamName = "A";
      else if (teamB.length < teamA.length) player.teamName = "B";
      else {
        player.teamName = "AB"[Date.now() % 2];
      }
      // Write it down NOW.  Without this the checkpoint still holds the "X"
      // default, and a presenter refresh brings the player back teamless: they
      // vanish from both rosters and every word they submit is rejected,
      // because handleSubmitWord substitutes '#' for a tile whose team does not
      // match theirs.  They look fine on their own phone the whole time.
      //
      // A returning player takes the onPlayerReturned path rather than this
      // one, so nothing else would ever re-assign it.
      this.saveCheckpoint();
    }

    Logger.debug(`Joined game state: ${this.gameState}`);
  };

  // -------------------------------------------------------------------
  // setBlockHandlers
  // -------------------------------------------------------------------
  setBlockHandlers(block: LetterBlockModel) {
    block.onSelectedChanged = this.handleLetterSelect;
  }

  // -------------------------------------------------------------------
  //
  // -------------------------------------------------------------------
  handleLetterSelect = (playerId: string, selectedValue: boolean) => {
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  createFreshPlayerEntry
  // -------------------------------------------------------------------
  createFreshPlayerEntry(name: string, id: string): LexiblePlayer {
    const newPlayer = new LexiblePlayer();
    newPlayer.playerId = id;
    newPlayer.name = name;

    return newPlayer;
  }

  // -------------------------------------------------------------------
  //  onPlayerReturned - their team and their tiles are still theirs.
  //
  //  Team membership is filtered by player id, and player ids are stable
  //  across a reconnect, so a returning player comes back to the same team
  //  with the same board.  The phone re-onboards on join and is sent the
  //  whole grid, so there is nothing to push at it here.
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: LexiblePlayer, _info: ReconnectInfo) {}

  // -------------------------------------------------------------------
  //  onPlayerDisconnected - drop the letters they had part-selected.
  //
  //  A half-spelled word is the one bit of per-player state that lives on
  //  the shared board rather than on the phone, so a dropped player would
  //  otherwise leave letters glowing as theirs for the rest of the round
  //  with nobody behind them.  Everything that matters - team, tiles,
  //  score - is keyed by their stable id and stays exactly where it is.
  // -------------------------------------------------------------------
  protected onPlayerDisconnected(player: LexiblePlayer) {
    action(() => {
      this.theGrid.processBlocks((block) => {
        if (block.isSelectedByPlayer(player.playerId)) {
          block.selectForPlayer(player.playerId, false);
        }
      });
    })();
  }

  // -------------------------------------------------------------------
  //
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
    this._teamPoints.fill(0);
  };

  // -------------------------------------------------------------------
  //  prepareFreshRound - called automatically before every round
  // -------------------------------------------------------------------
  prepareFreshRound = () => {
    // One number from the host - the row count - and the columns follow from
    // how many tiles of that size fit across the play area.
    const newGrid = new LetterGridModel(this.gridWidth, this.gridHeight);

    const letterCount = newGrid.width * newGrid.height + 20;
    const letterDeck: string[] = [];

    // Assemble a collection of letters to choose from
    this.letterData.forEach((item) => {
      const toPlace = Math.floor(item.ratio * letterCount);
      for (let i = 0; i < toPlace; i++) {
        letterDeck.push(item.letter);
      }
    });

    // shuffle
    for (let i = 0; i < letterDeck.length - 1; i++) {
      const pick = i + 1 + this.randomInt(letterDeck.length - i - 1);
      const temp = letterDeck[i];
      letterDeck[i] = letterDeck[pick];
      letterDeck[pick] = temp;
    }

    newGrid.populate(letterDeck.map((l) => `${l}_0`).join(""));
    if (this.startFromTeamArea) {
      // Both teams start on the left and both run for the right edge, so
      // neither is handed the easier half of an asymmetric board.  The exact
      // cells - and why they interleave rather than collide - are in
      // teamAreas.ts, which the win search and the board border also read.
      for (const team of ["A", "B"]) {
        for (const cell of homeCells(newGrid, team)) {
          newGrid.getBlock(cell)!.setScore(TEAM_HOME_SCORE, team);
        }
      }
    }
    newGrid.processBlocks((block) => {
      this.setBlockHandlers(block);
    });

    // done!
    this.theGrid = newGrid;
    this.updateHomeConnections();
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  run a method to check for a state transition
  // -------------------------------------------------------------------
  handleTick() {
    if (this.recentlyTouchedLetters.size > 0) {
      if (
        this.gameTime_ms - this.gameTimeLastSentTouchedLetters_ms >
        SEND_RECENT_LETTERS_INTERVAL_MS
      ) {
        this.gameTimeLastSentTouchedLetters_ms = this.gameTime_ms;
        const letterCoordinates = Array.from(this.recentlyTouchedLetters.values());
        this.recentlyTouchedLetters.clear();
        const message: LexibleRecentlyTouchedLettersMessage = { letterCoordinates };
        this.sendToEveryone(LexibleServerRecentlyTouchedLettersEndpoint, () => message);
      }
    }
  }

  // -------------------------------------------------------------------
  //  createPlayRequestMessage
  // -------------------------------------------------------------------
  createPlayRequestMessage(teamName: string) {
    const playBoard: PlayBoard = {
      gridHeight: this.theGrid.height,
      gridWidth: this.theGrid.width,
      gridData: this.theGrid.serialize(),
    };
    const payload = {
      sender: this.session.personalId,
      roundNumber: this.currentRound,
      playBoard,
      teamName,
      settings: { startFromTeamArea: this.startFromTeamArea },
    };
    return payload;
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  doneGathering() {
    this.gameState = GeneralGameState.Instructions;
  }

  // -------------------------------------------------------------------
  //  startNextRound
  // -------------------------------------------------------------------
  startNextRound = () => {
    this.prepareFreshRound();
    this.gameState = GeneralGameState.Playing;
    this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
    this.currentRound++;

    this.players.forEach((p, i) => {
      p.status = LexiblePlayerStatus.WaitingForStart;
      p.message = "";
      p.colorStyle = "white";
      p.x = 0.1;
      p.y = i * 0.1 + 0.1;
    });

    if (this.currentRound > this.totalRounds) {
      this.gameState = GeneralGameState.GameOver;
      this.requestEveryone(GameOverEndpoint, (p, ie) => ({}));
    } else {
      this.sendToEveryone(InvalidateStateEndpoint, (p, ie) => ({}));
    }
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  findWords - every word spellable from this letter.
  //
  //  The search itself is pure and lives in wordSearch.ts, where it can be
  //  tested against the board without standing a whole presenter up.
  // -------------------------------------------------------------------
  findWords(startBlock: LetterBlockModel) {
    return findWordsFrom(this.theGrid, startBlock, this.wordTree, this.badWords);
  }

  // -------------------------------------------------------------------
  //  checkForWin - a win is when there is a contiguous line of blocks
  //                from one side to the other for a single team.
  //                Blocks are not continguous through corners.
  // -------------------------------------------------------------------
  async checkForWin() {
    this.theGrid.processBlocks((b) => {
      b.onPath = false;
    });
    await this.waitForRealTime(0); // allow mobx to clear animations
    const paths: Record<"A" | "B", LetterGridPath> = {
      A: findHotPathInGrid(this.theGrid, "A"),
      B: findHotPathInGrid(this.theGrid, "B"),
    };
    let pathsToDraw: Array<"A" | "B"> = ["A", "B"];
    for (const team of ["A", "B"] as Array<"A" | "B">) {
      const path = paths[team];
      if (path.cost.enemy === 0 && path.cost.neutral === 0) {
        this.handleGameWin(team);
        pathsToDraw = [team];
      }
    }
    for (let i = 0; i < this.theGrid.width * 4; i++) {
      let paintedOne = false;
      for (const team of pathsToDraw) {
        if (paths[team].nodes.length > i) {
          paintedOne = true;
          this.theGrid.getBlock(paths[team].nodes[i])!.onPath = true;
        }
      }
      if (!paintedOne) {
        break;
      } else {
        await this.waitForRealTime(50);
      }
    }
  }

  // -------------------------------------------------------------------
  //  handleGameWin
  // -------------------------------------------------------------------
  handleGameWin(team: string) {
    this.roundWinningTeam = team;
    switch (team) {
      case "A":
        this._teamPoints[0]++;
        break;
      case "B":
        this._teamPoints[1]++;
        break;
      default:
        console.log(`WEIRD: unexpected team value: ${team}`);
    }
    this.gameState = LexibleGameState.EndOfRound;
    this.invokeEvent(LexibleGameEvent.TeamWon, team);
    this.sendToEveryone(LexibleEndRoundEndpoint, (p, ie) => {
      return { roundNumber: this.currentRound, winningTeam: team };
    });
  }

  // -------------------------------------------------------------------
  //  placeSuccessfulWord
  // -------------------------------------------------------------------
  placeSuccessfulWord(data: LexibleWordSubmissionRequest, word: string, player: LexiblePlayer) {
    const placedLetters: LetterChain = [];
    data.letters.forEach((l) => {
      const block = this.theGrid.getBlock(l.coordinates);
      if (!block) {
        console.log(`WEIRD: placeSuccessfulWord: no block at `, l.coordinates);
        return;
      }
      // only capture this block if the score is high enough
      if (word.length > block.score) {
        if (block.team !== "_" && block.team !== player.teamName) {
          player.captures++;
        }
        block.setScore(Math.max(word.length, block.score), player.teamName);
        placedLetters.push(l);
      }
      // however, do mark redundant word submissions
      if (word.length === block.score && block.team === player.teamName) {
        placedLetters.push(l);
      }
    });

    if (word.length > player.longestWord.length) player.longestWord = word;

    // Tiles changed hands, so the joined-to-home regions have moved with them.
    this.updateHomeConnections();

    this.sendToEveryone(LexibleBoardUpdateEndpoint, (p, isExited) => {
      return {
        letters: placedLetters,
        score: word.length,
        scoringPlayerId: player.playerId,
        scoringTeam: player.teamName,
      };
    });

    this.invokeEvent(LexibleGameEvent.WordAccepted, word.toLowerCase(), player);
    if (player.teamName === "A" || player.teamName === "B") {
      this.checkForWin();
    } else {
      Logger.warn("WEIRD: Player with unknown teamname");
    }
    this.saveCheckpoint();
  }

  handleOnboardClient = (sender: string, message: unknown): LexibleOnboardClientMessage => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) {
      throw new Error("Sending player has not joined yet");
    }
    const playBoard: PlayBoard = {
      gridHeight: this.theGrid.height,
      gridWidth: this.theGrid.width,
      gridData: this.theGrid.serialize(),
    };
    const payload: LexibleOnboardClientMessage = {
      gameState: this.gameState,
      roundNumber: this.currentRound,
      playBoard,
      teamName: player.teamName,
      settings: { startFromTeamArea: this.startFromTeamArea },
    };
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    return payload;
  };

  handleWordHintMessage = (
    sender: string,
    message: LexibleWordHintRequest,
  ): LexibleWordHintResponse => {
    if (message.currentWord.length < 1) throw Error("No word submitted");

    const block = this.theGrid.getBlock(message.currentWord[0].coordinates);
    if (!block) throw Error("Word coordinate does not correspond to an existing block");
    if (block.letter !== message.currentWord[0].letter)
      throw Error("Desync: client thinks letter is different");

    const wordList = this.findWords(block);
    return { wordList };
  };

  handleTouchLetterMessage = (sender: string, message: LexibleTouchLetterRequest): void => {
    if (
      message.touchPoint.x < 0 ||
      message.touchPoint.x >= this.theGrid.width ||
      message.touchPoint.y < 0 ||
      message.touchPoint.y >= this.theGrid.height
    ) {
      Logger.warn("Touched letter coordinates are out of bounds");
      return;
    }
    this.recentlyTouchedLetters.set(
      message.touchPoint.x * 1000 + message.touchPoint.y,
      message.touchPoint,
    );
  };

  // Submissions already answered, so a resend is not scored twice.  Keyed by
  // player and the exact letters; see handleSubmitWordMessage.
  private _recentSubmissions = new Map<
    string,
    { at: number; response: LexibleWordSubmissionResponse }
  >();

  handleSubmitWordMessage = (
    sender: string,
    request: LexibleWordSubmissionRequest,
  ): LexibleWordSubmissionResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) throw Error("Unknown player attempted to submit a word");

    // Answering the same submission twice claims the tiles twice and scores it
    // twice.  That is not hypothetical: LexibleSubmitWordEndpoint retries after
    // 2s, and speaking a word on the WASM backend blocks this thread for about
    // as long - so the phone gives up waiting and resends while the presenter
    // is still mid-synthesis.  Replay the original answer instead.
    const key = `${sender}|${request.letters
      .map((l) => `${l.coordinates.x},${l.coordinates.y}`)
      .join("-")}`;
    const now = Date.now();
    for (const [seen, entry] of this._recentSubmissions) {
      if (now - entry.at > SUBMISSION_MEMORY_MS) this._recentSubmissions.delete(seen);
    }
    const alreadyAnswered = this._recentSubmissions.get(key);
    if (alreadyAnswered) {
      Logger.info(`Ignoring a repeated submission from ${player.name}`);
      return alreadyAnswered.response;
    }

    let scoreTooLow = false;
    const word = request.letters
      .map((l, index) => {
        if (!l.coordinates) throw Error(`No coordinate on submitted letter: ${JSON.stringify(l)}`);
        const block = this.theGrid.getBlock(l.coordinates);
        if (!block) return "#";
        if (this.startFromTeamArea && index === 0 && player.teamName !== block.team) {
          return "#";
        }
        // // don't allow letter for spelling unless score is hight
        // if( block.team !== player.teamName
        //     && block.score >= data.letters.length) scoreTooLow = true;
        if (block.letter === l.letter) return l.letter.toUpperCase();
        else return "#";
      })
      .join("");

    if (!scoreTooLow && this.wordSet.has(word.toUpperCase())) {
      this.placeSuccessfulWord(request, word, player);
      const response = {
        success: true,
        letters: request.letters,
      };
      this._recentSubmissions.set(key, { at: now, response });
      return response;
    } else {
      Logger.info(`Failed word '${word}' because ${scoreTooLow ? "Low score" : "Not found"}`);
      return {
        success: false,
        letters: request.letters,
      };
    }
  };

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  handleSwitchTeam = (
    sender: string,
    request: LexibleSwitchTeamRequest,
  ): LexibleSwitchTeamResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) throw Error("Unknown player attempted to switch teams");

    const TeamA = this.players.filter((p) => p.teamName === "A");
    const TeamB = this.players.filter((p) => p.teamName === "B");

    if (
      request.desiredTeam === "A" &&
      !TeamA.find((p) => p.playerId === player.playerId) &&
      TeamB.length > 1
    ) {
      player.teamName = request.desiredTeam;
    }
    if (
      request.desiredTeam === "B" &&
      !TeamB.find((p) => p.playerId === player.playerId) &&
      TeamA.length > 1
    ) {
      player.teamName = request.desiredTeam;
    }

    return { currentTeam: player.teamName };
  };
}
