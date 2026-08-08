import { action, makeObservable, observable } from "mobx";
import {
  BATTLE_PUSH_MS,
  BATTLE_RESULT_HOLD_MS,
  DROP_PER_SECOND,
  PRICE_FLOOR,
  REVEAL_MS,
  ROUND_BUDGET,
  SCRAP_GRACE_MS,
  START_PRICE,
  VERIFY_WINDOW_MS,
  WINS_TO_WIN,
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
  PresenterGameEvent,
  GeneralGameState,
} from "libs";
import Logger from "js-logger";
import {
  BidBotsAuctionResultEndpoint,
  BidBotsAuctionStartEndpoint,
  BidBotsBattleStartEndpoint,
  BidBotsBattleUpdateEndpoint,
  BidBotsBuyEndpoint,
  BidBotsBuyRequest,
  BidBotsBuyResponse,
  BidBotsOnboardEndpoint,
  BidBotsOnboardResponse,
  BidBotsRoundResultEndpoint,
  BotView,
  ScoreRow,
} from "./bidBotsEndpoints";
import {
  BattleLog,
  BuyBid,
  battleDurationMs,
  canAfford,
  checkChampion,
  eventsElapsed,
  Fighter,
  fightersPerRound,
  generateFighters,
  hpAfter,
  isScrapReady,
  priceAt,
  resolveBuyContest,
  resolveBattle,
} from "./bidBotsLogic";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";

// The presenter's record for one player.  bank + wins are plain fields (not @observable): the
// presenter UI never reads them directly, it reads the `scoreboard` observable array the model
// rebuilds on every change - which sidesteps the MobX quirk that @observable fields on a
// ClusterFunPlayer subclass are inert (see clusterfun-client/CLAUDE.md).  Plain fields still
// serialize into the checkpoint.
export class BidBotsPlayer extends ClusterFunPlayer {
  bank = 0;
  wins = 0;
}

// -------------------------------------------------------------------
// Presenter game states (on top of the framework's Gathering / GameOver / Paused).
// -------------------------------------------------------------------
export enum BidBotsGameState {
  Auction = "Auction",
  Battle = "Battle",
  RoundResult = "RoundResult",
}

// Sub-phase of the auction while a single bot is on the block.
export enum BidBotsAuctionPhase {
  Bidding = "bidding", // price falling, waiting for a BUY
  Verifying = "verifying", // first BUY landed; collecting near-simultaneous taps (suspense)
  Revealing = "revealing", // SOLD / SCRAPPED shown before the next bot
}

// -------------------------------------------------------------------
// Game events - views subscribe for sounds / animation.
// -------------------------------------------------------------------
export enum BidBotsGameEvent {
  BidPlaced = "BidPlaced",
  BotSold = "BotSold",
  BotScrapped = "BotScrapped",
  BattleHit = "BattleHit",
  RoundWon = "RoundWon",
  ChampionAnnounced = "ChampionAnnounced",
}

// -------------------------------------------------------------------
// Type helper for save/restore.  Register every custom class + rehydrate
// the observable arrays.
// -------------------------------------------------------------------
export const getBidBotsPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "BidBotsPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case BidBotsPresenterModel:
          return "BidBotsPresenterModel";
        case BidBotsPlayer:
          return "BidBotsPlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "BidBotsPresenterModel":
          return new BidBotsPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "BidBotsPlayer":
          return new BidBotsPlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof BidBotsPresenterModel) {
        // Transient auction bookkeeping - safe to drop, rebuilt on the next tick.
        const skip = ["_pendingBids"];
        if (skip.indexOf(propertyName) !== -1) return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      if (typeName === "BidBotsPresenterModel") {
        switch (propertyName) {
          case "fighters":
            return observable(rehydratedObject as Fighter[]);
          case "scoreboard":
            return observable(rehydratedObject as ScoreRow[]);
        }
      }
      return rehydratedObject;
    },
  };
};

