import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import {
  BidBotsPresenterModel,
  BidBotsAuctionPhase,
  BidBotsGameState,
  BidBotsPlayer,
  getBidBotsPresenterTypeHelper,
} from "./PresenterModel";
import {
  PRICE_FLOOR,
  REVEAL_MS,
  ROUND_BUDGET,
  SCRAP_GRACE_MS,
  START_PRICE,
  VERIFY_WINDOW_MS,
} from "./GameSettings";
import { priceAt } from "./bidBotsLogic";

// -------------------------------------------------------------------
// Drives the real presenter model through its handlers + handleTick, advancing
// gameTime_ms by hand.  We skip reconstitute() (it starts a ticker and wires the
// relay); the handlers under test only touch the session, so a recording stub is
// enough.  saveCheckpoint() is a no-op without a serializer (guarded in the base).
// -------------------------------------------------------------------

interface SentMessage {
  route: string;
  receiverId: string;
  message: any;
}

function makeFakeSession(sent: SentMessage[]): ISessionHelper {
  const fake: Partial<ISessionHelper> = {
    roomId: "ROOM1",
    personalId: "PRESENTER",
    personalSecret: "secret",
    sendMessage: (endpoint, receiverId, message) => {
      sent.push({ route: (endpoint as any).route, receiverId, message });
    },
    listen: (() => ({ unsubscribe: () => {} })) as any,
    listenPresenter: (() => ({ unsubscribe: () => {} })) as any,
    request: (() => Promise.resolve(undefined)) as any,
    requestPresenter: (() => Promise.resolve(undefined)) as any,
    sendMessageToPresenter: () => {},
    addClosedListener: () => {},
    removeClosedListener: () => {},
    onError: () => {},
    serverCall: (() => Promise.resolve(undefined)) as any,
    stats: { sentCount: 0, bytesSent: 0, recievedCount: 0, bytesRecieved: 0 },
  };
  return fake as ISessionHelper;
}

function makeModel() {
  const sent: SentMessage[] = [];
  const session = makeFakeSession(sent);
  const logger = new MockTelemetryLogger("test");
  const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} };
  const model = new BidBotsPresenterModel(session, logger, storage);
  return { model, sent };
}

function addPlayer(model: BidBotsPresenterModel, id: string, name: string): BidBotsPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  p.isConnected = true;
  p.connectionId = id;
  runInAction(() => model.players.push(p));
  model.refreshScoreboard();
  return p;
}

function setTime(model: BidBotsPresenterModel, ms: number) {
  model.gameTime_ms = ms;
}

describe("BidBotsPresenterModel — round setup", () => {
  it("deals a lineup, budgets every bank, and opens the auction", () => {
    const { model } = makeModel();
    const a = addPlayer(model, "A", "Alice");
    const b = addPlayer(model, "B", "Bob");
    model.prepareFreshGame();
    setTime(model, 0);
    model.startNextRound();

    expect(model.gameState).toBe(BidBotsGameState.Auction);
    expect(model.auctionPhase).toBe(BidBotsAuctionPhase.Bidding);
    expect(model.fighters.length).toBe(3); // ceil(1.5*2) clamped -> 3
    expect(a.bank).toBe(ROUND_BUDGET);
    expect(b.bank).toBe(ROUND_BUDGET);
    expect(model.currentBotIndex).toBe(0);
    expect(model.currentBot).not.toBeNull();
  });
});

