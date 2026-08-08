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
import { DROP_PER_SECOND, PRICE_FLOOR, START_PRICE, WINS_TO_WIN } from "./GameSettings";
import { priceAt } from "./bidBotsLogic";
import { BidBotsGameState } from "./PresenterModel";
import {
  BidBotsAuctionResultEndpoint,
  BidBotsAuctionResultMessage,
  BidBotsAuctionStartEndpoint,
  BidBotsAuctionStartMessage,
  BidBotsBattleStartEndpoint,
  BidBotsBattleStartMessage,
  BidBotsBattleUpdateEndpoint,
  BidBotsBattleUpdateMessage,
  BidBotsBuyEndpoint,
  BidBotsOnboardEndpoint,
  BidBotsRoundResultEndpoint,
  BidBotsRoundResultMessage,
  BotView,
  ScoreRow,
} from "./bidBotsEndpoints";

// -------------------------------------------------------------------
// Type helper for save/restore.
// -------------------------------------------------------------------
export const getBidBotsClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "BidBotsClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case BidBotsClientModel:
          return "BidBotsClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "BidBotsClientModel":
          return new BidBotsClientModel(
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
        case "scoreboard":
          return observable(rehydratedObject as ScoreRow[]);
        case "myBots":
          return observable(rehydratedObject as BotView[]);
      }
      return rehydratedObject;
    },
  };
};

// Client-side states - one per phone screen.
export enum BidBotsClientState {
  Auction = "Auction",
  Battle = "Battle",
  RoundResult = "RoundResult",
}

// ===================================================================
// The client - a thin controller.  It shows the current bot + price and sends
// BUYs; the presenter owns the auction and the battle.
// ===================================================================
export class BidBotsClientModel extends ClusterfunClientModel {
  @observable round = 0;
  @observable winsToWin = WINS_TO_WIN;
  @observable bank = 0;
  @observable isSpectating = false;
  scoreboard = observable<ScoreRow>([]);

  // --- Auction ---
  @observable auctionPhase = "";
  @observable currentBot: BotView | null = null;
  @observable displayPrice = START_PRICE; // smooth local countdown (cosmetic)
  @observable frozenPrice = -1;
  @observable lastSoldWinnerName: string | null = null;
  @observable lastSoldPrice = 0;
  @observable hasBidCurrentBot = false; // I have tapped BUY on the bot currently up
  @observable buyPending = false;
  @observable buyMessage = "";

  private _startPrice = START_PRICE;
  private _dropPerSecond = DROP_PER_SECOND;
  private _priceFloor = PRICE_FLOOR;
  private _bidStartLocalMs = 0; // gameTime_ms when the current bot opened (our clock)

  // --- Battle ---
  myBots = observable<BotView>([]);
  @observable battleWinnerName: string | null = null;
  @observable roundWinnerIsMe = false;

  // --- Champion ---
  @observable championName: string | null = null;
  @observable iAmChampion = false;

  // Can this phone place a bid right now?
  get canBuy(): boolean {
    return (
      !!this.currentBot &&
      !this.isSpectating &&
      !this.hasBidCurrentBot &&
      this.displayPrice <= this.bank
    );
  }

