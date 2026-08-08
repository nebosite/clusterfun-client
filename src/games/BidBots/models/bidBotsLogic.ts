// ==========================================================================================
// PURE, framework-free game rules for BidBots.  No MobX, no session, no DOM - just data in,
// data out.  Everything the presenter decides (fighter generation, the falling price, the
// buy contest, the whole battle simulation, the win check) lives here so it is unit-testable
// without the framework.  The models hold observable state and delegate every decision here.
//
// Mirrors OneOhOne's oneOhOneLogic.ts and PartyPix's partyPixLogic.ts.
// ==========================================================================================

import {
  BATTLE_MAX_MS,
  BATTLE_MIN_MS,
  DEF_MAX,
  DEF_MIN,
  FIGHTERS_PER_PLAYER,
  HP_MAX,
  HP_MIN,
  MAX_FIGHTERS,
  MIN_FIGHTERS,
  PER_EVENT_MS,
  STR_MAX,
  STR_MIN,
} from "./GameSettings";

// A `rand` is any function returning a number in [0, 1) - e.g. the base model's randomDouble.
// Passing it in keeps this module pure and its output reproducible in tests.
export type Rand = () => number;

// ------------------------------------------------------------------------------------------
// One battle bot.  A plain object (not a class) so it rides along inside a MobX observable
// array with deep observability - the same pattern OneOhOne uses for GamePiece - and needs no
// entry in the serializer's type helper.
// ------------------------------------------------------------------------------------------
export interface Fighter {
  id: string; // stable within a round, e.g. "r3_b0"
  seq: number; // auction order within the round (0-based)
  name: string;
  botType: number; // 0..BOT_TYPE_COUNT-1, picks the sprite/emoji
  maxHp: number;
  hp: number; // current HP; mutated only during battle playback
  str: number;
  def: number;
  ownerId: string | null; // playerId who won it at auction, or null (unsold)
}

export const BOT_TYPE_COUNT = 6;

// A pool of clanky battle-bot names.  Auctioned names get a random "Mk." suffix so repeats in
// one round still read as distinct machines.
export const BOT_NAMES = [
  "CRUSH-O-MATIC",
  "GIGAWATT",
  "SPARKJAW",
  "RUSTBUCKET",
  "MEGATON",
  "BOLTHACKER",
  "IRONCLAD",
  "ZAPTRON",
  "SLAMBOT",
  "COGWRECKER",
  "TITANIUM TERRY",
  "DIESEL",
  "NUKEBOLT",
  "GRINDERELLA",
  "OMEGA-9",
  "SCRAPZILLA",
];

