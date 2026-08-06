import { action, makeObservable, observable } from "mobx";
import {
  PHASE_GAP_MS,
  PICKS_HOLD_MS,
  REVEAL_BUFFER_MS,
  ROUND_TIME_MS,
  STEP_ANIMATION_MS,
} from "./GameSettings";
import {
  ClusterFunPlayer,
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunPresenterModel,
  ReconnectInfo,
  ITelemetryLogger,
  IStorage,
  ITypeHelper,
  PresenterGameState,
  GeneralGameState,
} from "libs";
import Logger from "js-logger";
import {
  OneOhOneOnboardClientEndpoint,
  OneOhOneOnboardClientMessage,
  OneOhOneRoundPhase,
  OneOhOneRoundResultEndpoint,
  OneOhOneRoundStartEndpoint,
  OneOhOneMoveSummary,
  OneOhOneSetGuessEndpoint,
  OneOhOneSetGuessRequest,
  OneOhOneSetGuessResponse,
  PieceSnapshot,
} from "./oneOhOneEndpoints";
import {
  BotAttitude,
  botPickGuess,
  computePhasedRevealMs,
  GamePiece,
  GUESS_HISTORY_LENGTH,
  MAX_GUESS,
  maxGuessFor,
  resolveRoundWithRules,
  RoundRules,
  MAX_PIECES,
  maxPiecesPerHuman,
  MIN_GUESS,
  PieceMove,
  randomGuess,
  resolveRound,
  totalPieceCount,
  WIN_POSITION,
  sanitizeWinPosition,
  bustLimitFor,
} from "./oneOhOneLogic";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";

export class OneOhOnePlayer extends ClusterFunPlayer {}

// -------------------------------------------------------------------
// The Game state
// -------------------------------------------------------------------
export enum OneOhOneGameState {
  Playing = "Playing",
}

// -------------------------------------------------------------------
// Game events (views subscribe for sounds/animation)
// -------------------------------------------------------------------
export enum OneOhOneGameEvent {
  RoundResolved = "RoundResolved",
  WinnerAnnounced = "WinnerAnnounced",
}

// -------------------------------------------------------------------
// Type helper for save/restore
// -------------------------------------------------------------------
export const getOneOhOnePresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "OneOhOnePresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case OneOhOnePresenterModel:
          return "OneOhOnePresenterModel";
        case OneOhOnePlayer:
          return "OneOhOnePlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "OneOhOnePresenterModel":
          return new OneOhOnePresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "OneOhOnePlayer":
          return new OneOhOnePlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      if (typeName === "OneOhOnePresenterModel") {
        switch (propertyName) {
          case "pieces":
            return observable(rehydratedObject as GamePiece[]);
          case "bots":
            return observable(rehydratedObject as BotAttitude[]);
        }
      }
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// presenter data and logic - owns the track, the pieces, and the rules
// -------------------------------------------------------------------
export class OneOhOnePresenterModel extends ClusterfunPresenterModel<OneOhOnePlayer> {
  // All pieces on the track (human-owned and bots), built at game start
  pieces = observable<GamePiece>([]);

  // Bot lineup configured in the gathering screen (one piece each)
  bots = observable<BotAttitude>([]);

  // How far the track runs.  The game is called 101, but a shorter target makes a
  // quicker round, and the host sets it before starting.
  @observable private _winPosition = WIN_POSITION;
  get winPosition() {
    return this._winPosition;
  }
  set winPosition(value: number) {
    this._winPosition = sanitizeWinPosition(value);
    this.saveCheckpoint();
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
  }
  /**
   * The biggest number anybody may pick this game: five wider than the field.  A fixed 1-10
   * made 101 two different games - with three pieces a collision was bad luck, with sixteen
   * it was nearly unavoidable and the whole field slid backwards every round.
   *
   * PIECES, not people: a player with four pieces is four things picking numbers, and it is
   * the pickers that collide.
   */
  get maxGuess() {
    // Before the game starts `pieces` is empty, so fall back to what the host has SET UP.
    // Without that, the gathering screen advertised "pick a number from 1-6" for a
    // sixteen-piece field, and the range jumped the moment the round began.
    return maxGuessFor(this.pieces.length || this.totalPlannedPieces);
  }

  get bustLimit() {
    return bustLimitFor(this._winPosition, this.maxGuess);
  }

  // The two catch-up rules and the guess history are the host's call, set before the game
  // starts. 101 is a race in which a piece that falls behind has no way to gain on the field
  // faster than anybody else, so a bad early round used to decide it before it got
  // interesting - see oneOhOneLogic for what each rule does.
  @observable private _lastPlaceBonus = true;
  get lastPlaceBonus() {
    return this._lastPlaceBonus;
  }
  set lastPlaceBonus(value: boolean) {
    action(() => (this._lastPlaceBonus = value))();
    this.saveCheckpoint();
  }

