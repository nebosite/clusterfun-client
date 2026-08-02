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
import { action, makeObservable, observable, runInAction } from "mobx";
import { EittrisGameState } from "./PresenterModel";
import {
  EittrisBoardReportEndpoint,
  EittrisBoardSnapshot,
  EittrisBoardUpdateEndpoint,
  EittrisCommandMessage,
  EittrisDeliverSpecialEndpoint,
  EittrisDeliverSpecialMessage,
  EittrisCommandEndpoint,
  EittrisReportEvent,
  EittrisStartPlayingEndpoint,
  EittrisStartPlayingMessage,
  EittrisOnboardClientEndpoint,
  EittrisSpecialEventEndpoint,
  EittrisSpecialEventMessage,
  EittrisRosterEntry,
  EittrisRosterView,
  EittrisThumbnailsEndpoint,
  EittrisThumbnailsMessage,
} from "./eittrisEndpoints";
import {
  AFFLICTION_TIMERS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CRYSTAL_BALL_PREVIEW,
  EittrisBoard,
  EittrisPiece,
  EittrisSettings,
  NEXT_PREVIEW_COUNT,
  SpecialType,
  START_INTERVAL_MS,
  afflictionMsLeft,
  defaultSettings,
  effectiveIntervalMs,
  emptyGrid,
  encodeGrid,
  encodePsychoOverlay,
  makeBoard,
  sanitizeSettings,
} from "./eittrisLogic";
import {
  SimulationContext,
  applyCommand,
  applyIncomingSpecial,
  spendAntidote,
  stepBoard,
} from "./eittrisSimulation";
import {
  REPORT_INTERVAL_MS,
  VIBRATE_ATTACKED,
  VIBRATE_BIG_CLEAR,
  VIBRATE_CLEAR,
  VIBRATE_SHIELDED,
} from "./GameSettings";

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
      // Likewise the target-list flashes: a refresh should not replay a hit
      if (propertyName === "hitPulses") return false;
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
// Client data and logic.
//
// The phone SIMULATES ITS OWN BOARD.  It used to be a thin controller that sent every
// gesture to the host and waited to be told what happened, which put a round trip in
// front of every movement - unplayable on a real network.  Now the rules run here, at
// full speed, and the host is told what happened afterwards.
//
// The rules themselves are not written here: they are the shared simulator, the same code
// the host runs for robot boards, so the two cannot drift apart.
//
// Everything the view reads is still a plain observable field, mirrored off the board
// after each step - so the views did not have to change at all.
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
  // Which clear we last buzzed for, so one clear buzzes once
  private _lastClearBuzz = "";
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
  // Who has just been hit, so the target list can flash them.  The number changes on every
  // hit rather than counting anything: it is what lets the view restart its animation when
  // the same player is hit twice in a row.
  @observable hitPulses = new Map<string, { seq: number; repelled: boolean }>();
  private _hitSeq = 0;
  @observable winnerName: string | null = null;
  @observable youWon = false;

  // ---- the board this phone owns ----
  // Not observable: it is stepped many times a second and the view reads the mirrored
  // fields above, so making it deeply observable would cost a great deal for nothing.
  board: EittrisBoard | null = null;
  settings: EittrisSettings = defaultSettings();
  private _lastTickTime_ms = -1;
  // What the host has been told, and when
  private _lastReportTime_ms = -1;
  private _lastReportedGrid = "";
  private _pendingEvents: EittrisReportEvent[] = [];
  private _reportDue = false;
  // Which round the board in hand belongs to.  -1 means there is no board yet.
  private _round = -1;

  // The target list, kept in two halves because they change at completely different
  // rates: who is playing (fixed for the game) and what their board looks like now.
  // The presenter sends identity once and thereafter only the boards that changed.
  @observable private identities: EittrisRosterEntry[] = [];
  @observable private boardStates: { alive: boolean; thumb: string }[] = [];

  /**
   * Is anything wrong with me right now?
   *
   * Read off the affliction clocks rather than the individual flags, so it tracks
   * AFFLICTION_TIMERS on its own: a clock only runs while its affliction is on, and a new
   * affliction added to that table is covered here without anybody remembering to come back.
   * The self-buffs (shadows, crystal ball, slowdown) have no clock and are not afflictions.
   */
  get afflicted(): boolean {
    return this.afflictionMs.some((ms) => ms > 0);
  }

  /** The two halves put back together, which is what the target list draws. */
  get roster(): EittrisRosterView[] {
    return this.identities.map((who, i) => ({
      ...who,
      alive: this.boardStates[i]?.alive ?? true,
      thumb: this.boardStates[i]?.thumb ?? "",
    }));
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
    super("EittrisClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire up the presenter's board pushes
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    // The board runs on this phone's own clock.  Nothing in here waits for the network.
    this.onTick.subscribe("EittrisClientSim", () => this.simulate());
    this.listenToEndpointFromPresenter(EittrisStartPlayingEndpoint, this.handleStartPlaying);
    this.listenToEndpointFromPresenter(EittrisDeliverSpecialEndpoint, this.handleDeliverSpecial);
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
      // A resync means a new game/round or a rejoin - drop any stale banner or flash
      this.lastSpecialEvent = null;
      this.hitPulses.clear();
      // The line-up comes with every onboard, so a phone that just joined or
      // reconnected can read the indexes in the thumbnail broadcasts that follow.
      if (response.roster) this.applyRoster(response.roster);
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
    // Once this phone is simulating its own board, a pushed board is out of date by
    // definition - it is the host's mirror of what we told it a moment ago.  Taking it
    // would undo whatever the player has done since.
    if (this.board) return;
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

  /** Mark a player as just-hit.  The seq is what makes a repeat hit a NEW flash. */
  private noteHit(victimId: string, repelled: boolean) {
    this._hitSeq++;
    runInAction(() => this.hitPulses.set(victimId, { seq: this._hitSeq, repelled }));
  }

  // -------------------------------------------------------------------
  // handleThumbnails - the shared everyone's-boards snapshot for the
  // target list (arrives ~1/s while boards change)
  // -------------------------------------------------------------------
  protected handleThumbnails = (message: EittrisThumbnailsMessage) => {
    action(() => {
      if (message.roster) this.applyRoster(message.roster);
      for (const entry of message.boards) {
        // An index with no identity behind it means this phone missed the roster it
        // belongs to.  Ignore it rather than drawing a nameless board; the next
        // line-up change - or a reconnect - brings the roster along with it.
        if (entry.i < 0 || entry.i >= this.identities.length) continue;
        this.boardStates[entry.i] = { alive: entry.alive, thumb: entry.thumb };
      }
    })();
  };

  // Replacing the line-up keeps each board's last known picture where the player is
  // still in the game, so nobody's thumbnail blinks out when somebody else joins.
  private applyRoster(roster: EittrisRosterEntry[]) {
    const previous = new Map(
      this.identities.map((who, i) => [who.playerId, this.boardStates[i]] as const),
    );
    this.identities = roster.slice();
    this.boardStates = roster.map(
      (who) => previous.get(who.playerId) ?? { alive: true, thumb: "" },
    );
  }

  // -------------------------------------------------------------------
  // handleSpecialEvent - somebody's special fired; flash it briefly
  // -------------------------------------------------------------------
  protected handleSpecialEvent = (message: EittrisSpecialEventMessage) => {
    // Everybody's hits flash on the target list, not just mine: watching your attack land
    // on the player you aimed at is most of the reason to aim at anybody.  A special
    // somebody kept for themselves is not an attack, so it does not flash.
    if (message.attackerId !== message.victimId) {
      this.noteHit(message.victimId, message.repelled);
    }

    // The BANNER, though, is only what happened TO ME.  Two other players trading powerups
    // across the room is noise on a phone the size of a playing card, and it crowds out the
    // one message that actually needs acting on.
    if (message.victimId !== this.playerId) return;
    // Getting hit is the loudest thing that happens to you, so it gets the
    // loudest buzz - and a shielded hit gets a lighter one, since the news is
    // good.  Phones stay silent otherwise: the shared screen has the speakers.
    SafeBrowser.vibrate(message.repelled ? VIBRATE_SHIELDED : VIBRATE_ATTACKED);
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
    // An absent grid means "unchanged since the last one you were sent" - the settled
    // stack is the biggest thing on the wire and it only changes when a piece locks,
    // so the presenter leaves it out of the updates in between.
    if (snapshot.grid !== undefined) this.gridString = snapshot.grid;
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
    // A clear that has just started: buzz for it, harder for a big one.  The
    // rows arrive once per clear, so this cannot fire twice for the same one.
    const clearingNow = snapshot.clearing;
    if (clearingNow && clearingNow.rows.length > 0) {
      const key = `${clearingNow.rows.join(",")}:${this.pieceSeq}`;
      if (key !== this._lastClearBuzz) {
        this._lastClearBuzz = key;
        SafeBrowser.vibrate(clearingNow.rows.length >= 4 ? VIBRATE_BIG_CLEAR : VIBRATE_CLEAR);
      }
    }
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
  // -------------------------------------------------------------------
  // The simulation this phone owns
  // -------------------------------------------------------------------
  private get simContext(): SimulationContext {
    return {
      settings: this.settings,
      random: () => Math.random(),
      // A phone can only see its own board.  SwitchScreens needs both boards, so it is
      // the one attack that stays with the host.
      boards: () => (this.board ? [this.board] : []),
      devFast: this.devFast,
      events: {
        changed: () => this.markReportDue(),
        locked: (_b, bumped) => {
          this.report({ kind: "locked", bumped });
          // A lock is felt through the phone; a slam gets the firmer buzz.
          SafeBrowser.vibrate(bumped ? VIBRATE_CLEAR : VIBRATE_CLEAR);
        },
        rowsCleared: (_b, count) => {
          this.report({ kind: "rowsCleared", count });
          SafeBrowser.vibrate(count >= 4 ? VIBRATE_BIG_CLEAR : VIBRATE_CLEAR);
        },
        clearCollapsed: () => this.markReportDue(),
        specialCollected: (_b, special) => this.report({ kind: "collected", special }),
        // Offensive powerups have to travel: this phone cannot reach its victim, so the
        // host is told who to hit and passes it along.
        fireSpecial: (b, special) =>
          this.report({ kind: "fire", special, targetId: b.targetId ?? null }),
        selfSpecial: (_b, special) => this.report({ kind: "selfSpecial", special }),
        afflictionEnded: (_b, types) => this.report({ kind: "afflictionEnded", types }),
        antidoteUsed: () => this.report({ kind: "antidoteUsed" }),
        jumbleNudge: () => this.report({ kind: "jumbleNudge" }),
        slammed: () => this.report({ kind: "slammed" }),
        died: () => {
          this.report({ kind: "died" });
          runInAction(() => (this.gameState = EittrisClientState.Dead));
        },
        persist: () => this.saveCheckpoint(),
      },
    };
  }

  // Called from the game clock.  Steps the board, mirrors it into the observables the
  // view reads, and tells the host what happened - at most once every REPORT_INTERVAL_MS.
  private simulate() {
    const board = this.board;
    if (!board) return;

    if (this._lastTickTime_ms < 0 || this._lastTickTime_ms > this.gameTime_ms) {
      this._lastTickTime_ms = this.gameTime_ms;
    }
    const dtMs = this.gameTime_ms - this._lastTickTime_ms;
    this._lastTickTime_ms = this.gameTime_ms;
    if (dtMs > 0 && board.alive) stepBoard(board, dtMs, this.simContext);

    this.mirrorBoard();
    this.maybeReport();
  }

  private markReportDue() {
    this._reportDue = true;
  }

  private report(event: EittrisReportEvent) {
    this._pendingEvents.push(event);
    this._reportDue = true;
  }

  // One message, no more often than REPORT_INTERVAL_MS, carrying the board and everything
  // that has happened since the last one.  The phone never waits for this.
  private maybeReport() {
    if (!this._reportDue || !this.board) return;
    if (
      this._lastReportTime_ms >= 0 &&
      this.gameTime_ms - this._lastReportTime_ms < REPORT_INTERVAL_MS
    ) {
      return;
    }
    this._lastReportTime_ms = this.gameTime_ms;
    this._reportDue = false;
    const events = this._pendingEvents;
    this._pendingEvents = [];

    const grid = encodeGrid(this.board.grid);
    const gridChanged = grid !== this._lastReportedGrid;
    if (gridChanged) this._lastReportedGrid = grid;

    this.session.sendMessageToPresenter(EittrisBoardReportEndpoint, {
      board: this.snapshotOfOwnBoard(gridChanged ? grid : undefined),
      events,
    });
  }

  // What the host needs to draw this board.  Deliberately the same shape the host used to
  // send the other way, so it can draw a reported board with the code it already had.
  private snapshotOfOwnBoard(grid: string | undefined): EittrisBoardSnapshot {
    const b = this.board!;
    return {
      grid,
      piece: b.piece ? { ...b.piece } : null,
      next: b.nextQueue.slice(0, b.crystalBall ? CRYSTAL_BALL_PREVIEW : NEXT_PREVIEW_COUNT),
      score: b.score,
      rows: b.rows,
      alive: b.alive,
      intervalMs: Math.round(effectiveIntervalMs(b.intervalMs, b.speedupStacks, b.slowdownStacks)),
      backgroundIndex: b.backgroundIndex,
      targetId: b.targetId,
      pieceSeq: b.pieceSeq,
      specials: b.specials.map((m) => ({ i: m.index, t: m.type })),
      antidotes: b.antidotes,
      speedupStacks: b.speedupStacks,
      slowdownStacks: b.slowdownStacks,
      seeShadows: b.seeShadows,
      crystalBall: b.crystalBall,
      evilPieces: b.evilPieces,
      crazyIvan: b.crazyIvan,
      freezeDried: b.freezeDried,
      transparency: b.transparency,
      afflictionMs: AFFLICTION_TIMERS.map((spec) => afflictionMsLeft(b, spec.type)),
      clearing: b.clearing ? { ...b.clearing, rows: b.clearing.rows.slice() } : null,
      psychoSeed: b.psychoSeed,
      psychoOverlay: b.psychoOverlay ? encodePsychoOverlay(b.psychoOverlay) : null,
      shieldMs: b.shieldMs,
      forcedSpecial: b.forcedSpecial,
      aiControlled: b.aiControlled,
    };
  }

  // Copy the board into the observables the view reads.  One place, so nothing on screen
  // can quietly disagree with the board it is drawn from.
  private mirrorBoard() {
    const b = this.board;
    if (!b) return;
    runInAction(() => {
      this.gridString = encodeGrid(b.grid);
      this.piece = b.piece;
      this.nextTypes = b.nextQueue.slice(
        0,
        b.crystalBall ? CRYSTAL_BALL_PREVIEW : NEXT_PREVIEW_COUNT,
      );
      this.score = b.score;
      this.rows = b.rows;
      this.alive = b.alive;
      this.intervalMs = effectiveIntervalMs(b.intervalMs, b.speedupStacks, b.slowdownStacks);
      this.backgroundIndex = b.backgroundIndex;
      this.pieceSeq = b.pieceSeq;
      this.targetId = b.targetId;
      this.specials = b.specials.map((m) => ({ i: m.index, t: m.type }));
      this.antidotes = b.antidotes;
      this.speedupStacks = b.speedupStacks;
      this.slowdownStacks = b.slowdownStacks;
      this.seeShadows = b.seeShadows;
      this.crystalBall = b.crystalBall;
      this.evilPieces = b.evilPieces;
      this.crazyIvan = b.crazyIvan;
      this.freezeDried = b.freezeDried;
      this.transparency = b.transparency;
      this.afflictionMs = AFFLICTION_TIMERS.map((spec) => afflictionMsLeft(b, spec.type));
      this.clearing = b.clearing ? { ...b.clearing, rows: b.clearing.rows.slice() } : null;
      this.psychoSeed = b.psychoSeed;
      this.psychoOverlay = b.psychoOverlay ? encodePsychoOverlay(b.psychoOverlay) : null;
      this.shieldMs = b.shieldMs;
      this.forcedSpecial = b.forcedSpecial;
      this.aiControlled = b.aiControlled;
    });
  }

  // -------------------------------------------------------------------
  // handleStartPlaying - the host says go.  From here the board is this phone's.
  // -------------------------------------------------------------------
  protected handleStartPlaying = (message: EittrisStartPlayingMessage) => {
    // A board in hand for THIS round is the real thing and must not be thrown away.  A
    // start-playing with no board means "make a fresh one", which is right at the start of
    // a round and catastrophic in the middle of one: the phone would start playing an
    // empty board and then report it upward, blanking the host's copy as well.  The round
    // number is what tells the two apart.
    //
    // Only a round actually IN PROGRESS is worth protecting, though.  Sitting on a finished
    // game there is nothing to lose and a new game to join, so the guard stands down - which
    // is also the belt-and-braces against ever being handed a repeated round number.
    const midRound =
      this.gameState === EittrisClientState.Playing || this.gameState === EittrisClientState.Dead;
    if (midRound && !message.board && this.board && message.round === this._round) return;

    runInAction(() => {
      this.settings = sanitizeSettings(message.settings);
      this._round = message.round ?? this._round;
      // A board in the message means this seat is being handed back - somebody rejoining
      // and taking over from the robot that kept it warm.  Adopt it exactly as it stands,
      // rather than starting them again from an empty grid.
      const board = message.board ?? makeBoard(this.playerId, Math.random, this.settings.speed);
      board.playerId = this.playerId;
      board.targetId = message.targetId;
      // A handed-back board may still be flagged for the robot that was playing it
      board.robotTakeover = false;
      board.aiControlled = this.aiControlled;
      board.forcedSpecial = this.forcedSpecial;
      this.board = board;
      this._lastTickTime_ms = this.gameTime_ms;
      this._lastReportTime_ms = -1;
      this._lastReportedGrid = "";
      this._pendingEvents = [];
      this.gameState = EittrisClientState.Playing;
      this.lastSpecialEvent = null;
      this.hitPulses.clear();
      this.winnerName = null;
      this.youWon = false;
    });
    this.mirrorBoard();
    this.markReportDue();
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // handleDeliverSpecial - an attack arrived.  It is applied THE MOMENT it lands: the
  // host is telling us, not asking us.  Whether our shield ate it goes back in the next
  // report, which is what the room gets told.
  // -------------------------------------------------------------------
  protected handleDeliverSpecial = (message: EittrisDeliverSpecialMessage) => {
    const board = this.board;
    if (!board || !board.alive) return;
    const repelled = applyIncomingSpecial(board, message.special as SpecialType, this.simContext);
    this.report({
      kind: "hit",
      special: message.special,
      attackerId: message.attackerId,
      repelled,
    });
    this.mirrorBoard();
    this.saveCheckpoint();
  };

  // Apply a gesture to my own board, right now, with no network in the way.  This is the
  // whole point of the refactor: the piece moves on the frame the finger moved.
  private sendCommand(message: EittrisCommandMessage) {
    if (this.gameState !== EittrisClientState.Playing || !this.board) return;
    applyCommand(this.board, message, this.simContext);
    this.mirrorBoard();
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

  // Fire a banked antidote.  Applied HERE, on this phone's own board - sending it to the
  // host spent a charge on the host's copy, which this phone's next report then overwrote,
  // so nothing was cured and the charge came back.  It also works during the post-lock
  // spawn gap, because curing has nothing to do with the falling piece.
  useAntidote() {
    if (!this.board || this.board.antidotes <= 0) return;
    spendAntidote(this.board, this.simContext);
    this.mirrorBoard();
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

  // Aim at somebody.  This is applied HERE, not sent as a command: the board belongs to
  // this phone, and a command would be handled on the host, which would then have its copy
  // overwritten by this phone's very next report - so nothing appeared to happen at all.
  // The choice rides upward with the board, and the host reads it when relaying an attack.
  pickTarget(targetId: string) {
    if (!this.board || targetId === this.playerId) return;
    // The roster is this phone's own view of the room, which is all it needs: aiming at
    // somebody who has gone out should do nothing.
    const target = this.roster.find((p) => p.playerId === targetId);
    if (!target || !target.alive) return;
    runInAction(() => {
      this.board!.targetId = targetId;
    });
    this.mirrorBoard();
    this.markReportDue();
    this.saveCheckpoint();
  }

  // Handy for the view: board dimensions without importing logic there
  get boardWidth() {
    return BOARD_WIDTH;
  }
  get boardHeight() {
    return BOARD_HEIGHT;
  }
}