// ------------------------------------------------------------------------------------------
// randInt - inclusive integer in [min, max] from a [0,1) rand.
// ------------------------------------------------------------------------------------------
export function randInt(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

// ------------------------------------------------------------------------------------------
// fightersPerRound - how many bots to auction for a given headcount.  Scales with the field
// so there is competition but not a bot for everyone, clamped to a sane range.
// ------------------------------------------------------------------------------------------
export function fightersPerRound(playerCount: number): number {
  const scaled = Math.round(Math.max(0, playerCount) * FIGHTERS_PER_PLAYER);
  return Math.max(MIN_FIGHTERS, Math.min(MAX_FIGHTERS, scaled));
}

// ------------------------------------------------------------------------------------------
// generateFighters - build a round's lineup with random stats + names.  Deterministic given
// `rand`, so a seeded rand yields a reproducible auction (used in tests).
// ------------------------------------------------------------------------------------------
export function generateFighters(roundNumber: number, count: number, rand: Rand): Fighter[] {
  const fighters: Fighter[] = [];
  for (let seq = 0; seq < count; seq++) {
    const maxHp = randInt(rand, HP_MIN, HP_MAX);
    const baseName = BOT_NAMES[randInt(rand, 0, BOT_NAMES.length - 1)];
    fighters.push({
      id: `r${roundNumber}_b${seq}`,
      seq,
      name: `${baseName} Mk.${randInt(rand, 1, 99)}`,
      botType: randInt(rand, 0, BOT_TYPE_COUNT - 1),
      maxHp,
      hp: maxHp,
      str: randInt(rand, STR_MIN, STR_MAX),
      def: randInt(rand, DEF_MIN, DEF_MAX),
      ownerId: null,
    });
  }
  return fighters;
}

// ------------------------------------------------------------------------------------------
// priceAt - the Dutch-auction price after `elapsedMs`, floored to whole dollars and never
// below `floor`.  This is the single source of truth for the price; the phone's smooth
// countdown is only cosmetic.
// ------------------------------------------------------------------------------------------
export function priceAt(
  startPrice: number,
  dropPerSecond: number,
  floor: number,
  elapsedMs: number,
): number {
  const raw = startPrice - (dropPerSecond * Math.max(0, elapsedMs)) / 1000;
  return Math.max(floor, Math.floor(raw));
}

// ------------------------------------------------------------------------------------------
// msToFloor - how long until the price first reaches the floor.
// ------------------------------------------------------------------------------------------
export function msToFloor(startPrice: number, dropPerSecond: number, floor: number): number {
  if (dropPerSecond <= 0) return Infinity;
  return ((startPrice - floor) / dropPerSecond) * 1000;
}

// ------------------------------------------------------------------------------------------
// isScrapReady - true once the price has sat at the floor with no buyer for `graceMs`.
// ------------------------------------------------------------------------------------------
export function isScrapReady(
  elapsedMs: number,
  startPrice: number,
  dropPerSecond: number,
  floor: number,
  graceMs: number,
): boolean {
  return elapsedMs >= msToFloor(startPrice, dropPerSecond, floor) + graceMs;
}

// ------------------------------------------------------------------------------------------
// canAfford - a bid at `price` is legal only if the player can cover it.
// ------------------------------------------------------------------------------------------
export function canAfford(bank: number, price: number): boolean {
  return price <= bank;
}

// A single BUY tap collected during the verification window.
export interface BuyBid {
  playerId: string;
  clientTapMs: number; // phone's tap timestamp (Date.now on the phone)
  receiveOrder: number; // order the presenter received it (skew-proof tiebreak)
}

// ------------------------------------------------------------------------------------------
// resolveBuyContest - decide who wins a bot among near-simultaneous taps.  Earliest client
// tap wins (that is what "first" means to the players); ties broken by which reached the
// presenter first, then by id so the result is always deterministic.
// ------------------------------------------------------------------------------------------
export function resolveBuyContest(bids: BuyBid[]): string | null {
  if (bids.length === 0) return null;
  const sorted = bids.slice().sort((a, b) => {
    if (a.clientTapMs !== b.clientTapMs) return a.clientTapMs - b.clientTapMs;
    if (a.receiveOrder !== b.receiveOrder) return a.receiveOrder - b.receiveOrder;
    return a.playerId < b.playerId ? -1 : 1;
  });
  return sorted[0].playerId;
}

// ==========================================================================================
// The battle - a deterministic last-team-standing brawl.
// ==========================================================================================

export interface BattleEvent {
  attackerId: string;
  targetId: string;
  damage: number;
  targetHpAfter: number; // clamped at 0
  dead: boolean;
}

export interface BattleLog {
  events: BattleEvent[];
  winnerId: string | null; // playerId of the last team standing (null if nobody owns a bot)
}

// Fisher-Yates using the injected rand - keeps the sim reproducible.
function shuffled<T>(items: T[], rand: Rand): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ------------------------------------------------------------------------------------------
// resolveBattle - run the whole fight up front and return the event log + winner.
//
// Rules: in a seeded initiative order each living bot attacks a random LIVING enemy (a bot
// owned by a different player) for max(1, str - def) damage.  The max(1,...) guarantees every
// exchange makes progress, so the fight always terminates.  Processing is sequential, so the
// final blow leaves exactly one team standing - there is never a true tie.
//
// Degenerate inputs: 0 owners -> winner null; a single owner -> that owner wins with no
// fighting.  Only bots with an owner take part; pass the owned bots in.
// ------------------------------------------------------------------------------------------
export function resolveBattle(participants: Fighter[], rand: Rand): BattleLog {
  const events: BattleEvent[] = [];

  // Work on a local hp copy so we never mutate the caller's fighters.
  const hp = new Map<string, number>();
  const ownerOf = new Map<string, string>();
  for (const f of participants) {
    if (f.ownerId === null) continue;
    hp.set(f.id, f.maxHp);
    ownerOf.set(f.id, f.ownerId);
  }

  const distinctOwners = () => new Set(Array.from(hp.keys()).map((id) => ownerOf.get(id)!));

  let owners = distinctOwners();
  if (owners.size <= 1) {
    return { events, winnerId: owners.size === 1 ? Array.from(owners)[0] : null };
  }

  const living = (): string[] => Array.from(hp.keys());
  const SAFETY_CAP = 100000;
  let guard = 0;

  while (distinctOwners().size > 1 && guard < SAFETY_CAP) {
    guard++;
    const order = shuffled(living(), rand);
    for (const attackerId of order) {
      if (!hp.has(attackerId)) continue; // died earlier this step
      const attackerOwner = ownerOf.get(attackerId)!;
      const enemies = living().filter((id) => ownerOf.get(id) !== attackerOwner);
      if (enemies.length === 0) break; // attacker's team is all that is left
      const targetId = enemies[Math.floor(rand() * enemies.length)];
      const attacker = participants.find((f) => f.id === attackerId)!;
      const target = participants.find((f) => f.id === targetId)!;
      const damage = Math.max(1, attacker.str - target.def);
      const newHp = hp.get(targetId)! - damage;
      const dead = newHp <= 0;
      events.push({
        attackerId,
        targetId,
        damage,
        targetHpAfter: Math.max(0, newHp),
        dead,
      });
      if (dead) hp.delete(targetId);
      else hp.set(targetId, newHp);
      if (distinctOwners().size <= 1) break;
    }
  }

  owners = distinctOwners();
  return { events, winnerId: owners.size >= 1 ? Array.from(owners)[0] : null };
}

// ------------------------------------------------------------------------------------------
// battleDurationMs - stretch the whole fight to a watchable length: proportional to how many
// blows are thrown, clamped so a tiny brawl is not a blink and a huge one is not a slog.
// ------------------------------------------------------------------------------------------
export function battleDurationMs(eventCount: number): number {
  return Math.max(BATTLE_MIN_MS, Math.min(BATTLE_MAX_MS, eventCount * PER_EVENT_MS));
}

// ------------------------------------------------------------------------------------------
// eventsElapsed - how many battle events should have played by `elapsedMs`.  A pure function
// of elapsed time, so playback is idempotent and survives a mid-battle refresh.
// ------------------------------------------------------------------------------------------
export function eventsElapsed(eventCount: number, durationMs: number, elapsedMs: number): number {
  if (eventCount === 0 || durationMs <= 0) return eventCount;
  const n = Math.round((elapsedMs / durationMs) * eventCount);
  return Math.max(0, Math.min(eventCount, n));
}

// ------------------------------------------------------------------------------------------
// hpAfter - HP of every fighter after the first `count` events, starting from full.  Used by
// the presenter to (re)build the arena at any playback point, including after a refresh.
// ------------------------------------------------------------------------------------------
export function hpAfter(
  fighters: Fighter[],
  events: BattleEvent[],
  count: number,
): Map<string, number> {
  const hp = new Map<string, number>();
  for (const f of fighters) hp.set(f.id, f.maxHp);
  const n = Math.max(0, Math.min(events.length, count));
  for (let i = 0; i < n; i++) {
    const e = events[i];
    hp.set(e.targetId, e.targetHpAfter);
  }
  return hp;
}

// ------------------------------------------------------------------------------------------
// checkChampion - the first player to reach `winsToWin`, or null if nobody has yet.
// ------------------------------------------------------------------------------------------
export function checkChampion<T extends { playerId: string; wins: number }>(
  players: T[],
  winsToWin: number,
): string | null {
  for (const p of players) {
    if (p.wins >= winsToWin) return p.playerId;
  }
  return null;
}