// ===================================================================
// The presenter - the single source of truth for the auction and the battle.
// ===================================================================
export class BidBotsPresenterModel extends ClusterfunPresenterModel<BidBotsPlayer> {
  // This round's lineup, in auction order.  Plain objects in an observable array (deep
  // observability) so mutating ownerId / hp re-renders the presenter without a Player subclass.
  fighters = observable<Fighter>([]);

  // A live leaderboard snapshot the views read (see BidBotsPlayer for why).
  scoreboard = observable<ScoreRow>([]);

  // --- Auction state ---
  @observable auctionPhase: BidBotsAuctionPhase = BidBotsAuctionPhase.Bidding;
  @observable currentBotIndex = 0;
  @observable displayPrice = START_PRICE; // the price shown on the big screen right now
  @observable frozenPrice = -1; // locked in when the first BUY lands (-1 while bidding)
  @observable lastSoldWinnerId: string | null = null;
  @observable lastSoldPrice = 0;
  @observable lastSoldScrapped = false;

  private _bidStartTime_ms = 0; // gameTime when the current bot's bidding opened
  private _verifyDeadline_ms = 0;
  private _revealDeadline_ms = 0;
  private _pendingBids: BuyBid[] = []; // BUYs collected during the verify window
  private _receiveCounter = 0;

  // --- Battle state ---
  battleLog: BattleLog = { events: [], winnerId: null };
  @observable battleDuration_ms = 0;
  @observable battleEventsApplied = 0; // drives the presenter's hit flash
  private _battleStartTime_ms = 0;
  private _lastPushMs = 0;

  // --- Round / game result ---
  @observable roundWinnerId: string | null = null;
  @observable championId: string | null = null;
  private _roundResultDeadline_ms = 0;

  // ---------------- computed views ----------------
  get currentBot(): Fighter | null {
    return this.fighters[this.currentBotIndex] ?? null;
  }

  get ownedFighters(): Fighter[] {
    return this.fighters.filter((f) => f.ownerId !== null);
  }

  get champion(): BidBotsPlayer | null {
    return this.championId ? (this.playerById(this.championId) ?? null) : null;
  }

  playerName(id: string | null): string | null {
    if (!id) return null;
    return this.playerById(id)?.name ?? null;
  }

  botView(f: Fighter): BotView {
    return {
      id: f.id,
      seq: f.seq,
      name: f.name,
      botType: f.botType,
      maxHp: f.maxHp,
      hp: f.hp,
      str: f.str,
      def: f.def,
      ownerId: f.ownerId,
      ownerName: this.playerName(f.ownerId),
    };
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("BidBots", sessionHelper, logger, storage);
    Logger.info(`Constructing BidBotsPresenterModel ${this.gameState}`);

    // New players may arrive while gathering OR mid-round (they spectate until the next
    // auction).  Rejoin of an existing player works in any state regardless.
    this.allowedJoinStates = [
      PresenterGameState.Gathering,
      BidBotsGameState.Auction,
      BidBotsGameState.Battle,
      BidBotsGameState.RoundResult,
    ];

    this.minPlayers = 2;
    this.maxPlayers = 8;

    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire listeners (runs fresh AND after a restore)
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpoint(BidBotsOnboardEndpoint, this.handleOnboard);
    this.listenToEndpoint(BidBotsBuyEndpoint, this.handleBuy);
    // The base adds the player to `players` before firing this, so the roster is
    // complete when we rebuild the scoreboard.
    this.subscribe(PresenterGameEvent.PlayerJoined, "BidBots roster refresh", () =>
      this.refreshScoreboard(),
    );
  }

  // -------------------------------------------------------------------
  // createFreshPlayerEntry - a mid-round joiner starts with an empty bank
  // (bank 0 => they spectate) and gets ROUND_BUDGET at the next startNextRound.
  // -------------------------------------------------------------------
  createFreshPlayerEntry(name: string, id: string): BidBotsPlayer {
    const p = new BidBotsPlayer();
    p.playerId = id;
    p.name = name;
    p.bank = 0;
    p.wins = 0;
    // The scoreboard is rebuilt from the PlayerJoined event (see reconstitute), by which
    // point the base class has added this player to `players`.
    return p;
  }

