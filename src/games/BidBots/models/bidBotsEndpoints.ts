import MessageEndpoint from "libs/messaging/MessageEndpoint";

// ==========================================================================================
// The complete wire API between phones (clients) and the shared screen (presenter) for
// BidBots.  See DESIGN.md for the message table and TemplateGame/models/templateEndpoints.ts
// for the naming/route conventions.  Keep payloads small - phones may be on weak links.
// ==========================================================================================

// A bot as a phone needs to see it (auction card / battle roster / squad list).
export interface BotView {
  id: string;
  seq: number;
  name: string;
  botType: number;
  maxHp: number;
  hp: number;
  str: number;
  def: number;
  ownerId: string | null;
  ownerName: string | null;
}

// One row of the scoreboard.
export interface ScoreRow {
  playerId: string;
  name: string;
  avatarId: number;
  avatarColor: number;
  wins: number;
  bank: number;
  isConnected: boolean;
}

// ------------------------------------------------------------------------------------------
// Onboard Client - the phone's one-stop request for full state.  Called on join, on rejoin
// after a refresh, and whenever the presenter broadcasts InvalidateState.  Everything a phone
// needs to (re)build any screen goes in the response.
// ------------------------------------------------------------------------------------------
export interface BidBotsOnboardResponse {
  gameState: string; // the presenter's game state (mapped to a client view)
  round: number;
  winsToWin: number;
  bank: number; // this player's bank
  isSpectating: boolean; // joined mid-round: no bots this round
  scoreboard: ScoreRow[];

  // Auction (present when the presenter is auctioning)
  auctionPhase: string; // "bidding" | "verifying" | "revealing" | ""
  currentBot: BotView | null;
  startPrice: number;
  dropPerSecond: number;
  priceFloor: number;
  bidElapsedMs: number; // how long the current bot has been on the block (for a smooth phone countdown)
  frozenPrice: number; // the price locked in during verify/reveal (else -1)
  lastSoldWinnerName: string | null; // during a reveal: who won (null = scrapped / n/a)
  lastSoldPrice: number;

  // Battle / squads
  myBots: BotView[]; // this player's bots this round (with live HP)
  battleWinnerId: string | null;
  battleWinnerName: string | null;

  championId: string | null;
  championName: string | null;
}

export const BidBotsOnboardEndpoint: MessageEndpoint<unknown, BidBotsOnboardResponse> = {
  route: "/games/bidbots/lifecycle/onboard-client",
  suggestedRetryIntervalMs: 10000,
  suggestedTotalLifetimeMs: 60000,
};

// ------------------------------------------------------------------------------------------
// Buy - a player taps BUY on the current bot.  Request/response so the phone gets an ack; the
// actual award is announced later via AuctionResult once the verify window closes.
// ------------------------------------------------------------------------------------------
export interface BidBotsBuyRequest {
  botId: string;
  clientTapMs: number; // phone's Date.now() at the tap - used to break near-simultaneous bids
}

export interface BidBotsBuyResponse {
  received: boolean;
  reason?: string; // set when the bid could not even be accepted (wrong phase, cannot afford)
  previewPrice: number; // the price the presenter froze the bot at (for the phone to echo)
}

export const BidBotsBuyEndpoint: MessageEndpoint<BidBotsBuyRequest, BidBotsBuyResponse> = {
  route: "/games/bidbots/actions/buy",
  suggestedRetryIntervalMs: 1500,
  suggestedTotalLifetimeMs: 6000,
};

// ------------------------------------------------------------------------------------------
// Auction Start - presenter puts a new bot on the block.
// ------------------------------------------------------------------------------------------
export interface BidBotsAuctionStartMessage {
  round: number;
  bot: BotView;
  startPrice: number;
  dropPerSecond: number;
  priceFloor: number;
  index: number; // which bot this is in the round (0-based)
  total: number; // how many bots this round
}

export const BidBotsAuctionStartEndpoint: MessageEndpoint<BidBotsAuctionStartMessage, void> = {
  route: "/games/bidbots/lifecycle/auction-start",
};

// ------------------------------------------------------------------------------------------
// Auction Result - a bot was SOLD or SCRAPPED.  Carries the new banks so phones update.
// ------------------------------------------------------------------------------------------
export interface BidBotsAuctionResultMessage {
  botId: string;
  winnerId: string | null; // null = scrapped
  winnerName: string | null;
  price: number;
  scrapped: boolean;
  scoreboard: ScoreRow[];
}

export const BidBotsAuctionResultEndpoint: MessageEndpoint<BidBotsAuctionResultMessage, void> = {
  route: "/games/bidbots/lifecycle/auction-result",
};

// ------------------------------------------------------------------------------------------
// Battle Start - the auction is over; here is the full arena roster.
// ------------------------------------------------------------------------------------------
export interface BidBotsBattleStartMessage {
  round: number;
  roster: BotView[]; // every owned bot (phones filter to their own for health bars)
}

export const BidBotsBattleStartEndpoint: MessageEndpoint<BidBotsBattleStartMessage, void> = {
  route: "/games/bidbots/lifecycle/battle-start",
};

// ------------------------------------------------------------------------------------------
// Battle Update - a throttled HP snapshot during playback (compact: id -> hp).
// ------------------------------------------------------------------------------------------
export interface BidBotsBattleUpdateMessage {
  hps: { id: string; hp: number }[];
}

export const BidBotsBattleUpdateEndpoint: MessageEndpoint<BidBotsBattleUpdateMessage, void> = {
  route: "/games/bidbots/juice/battle-update",
};

// ------------------------------------------------------------------------------------------
// Round Result - the battle resolved; who won the round and the updated scoreboard.  A
// champion id present means the game is over once the reveal finishes.
// ------------------------------------------------------------------------------------------
export interface BidBotsRoundResultMessage {
  round: number;
  winnerId: string | null;
  winnerName: string | null;
  scoreboard: ScoreRow[];
  championId: string | null;
  championName: string | null;
}

export const BidBotsRoundResultEndpoint: MessageEndpoint<BidBotsRoundResultMessage, void> = {
  route: "/games/bidbots/lifecycle/round-result",
};