  @observable private _potEnabled = false;
  get potEnabled() {
    return this._potEnabled;
  }
  set potEnabled(value: boolean) {
    action(() => (this._potEnabled = value))();
    this.saveCheckpoint();
  }

  @observable private _showGuessHistory = true;
  get showGuessHistory() {
    return this._showGuessHistory;
  }
  set showGuessHistory(value: boolean) {
    action(() => (this._showGuessHistory = value))();
    this.saveCheckpoint();
  }

  /** The collision pot, and whether it has already been paid out. Paid once per game. */
  @observable pot = 0;
  @observable potSpent = false;

  /** The rules the pure layer needs, assembled from the host's settings. */
  get roundRules(): RoundRules {
    return {
      winPosition: this.winPosition,
      maxGuess: this.maxGuess,
      lastPlaceBonus: this._lastPlaceBonus,
      potEnabled: this._potEnabled,
    };
  }

  @observable private _piecesPerHuman = 1;
  get piecesPerHuman() {
    return this._piecesPerHuman;
  }
  set piecesPerHuman(value: number) {
    this._piecesPerHuman = Math.max(1, value);
    this.saveCheckpoint();
  }

  @observable roundPhase: OneOhOneRoundPhase = OneOhOneRoundPhase.Collecting;

  // The most recent round's resolved moves (with names) - kept for onboarding
  // clients that refresh mid-reveal
  lastResults: OneOhOneMoveSummary[] = [];

  get winners(): GamePiece[] {
    return this.pieces.filter((p) => p.position === this.winPosition);
  }

  get totalPlannedPieces() {
    return totalPieceCount(this.players.length, this.piecesPerHuman, this.bots.length);
  }

  get maxPiecesPerHumanNow() {
    return maxPiecesPerHuman(this.players.length, this.bots.length);
  }

  // The board needs at least 2 pieces (collisions must be possible) and at most 16
  get canStart() {
    return (
      this.players.length >= this.minPlayers &&
      this.totalPlannedPieces >= 2 &&
      this.totalPlannedPieces <= MAX_PIECES &&
      this.piecesPerHuman <= this.maxPiecesPerHumanNow
    );
  }

  get humanPieces(): GamePiece[] {
    return this.pieces.filter((p) => p.ownerId !== null);
  }

  get confirmedCount() {
    return this.humanPieces.filter((p) => p.confirmed).length;
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("OneOhOne", sessionHelper, logger, storage);
    Logger.info(`Constructing OneOhOnePresenterModel ${this.gameState}`);

    // Pieces are fixed at start, so new humans may only join while gathering
    // (rejoin of existing players works in any state)
    this.allowedJoinStates = [PresenterGameState.Gathering];

    this.minPlayers = 1; // solo vs. bots is a fine way to test mechanics
    this.maxPlayers = MAX_PIECES;

    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire up listeners (runs fresh AND after restore)
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpoint(OneOhOneOnboardClientEndpoint, this.handleOnboardClient);
    this.listenToEndpoint(OneOhOneSetGuessEndpoint, this.handleSetGuess);
  }

  // -------------------------------------------------------------------
  // createFreshPlayerEntry
  // -------------------------------------------------------------------
  createFreshPlayerEntry(name: string, id: string): OneOhOnePlayer {
    const newPlayer = new OneOhOnePlayer();
    newPlayer.playerId = id;
    newPlayer.name = name;
    return newPlayer;
  }