  // -------------------------------------------------------------------
  //  onPlayerReturned - nothing to migrate.  bank/wins/bots key on the stable
  //  playerId, so a reconnecting player comes back to exactly their standing;
  //  the phone re-onboards itself.  We only refresh the roster so they stop
  //  showing greyed out.
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: BidBotsPlayer, _info: ReconnectInfo) {
    this.refreshScoreboard();
  }

  // -------------------------------------------------------------------
  //  onPlayerDisconnected - keep their seat, bank, wins, and any bots (their
  //  bots still fight).  Just grey them out on the roster.
  // -------------------------------------------------------------------
  protected onPlayerDisconnected(_player: BidBotsPlayer) {
    this.refreshScoreboard();
  }

  // -------------------------------------------------------------------
  // refreshScoreboard - rebuild the live leaderboard the views observe.
  // -------------------------------------------------------------------
  refreshScoreboard() {
    const rows: ScoreRow[] = this.players
      .map((p) => ({
        playerId: p.playerId,
        name: p.name,
        avatarId: p.avatarId,
        avatarColor: p.avatarColor,
        wins: p.wins,
        bank: p.bank,
        isConnected: p.isConnected,
      }))
      .sort((a, b) => b.wins - a.wins || b.bank - a.bank || (a.name < b.name ? -1 : 1));
    action(() => this.scoreboard.replace(rows))();
  }

  // -------------------------------------------------------------------
  // prepareFreshGame - reset everything for a brand new game.
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
    this.championId = null;
    this.roundWinnerId = null;
    this.fighters.clear();
    this.players.forEach((p) => {
      p.bank = 0;
      p.wins = 0;
    });
    this.refreshScoreboard();
  };

  // -------------------------------------------------------------------
  // prepareFreshRound - the framework calls this once before startNextRound at
  // game start; the real per-round setup lives in startNextRound so it also runs
  // for rounds 2..N.  Keep this to the transient auction flags.
  // -------------------------------------------------------------------
  prepareFreshRound = () => {
    this.auctionPhase = BidBotsAuctionPhase.Bidding;
    this.frozenPrice = -1;
    this._pendingBids = [];
  };

  // -------------------------------------------------------------------
  // startNextRound - top up banks, deal a new lineup, open the auction.
  // -------------------------------------------------------------------
  startNextRound = () => {
    this.currentRound++;
    // Everyone present gets this round's budget on top of whatever they banked.
    this.players.forEach((p) => (p.bank += ROUND_BUDGET));

    const count = fightersPerRound(this.connectedPlayers.length || this.players.length);
    const rand = () => this.randomDouble(1.0);
    this.fighters.replace(generateFighters(this.currentRound, count, rand));

    this.currentBotIndex = 0;
    this.roundWinnerId = null;
    this.lastSoldWinnerId = null;
    this.lastSoldScrapped = false;
    this.gameState = BidBotsGameState.Auction;
    this.refreshScoreboard();

    // Clients rebuild into the auction (or spectator) view, then the first bot opens.
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.openBiddingForCurrentBot();
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  // openBiddingForCurrentBot - put the current bot on the block.
  // -------------------------------------------------------------------
  openBiddingForCurrentBot() {
    const bot = this.currentBot;
    if (!bot) {
      this.startBattle();
      return;
    }
    this.auctionPhase = BidBotsAuctionPhase.Bidding;
    this.frozenPrice = -1;
    this.displayPrice = START_PRICE;
    this._bidStartTime_ms = this.gameTime_ms;
    this._pendingBids = [];

    this.sendToEveryone(BidBotsAuctionStartEndpoint, () => ({
      round: this.currentRound,
      bot: this.botView(bot),
      startPrice: START_PRICE,
      dropPerSecond: DROP_PER_SECOND,
      priceFloor: PRICE_FLOOR,
      index: this.currentBotIndex,
      total: this.fighters.length,
    }));
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleTick - drive every timed transition.
  // -------------------------------------------------------------------
  handleTick() {
    const now = this.gameTime_ms;
    switch (this.gameState) {
      case BidBotsGameState.Auction:
        this.tickAuction(now);
        break;
      case BidBotsGameState.Battle:
        this.tickBattle(now);
        break;
      case BidBotsGameState.RoundResult:
        if (now >= this._roundResultDeadline_ms) this.advanceAfterRound();
        break;
    }
  }

  private tickAuction(now: number) {
    if (this.auctionPhase === BidBotsAuctionPhase.Bidding) {
      const elapsed = now - this._bidStartTime_ms;
      const price = priceAt(START_PRICE, DROP_PER_SECOND, PRICE_FLOOR, elapsed);
      if (price !== this.displayPrice) action(() => (this.displayPrice = price))();
      if (isScrapReady(elapsed, START_PRICE, DROP_PER_SECOND, PRICE_FLOOR, SCRAP_GRACE_MS)) {
        this.scrapCurrentBot();
      }
    } else if (this.auctionPhase === BidBotsAuctionPhase.Verifying) {
      if (now >= this._verifyDeadline_ms) this.awardCurrentBot();
    } else if (this.auctionPhase === BidBotsAuctionPhase.Revealing) {
      if (now >= this._revealDeadline_ms) this.nextBotOrBattle();
    }
  }

  // -------------------------------------------------------------------
  // handleBuy - a phone tapped BUY.  The FIRST valid buy freezes the price and
  // opens the verification window (the on-screen suspense beat); later taps in
  // the window are collected.  The award happens when the window closes.
  // -------------------------------------------------------------------
  handleBuy = (sender: string, req: BidBotsBuyRequest): BidBotsBuyResponse => {
    if (this.gameState !== BidBotsGameState.Auction) {
      return { received: false, reason: "The auction is not open", previewPrice: -1 };
    }
    const bot = this.currentBot;
    if (!bot || bot.id !== req.botId) {
      return { received: false, reason: "Too late - next bot!", previewPrice: this.frozenPrice };
    }
    if (this.auctionPhase === BidBotsAuctionPhase.Revealing) {
      return { received: false, reason: "Already sold", previewPrice: this.frozenPrice };
    }
    const player = this.playerById(sender);
    if (!player) {
      Logger.warn("BidBots buy from unknown sender " + sender);
      return { received: false, reason: "Unknown player", previewPrice: -1 };
    }

    const now = this.gameTime_ms;
    const priceNow =
      this.auctionPhase === BidBotsAuctionPhase.Bidding
        ? priceAt(START_PRICE, DROP_PER_SECOND, PRICE_FLOOR, now - this._bidStartTime_ms)
        : this.frozenPrice;

    if (!canAfford(player.bank, priceNow)) {
      return { received: false, reason: "Not enough money", previewPrice: priceNow };
    }

    // First valid buy: freeze the price and open the window.
    if (this.auctionPhase === BidBotsAuctionPhase.Bidding) {
      action(() => {
        this.frozenPrice = priceNow;
        this.displayPrice = priceNow;
        this.auctionPhase = BidBotsAuctionPhase.Verifying;
      })();
      this._verifyDeadline_ms = now + VERIFY_WINDOW_MS;
      this._pendingBids = [];
    }

    this._pendingBids.push({
      playerId: sender,
      clientTapMs: req.clientTapMs,
      receiveOrder: this._receiveCounter++,
    });
    this.invokeEvent(BidBotsGameEvent.BidPlaced, player);
    this.saveCheckpoint();
    return { received: true, previewPrice: this.frozenPrice };
  };

  // -------------------------------------------------------------------
  // awardCurrentBot - the verify window closed: pick the winner and reveal.
  // -------------------------------------------------------------------
  awardCurrentBot() {
    const bot = this.currentBot;
    if (!bot) return;

    // Only bids that can still cover the frozen price are eligible.
    const eligible = this._pendingBids.filter((b) => {
      const p = this.playerById(b.playerId);
      return p && canAfford(p.bank, this.frozenPrice);
    });
    const winnerId = resolveBuyContest(eligible);

    action(() => {
      if (winnerId) {
        const winner = this.playerById(winnerId)!;
        winner.bank -= this.frozenPrice;
        bot.ownerId = winnerId;
        this.lastSoldWinnerId = winnerId;
        this.lastSoldPrice = this.frozenPrice;
        this.lastSoldScrapped = false;
        this.invokeEvent(BidBotsGameEvent.BotSold, { bot, winner });
      } else {
        this.lastSoldWinnerId = null;
        this.lastSoldScrapped = true;
        this.lastSoldPrice = 0;
        this.invokeEvent(BidBotsGameEvent.BotScrapped, bot);
      }
      this.auctionPhase = BidBotsAuctionPhase.Revealing;
    })();

    this._revealDeadline_ms = this.gameTime_ms + REVEAL_MS;
    this._pendingBids = [];
    this.refreshScoreboard();
    this.announceAuctionResult(bot);
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // scrapCurrentBot - the price bottomed out with no buyer.
  // -------------------------------------------------------------------
  scrapCurrentBot() {
    const bot = this.currentBot;
    if (!bot) return;
    action(() => {
      this.lastSoldWinnerId = null;
      this.lastSoldScrapped = true;
      this.lastSoldPrice = 0;
      this.auctionPhase = BidBotsAuctionPhase.Revealing;
    })();
    this._revealDeadline_ms = this.gameTime_ms + REVEAL_MS;
    this.invokeEvent(BidBotsGameEvent.BotScrapped, bot);
    this.announceAuctionResult(bot);
    this.saveCheckpoint();
  }

  private announceAuctionResult(bot: Fighter) {
    this.sendToEveryone(BidBotsAuctionResultEndpoint, () => ({
      botId: bot.id,
      winnerId: this.lastSoldWinnerId,
      winnerName: this.playerName(this.lastSoldWinnerId),
      price: this.lastSoldPrice,
      scrapped: this.lastSoldScrapped,
      scoreboard: this.scoreboard.slice(),
    }));
  }

  // -------------------------------------------------------------------
  // nextBotOrBattle - advance the auction, or start the fight.
  // -------------------------------------------------------------------
  nextBotOrBattle() {
    if (this.currentBotIndex + 1 < this.fighters.length) {
      action(() => this.currentBotIndex++)();
      this.openBiddingForCurrentBot();
    } else {
      this.startBattle();
    }
  }

  // -------------------------------------------------------------------
  // startBattle - resolve the whole brawl up front, then play it back.
  // -------------------------------------------------------------------
  startBattle() {
    action(() => {
      this.fighters.forEach((f) => (f.hp = f.maxHp));
      const rand = () => this.randomDouble(1.0);
      this.battleLog = resolveBattle(this.ownedFighters, rand);
      this.battleDuration_ms = battleDurationMs(this.battleLog.events.length);
      this.battleEventsApplied = 0;
      this.gameState = BidBotsGameState.Battle;
    })();
    this._battleStartTime_ms = this.gameTime_ms;
    this._lastPushMs = this.gameTime_ms;

    this.sendToEveryone(BidBotsBattleStartEndpoint, () => ({
      round: this.currentRound,
      roster: this.ownedFighters.map((f) => this.botView(f)),
    }));
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private tickBattle(now: number) {
    const elapsed = now - this._battleStartTime_ms;
    const total = this.battleLog.events.length;
    const n = eventsElapsed(total, this.battleDuration_ms, elapsed);

    const hp = hpAfter(this.fighters.slice(), this.battleLog.events, n);
    action(() => {
      this.fighters.forEach((f) => {
        const h = hp.get(f.id);
        if (h !== undefined && f.hp !== h) f.hp = h;
      });
      if (n !== this.battleEventsApplied) {
        this.battleEventsApplied = n;
        this.invokeEvent(BidBotsGameEvent.BattleHit, n);
      }
    })();

    if (now - this._lastPushMs >= BATTLE_PUSH_MS || elapsed >= this.battleDuration_ms) {
      this._lastPushMs = now;
      this.sendToEveryone(BidBotsBattleUpdateEndpoint, () => ({
        hps: this.ownedFighters.map((f) => ({ id: f.id, hp: f.hp })),
      }));
    }

    if (elapsed >= this.battleDuration_ms) this.finishBattle();
  }

  // -------------------------------------------------------------------
  // finishBattle - settle the round: award the win, check for a champion.
  // -------------------------------------------------------------------
  finishBattle() {
    // Snap everything to the final state.
    const hp = hpAfter(this.fighters.slice(), this.battleLog.events, this.battleLog.events.length);
    action(() => {
      this.fighters.forEach((f) => {
        const h = hp.get(f.id);
        if (h !== undefined) f.hp = h;
      });
      this.roundWinnerId = this.battleLog.winnerId;
    })();

    if (this.roundWinnerId) {
      const winner = this.playerById(this.roundWinnerId);
      if (winner) {
        winner.wins++;
        this.refreshScoreboard();
        this.invokeEvent(BidBotsGameEvent.RoundWon, winner);
      }
    }
    action(() => (this.championId = checkChampion(this.players.slice(), WINS_TO_WIN)))();

    this.gameState = BidBotsGameState.RoundResult;
    this._roundResultDeadline_ms = this.gameTime_ms + BATTLE_RESULT_HOLD_MS;

    this.sendToEveryone(BidBotsRoundResultEndpoint, () => ({
      round: this.currentRound,
      winnerId: this.roundWinnerId,
      winnerName: this.playerName(this.roundWinnerId),
      scoreboard: this.scoreboard.slice(),
      championId: this.championId,
      championName: this.playerName(this.championId),
    }));
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // advanceAfterRound - crown the champion, or deal the next round.
  // -------------------------------------------------------------------
  advanceAfterRound() {
    if (this.championId) {
      this.finishGame();
    } else {
      this.startNextRound();
    }
  }

  // -------------------------------------------------------------------
  // finishGame - announce the champion and tell every client.
  // -------------------------------------------------------------------
  finishGame() {
    this.gameState = GeneralGameState.GameOver;
    this.invokeEvent(BidBotsGameEvent.ChampionAnnounced, this.champion);
    this.requestEveryone(GameOverEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // handleOnboard - full state for one phone (join / rejoin / invalidate).
  // -------------------------------------------------------------------
  handleOnboard = (sender: string, _message: unknown): BidBotsOnboardResponse => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    const player = this.playerById(sender);
    const myBots = this.fighters.filter((f) => f.ownerId === sender).map((f) => this.botView(f));
    const bank = player?.bank ?? 0;
    const inRound =
      this.gameState === BidBotsGameState.Auction || this.gameState === BidBotsGameState.Battle;
    const isSpectating = inRound && bank === 0 && myBots.length === 0;

    const bidElapsed =
      this.auctionPhase === BidBotsAuctionPhase.Bidding
        ? this.gameTime_ms - this._bidStartTime_ms
        : 0;

    return {
      gameState: this.gameState,
      round: this.currentRound,
      winsToWin: WINS_TO_WIN,
      bank,
      isSpectating,
      scoreboard: this.scoreboard.slice(),
      auctionPhase: this.gameState === BidBotsGameState.Auction ? this.auctionPhase : "",
      currentBot: this.currentBot ? this.botView(this.currentBot) : null,
      startPrice: START_PRICE,
      dropPerSecond: DROP_PER_SECOND,
      priceFloor: PRICE_FLOOR,
      bidElapsedMs: Math.max(0, bidElapsed),
      frozenPrice: this.frozenPrice,
      lastSoldWinnerName: this.playerName(this.lastSoldWinnerId),
      lastSoldPrice: this.lastSoldPrice,
      myBots,
      battleWinnerId: this.roundWinnerId,
      battleWinnerName: this.playerName(this.roundWinnerId),
      championId: this.championId,
      championName: this.playerName(this.championId),
    };
  };
}