describe("BidBotsPresenterModel — the auction", () => {
  function twoPlayerAuction() {
    const { model, sent } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.prepareFreshGame();
    setTime(model, 0);
    model.startNextRound(); // bidding opens at gameTime 0
    return { model, sent };
  }

  it("first BUY freezes the price and enters the verify window", () => {
    const { model } = twoPlayerAuction();
    const bot = model.currentBot!;
    setTime(model, 2000); // 2s in -> price 800

    const res = model.handleBuy("A", { botId: bot.id, clientTapMs: 5000 });

    expect(res.received).toBe(true);
    expect(model.auctionPhase).toBe(BidBotsAuctionPhase.Verifying);
    expect(model.frozenPrice).toBe(priceAt(START_PRICE, 100, PRICE_FLOOR, 2000));
    expect(model.frozenPrice).toBe(800);
  });

  it("awards the bot to the earliest tap when the window closes, and debits the bank", () => {
    const { model } = twoPlayerAuction();
    const bot = model.currentBot!;
    setTime(model, 2000);

    model.handleBuy("A", { botId: bot.id, clientTapMs: 5000 }); // opens window, price 800
    model.handleBuy("B", { botId: bot.id, clientTapMs: 4000 }); // B tapped earlier

    setTime(model, 2000 + VERIFY_WINDOW_MS);
    model.handleTick(); // window closes -> award

    expect(bot.ownerId).toBe("B");
    expect(model.playerById("B")!.bank).toBe(ROUND_BUDGET - 800);
    expect(model.playerById("A")!.bank).toBe(ROUND_BUDGET); // A paid nothing
    expect(model.auctionPhase).toBe(BidBotsAuctionPhase.Revealing);
    expect(model.lastSoldScrapped).toBe(false);
  });

  it("rejects a bid a player cannot afford", () => {
    const { model } = twoPlayerAuction();
    const bot = model.currentBot!;
    runInAction(() => (model.playerById("A")!.bank = 100));
    setTime(model, 1000); // price 900 > 100

    const res = model.handleBuy("A", { botId: bot.id, clientTapMs: 1 });
    expect(res.received).toBe(false);
    expect(model.auctionPhase).toBe(BidBotsAuctionPhase.Bidding); // no freeze happened
  });

  it("scraps a bot nobody buys once the price bottoms out", () => {
    const { model } = twoPlayerAuction();
    const bot = model.currentBot!;
    // price hits floor at 10s; scrap after the grace
    setTime(model, 10000 + SCRAP_GRACE_MS);
    model.handleTick();

    expect(model.auctionPhase).toBe(BidBotsAuctionPhase.Revealing);
    expect(model.lastSoldScrapped).toBe(true);
    expect(bot.ownerId).toBeNull();
  });

  it("advances to the next bot after the reveal, then to battle after the last", () => {
    const { model } = twoPlayerAuction();
    const total = model.fighters.length;

    // Walk every bot to a scrap-and-reveal without buying.
    for (let i = 0; i < total; i++) {
      expect(model.currentBotIndex).toBe(i);
      const base = model.gameTime_ms;
      setTime(model, base + 10000 + SCRAP_GRACE_MS);
      model.handleTick(); // -> revealing
      setTime(model, model.gameTime_ms + REVEAL_MS);
      model.handleTick(); // -> next bot or battle
    }

    // No bot was owned, so the battle resolves immediately to no winner and we land in
    // RoundResult on the next tick chain.
    expect([BidBotsGameState.Battle, BidBotsGameState.RoundResult]).toContain(model.gameState);
  });
});

describe("BidBotsPresenterModel — the battle", () => {
  it("awards the round win to the last team standing and can crown a champion", () => {
    const { model } = makeModel();
    const a = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.prepareFreshGame();
    setTime(model, 0);
    model.startNextRound();

    // Force a decisive ownership: A owns the only bot -> A wins by default.
    runInAction(() => {
      model.fighters[0].ownerId = "A";
      a.wins = 2; // one more win crowns the champion
    });

    model.startBattle();
    expect(model.gameState).toBe(BidBotsGameState.Battle);

    setTime(model, model.gameTime_ms + model.battleDuration_ms + 1);
    model.handleTick(); // -> finishBattle

    expect(a.wins).toBe(3);
    expect(model.roundWinnerId).toBe("A");
    expect(model.championId).toBe("A");
    expect(model.gameState).toBe(BidBotsGameState.RoundResult);

    // After the result hold, the game ends.
    setTime(model, model.gameTime_ms + 100000);
    model.handleTick();
    expect(model.gameState).toBe("GameOver");
  });
});

describe("BidBotsPresenterModel — onboarding", () => {
  it("reports bank, bots, and scoreboard to a player", () => {
    const { model } = makeModel();
    const a = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.prepareFreshGame();
    setTime(model, 0);
    model.startNextRound();
    runInAction(() => (model.fighters[0].ownerId = "A"));

    const info = model.handleOnboard("A", {});
    expect(info.gameState).toBe(BidBotsGameState.Auction);
    expect(info.bank).toBe(a.bank);
    expect(info.myBots.length).toBe(1);
    expect(info.myBots[0].ownerName).toBe("Alice");
    expect(info.scoreboard.length).toBe(2);
    expect(info.winsToWin).toBeGreaterThan(0);
  });
});

describe("BidBotsPresenterModel — checkpoint serialization", () => {
  it("round-trips through the real serializer, preserving banks, wins, and fighters", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getBidBotsPresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(typeHelper, logger, storage) as unknown as BidBotsPresenterModel;

    runInAction(() => {
      const a = model.createFreshPlayerEntry("Alice", "A");
      a.bank = 700;
      a.wins = 1;
      model.players.push(a);
    });
    setTime(model, 0);
    model.startNextRound();
    runInAction(() => (model.fighters[0].ownerId = "A"));

    const serializer = model.serializer!;
    let json = "";
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();

    const back = serializer.parse<BidBotsPresenterModel>(json);
    expect(back.players.length).toBe(1);
    expect(back.players[0].bank).toBe(model.players[0].bank);
    expect(back.players[0].wins).toBe(1);
    expect(back.fighters.length).toBe(model.fighters.length);
    expect(back.fighters[0].ownerId).toBe("A");
  });
});