  // -------------------------------------------------------------------
  //  onPlayerReturned - their pieces are still theirs.
  //
  //  Pieces are owned by `ownerId`, which is the player's id, and player ids
  //  are stable across a reconnect - so a returning player's pieces are
  //  waiting for them and every `p.ownerId === sender` lookup still matches.
  //  The phone re-onboards on join and pulls its pieces back, and
  //  handleRoundStart re-onboards again if it ever finds itself with none.
  //
  //  (This used to be broken: ids changed on reconnect, the ownerId filters
  //  matched nothing, and a player whose phone slept was left unable to move
  //  anything for the rest of the game.)
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: OneOhOnePlayer, _info: ReconnectInfo) {}

  // -------------------------------------------------------------------
  //  onPlayerDisconnected - nothing to do.  Their pieces stay on the board
  //  and keep their positions; an unconfirmed guess simply times out with
  //  the round, exactly as it would for a player who is thinking too long.
  // -------------------------------------------------------------------
  protected onPlayerDisconnected(_player: OneOhOnePlayer) {}

  // -------------------------------------------------------------------
  // Gathering-screen actions
  // -------------------------------------------------------------------
  addBot(attitude: BotAttitude) {
    if (this.totalPlannedPieces >= MAX_PIECES) return;
    this.bots.push(attitude);
    this.saveCheckpoint();
  }

  removeBot(index: number) {
    if (index >= 0 && index < this.bots.length) {
      this.bots.splice(index, 1);
      this.saveCheckpoint();
    }
  }

  // -------------------------------------------------------------------
  // prepareFreshGame
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
    this.pieces.clear();
  };

  // -------------------------------------------------------------------
  // prepareFreshRound - the framework calls this once at game start;
  // build the board from the humans + bot lineup.
  // -------------------------------------------------------------------
  prepareFreshRound = () => {
    const newPieces: GamePiece[] = [];

    this.players.forEach((player) => {
      for (let i = 0; i < this.piecesPerHuman; i++) {
        newPieces.push({
          pieceId: `${player.playerId}_p${i}`,
          name: this.piecesPerHuman > 1 ? `${player.name} ${i + 1}` : player.name,
          avatarId: player.avatarId,
          avatarColor: player.avatarColor,
          ownerId: player.playerId,
          attitude: null,
          position: 0,
          guess: null,
          confirmed: false,
          lastMove: null,
          recentGuesses: [],
        });
      }
    });

    this.bots.forEach((attitude, i) => {
      newPieces.push({
        pieceId: `bot_${i}`,
        name: `${attitude} Bot ${i + 1}`,
        avatarId: (newPieces.length + i) % 8,
        avatarColor: (newPieces.length + i) % 12,
        ownerId: null,
        attitude,
        position: 0,
        guess: null,
        confirmed: false,
        lastMove: null,
        recentGuesses: [],
      });
    });

    this.pieces.replace(newPieces);
    this.currentRound = 0;
  };

  // -------------------------------------------------------------------
  // startNextRound - open a new collecting phase
  // -------------------------------------------------------------------
  startNextRound = () => {
    this.currentRound++;
    this.roundPhase = OneOhOneRoundPhase.Collecting;
    this.pieces.forEach((p) => {
      p.guess = null;
      p.confirmed = false;
    });
    this.timeOfStageEnd = this.gameTime_ms + ROUND_TIME_MS;
    // Only assign gameState on a real transition - reassigning fires state
    // events and resets the DevUI fast-forward toggle every round
    if (this.gameState !== OneOhOneGameState.Playing) {
      this.gameState = OneOhOneGameState.Playing;
    }

    this.sendToEveryone(OneOhOneRoundStartEndpoint, () => ({
      roundNumber: this.currentRound,
      secondsAllowed: ROUND_TIME_MS / 1000,
    }));
    // The board was just (re)built on round 1 - make every client re-onboard
    // so their phones learn which pieces they control
    if (this.currentRound === 1) {
      this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    }
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // handleTick - drive the round timers
  // -------------------------------------------------------------------
  handleTick() {
    if (this.gameState !== OneOhOneGameState.Playing) return;
    if (!this.isStageOver) return;

    if (this.roundPhase === OneOhOneRoundPhase.Collecting) {
      this.resolveCurrentRound();
    } else if (this.winners.length > 0) {
      // Game over waits for the reveal so the winning move gets its animation
      this.finishGame(this.winners);
    } else {
      this.startNextRound();
    }
  }

  // -------------------------------------------------------------------
  // resolveCurrentRound - fill in missing picks (bots + timed-out humans),
  // run the pure rules, apply the moves, and reveal.
  // -------------------------------------------------------------------
  resolveCurrentRound() {
    if (this.roundPhase !== OneOhOneRoundPhase.Collecting) return;

    const rand = () => this.randomDouble(1.0);
    this.pieces.forEach((p) => {
      // `== null` on purpose, to catch undefined as well as null.  A human
      // piece stores `attitude: null`, and a checkpoint written before the
      // serializer learned to keep nulls brings it back as undefined - which
      // read as "this is a bot" and threw inside botPickGuess, hanging the
      // whole game one round after a presenter refresh.
      // eslint-disable-next-line eqeqeq
      if (p.guess == null) {
        // eslint-disable-next-line eqeqeq
        p.guess =
          p.attitude != null
            ? botPickGuess(p.attitude, rand, this.maxGuess)
            : randomGuess(rand, this.maxGuess);
      }
    });

    const outcome = resolveRoundWithRules(
      this.pieces.map((p) => ({ pieceId: p.pieceId, position: p.position, guess: p.guess! })),
      this.roundRules,
      this.pot,
      this.potSpent,
    );
    const moves = outcome.moves;
    action(() => {
      this.pot = outcome.pot;
      this.potSpent = outcome.potSpent;
    })();

    const moveById = new Map<string, PieceMove>(moves.map((m) => [m.pieceId, m]));
    const summaries: OneOhOneMoveSummary[] = [];
    this.pieces.forEach((p) => {
      const move = moveById.get(p.pieceId)!;
      p.position = move.newPosition;
      p.lastMove = move;
      // Newest first, three deep. The presenter shows these beside the name so the room can
      // see who keeps picking the same number - which is the whole read on a bluffing game.
      p.recentGuesses = [move.guess, ...(p.recentGuesses ?? [])].slice(0, GUESS_HISTORY_LENGTH);
      summaries.push({ ...move, name: p.name, avatarId: p.avatarId, avatarColor: p.avatarColor });
    });
    this.lastResults = summaries;

    const winners = this.winners;
    this.roundPhase = OneOhOneRoundPhase.Reveal;
    // The reveal lasts exactly as long as the one-piece-at-a-time animation needs
    this.timeOfStageEnd =
      this.gameTime_ms +
      computePhasedRevealMs(
        moves,
        STEP_ANIMATION_MS,
        PICKS_HOLD_MS,
        PHASE_GAP_MS,
        REVEAL_BUFFER_MS,
        this.bustLimit,
      );

    this.sendToEveryone(OneOhOneRoundResultEndpoint, () => ({
      roundNumber: this.currentRound,
      results: summaries,
      winnerIds: winners.map((w) => w.pieceId),
      winnerNames: winners.map((w) => w.name),
    }));
    // Winners are NOT finalized here - handleTick ends the game after the
    // reveal animation has had its moment
    this.invokeEvent(OneOhOneGameEvent.RoundResolved, summaries);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // finishGame
  // -------------------------------------------------------------------
  finishGame(winners: GamePiece[]) {
    this.gameState = GeneralGameState.GameOver;
    this.invokeEvent(OneOhOneGameEvent.WinnerAnnounced, winners);
    this.requestEveryone(GameOverEndpoint, (p, ie) => ({}));
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleOnboardClient - full state for one player's phone
  // -------------------------------------------------------------------
  handleOnboardClient = (sender: string, message: unknown): OneOhOneOnboardClientMessage => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    const myPieces: PieceSnapshot[] = this.pieces
      .filter((p) => p.ownerId === sender)
      .map((p) => ({
        pieceId: p.pieceId,
        name: p.name,
        avatarId: p.avatarId,
        avatarColor: p.avatarColor,
        position: p.position,
        guess: p.guess,
        confirmed: p.confirmed,
        lastMove: p.lastMove,
      }));

    return {
      gameState: this.gameState,
      winPosition: this.winPosition,
      maxGuess: this.maxGuess,
      roundNumber: this.currentRound,
      phase: this.roundPhase,
      secondsLeft: Math.max(0, this.secondsLeftInStage),
      myPieces,
      lastResults: this.lastResults,
      winnerIds: this.winners.map((w) => w.pieceId),
      winnerNames: this.winners.map((w) => w.name),
    };
  };

  // -------------------------------------------------------------------
  // handleSetGuess - a player picked a number for one of their pieces.
  // Request/response: throwing or rejecting tells the phone why.
  // -------------------------------------------------------------------
  handleSetGuess = (sender: string, request: OneOhOneSetGuessRequest): OneOhOneSetGuessResponse => {
    if (
      this.gameState !== OneOhOneGameState.Playing ||
      this.roundPhase !== OneOhOneRoundPhase.Collecting
    ) {
      return { accepted: false, reason: "Not collecting picks right now" };
    }
    if (request.guess < MIN_GUESS || request.guess > this.maxGuess) {
      return { accepted: false, reason: `Pick must be ${MIN_GUESS}-${this.maxGuess}` };
    }
    const piece = this.pieces.find((p) => p.pieceId === request.pieceId && p.ownerId === sender);
    if (!piece) {
      return { accepted: false, reason: "That is not your piece" };
    }
    if (piece.confirmed) {
      return { accepted: false, reason: "That piece is already locked in" };
    }

    piece.guess = request.guess;
    if (request.confirmed) piece.confirmed = true;
    this.saveCheckpoint();

    // Everybody locked in? No need to wait out the clock.
    if (this.humanPieces.every((p) => p.confirmed)) {
      this.resolveCurrentRound();
    }
    return { accepted: true };
  };
}