  get myWins(): number {
    return this.scoreboard.find((r) => r.playerId === this.playerId)?.wins ?? 0;
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
    super("BidBotsClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // reconstitute - wire presenter push listeners + the local price ticker.
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(BidBotsAuctionStartEndpoint, this.handleAuctionStart);
    this.listenToEndpointFromPresenter(BidBotsAuctionResultEndpoint, this.handleAuctionResult);
    this.listenToEndpointFromPresenter(BidBotsBattleStartEndpoint, this.handleBattleStart);
    this.listenToEndpointFromPresenter(BidBotsBattleUpdateEndpoint, this.handleBattleUpdate);
    this.listenToEndpointFromPresenter(BidBotsRoundResultEndpoint, this.handleRoundResult);

    // Animate the falling price locally so the phone feels live without per-tick traffic.
    // Authoritative price is always the presenter's; this is only what the player sees.
    this.onTick.subscribe("price countdown", () => {
      if (this.gameState !== BidBotsClientState.Auction) return;
      if (this.auctionPhase !== "bidding" || !this.currentBot) return;
      const p = priceAt(
        this._startPrice,
        this._dropPerSecond,
        this._priceFloor,
        this.gameTime_ms - this._bidStartLocalMs,
      );
      if (p !== this.displayPrice) action(() => (this.displayPrice = p))();
    });
  }

  // -------------------------------------------------------------------
  // requestGameStateFromPresenter - full rebuild from the onboard response.
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const r = await this.session.requestPresenter(BidBotsOnboardEndpoint, {});
    action(() => {
      this.round = r.round;
      this.roundNumber = r.round;
      this.winsToWin = r.winsToWin;
      this.bank = r.bank;
      this.isSpectating = r.isSpectating;
      this.scoreboard.replace(r.scoreboard);

      this.auctionPhase = r.auctionPhase;
      this.currentBot = r.currentBot;
      this._startPrice = r.startPrice;
      this._dropPerSecond = r.dropPerSecond;
      this._priceFloor = r.priceFloor;
      this._bidStartLocalMs = this.gameTime_ms - r.bidElapsedMs;
      this.frozenPrice = r.frozenPrice;
      this.displayPrice =
        r.frozenPrice >= 0
          ? r.frozenPrice
          : priceAt(r.startPrice, r.dropPerSecond, r.priceFloor, r.bidElapsedMs);
      this.lastSoldWinnerName = r.lastSoldWinnerName;
      this.lastSoldPrice = r.lastSoldPrice;

      this.myBots.replace(r.myBots);
      this.battleWinnerName = r.battleWinnerName;
      this.roundWinnerIsMe = !!r.battleWinnerId && r.battleWinnerId === this.playerId;
      this.championName = r.championName;
      this.iAmChampion = !!r.championId && r.championId === this.playerId;

      // A fresh onboard is a clean slate for the current bot's bid state unless we already
      // own it (owning is reflected via myBots/bank, not this flag).
      this.hasBidCurrentBot = false;
      this.buyPending = false;

      switch (r.gameState) {
        case BidBotsGameState.Auction:
          this.gameState = BidBotsClientState.Auction;
          break;
        case BidBotsGameState.Battle:
          this.gameState = BidBotsClientState.Battle;
          break;
        case BidBotsGameState.RoundResult:
          this.gameState = BidBotsClientState.RoundResult;
          break;
        case GeneralGameState.GameOver:
          this.gameState = GeneralGameState.GameOver;
          break;
        default:
          Logger.debug(`Presenter is in state: ${r.gameState}`);
          this.gameState = GeneralClientGameState.WaitingToStart;
          break;
      }
    })();
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // buy - tap BUY on the bot currently up for auction.
  // -------------------------------------------------------------------
  async buy(): Promise<void> {
    const bot = this.currentBot;
    if (!bot || this.isSpectating || this.hasBidCurrentBot) return;
    if (this.displayPrice > this.bank) return;

    action(() => {
      this.hasBidCurrentBot = true;
      this.buyPending = true;
      this.buyMessage = "BID PLACED…";
    })();

    try {
      const res = await this.session.requestPresenter(BidBotsBuyEndpoint, {
        botId: bot.id,
        clientTapMs: Date.now(),
      });
      action(() => {
        this.buyPending = false;
        if (!res.received) {
          this.buyMessage = res.reason ?? "Too late";
          this.hasBidCurrentBot = false;
        } else {
          this.buyMessage = "BID PLACED…";
        }
      })();
    } catch (e) {
      action(() => {
        this.buyPending = false;
        this.hasBidCurrentBot = false;
        this.buyMessage = "Try again";
      })();
    }
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // Push handlers
  // -------------------------------------------------------------------
  handleAuctionStart = (msg: BidBotsAuctionStartMessage) => {
    action(() => {
      this.round = msg.round;
      this.currentBot = msg.bot;
      this._startPrice = msg.startPrice;
      this._dropPerSecond = msg.dropPerSecond;
      this._priceFloor = msg.priceFloor;
      this._bidStartLocalMs = this.gameTime_ms;
      this.displayPrice = msg.startPrice;
      this.frozenPrice = -1;
      this.auctionPhase = "bidding";
      this.hasBidCurrentBot = false;
      this.buyPending = false;
      this.buyMessage = "";
      this.lastSoldWinnerName = null;
      if (this.gameState !== BidBotsClientState.Auction) {
        this.gameState = BidBotsClientState.Auction;
      }
    })();
    this.saveCheckpoint();
  };

  handleAuctionResult = (msg: BidBotsAuctionResultMessage) => {
    action(() => {
      this.auctionPhase = "revealing";
      this.frozenPrice = msg.price;
      this.lastSoldWinnerName = msg.winnerName;
      this.lastSoldPrice = msg.price;
      this.scoreboard.replace(msg.scoreboard);
      const myRow = msg.scoreboard.find((r) => r.playerId === this.playerId);
      if (myRow) this.bank = myRow.bank;
      this.buyPending = false;
      // Keep hasBidCurrentBot latched so a losing bidder can't re-tap the dead bot.
    })();
    this.saveCheckpoint();
  };

  handleBattleStart = (msg: BidBotsBattleStartMessage) => {
    action(() => {
      this.round = msg.round;
      this.myBots.replace(msg.roster.filter((b) => b.ownerId === this.playerId));
      this.battleWinnerName = null;
      this.roundWinnerIsMe = false;
      this.currentBot = null;
      this.gameState = BidBotsClientState.Battle;
    })();
    this.saveCheckpoint();
  };

  handleBattleUpdate = (msg: BidBotsBattleUpdateMessage) => {
    action(() => {
      for (const { id, hp } of msg.hps) {
        const bot = this.myBots.find((b) => b.id === id);
        if (bot) bot.hp = hp;
      }
    })();
  };

  handleRoundResult = (msg: BidBotsRoundResultMessage) => {
    action(() => {
      this.battleWinnerName = msg.winnerName;
      this.roundWinnerIsMe = !!msg.winnerId && msg.winnerId === this.playerId;
      this.scoreboard.replace(msg.scoreboard);
      this.championName = msg.championName;
      this.iAmChampion = !!msg.championId && msg.championId === this.playerId;
      this.gameState = BidBotsClientState.RoundResult;
    })();
    this.saveCheckpoint();
  };
}
