import {
  battleDurationMs,
  BuyBid,
  canAfford,
  checkChampion,
  eventsElapsed,
  Fighter,
  fightersPerRound,
  generateFighters,
  hpAfter,
  isScrapReady,
  msToFloor,
  priceAt,
  randInt,
  resolveBattle,
  resolveBuyContest,
} from "./bidBotsLogic";
import {
  BATTLE_MAX_MS,
  BATTLE_MIN_MS,
  MAX_FIGHTERS,
  MIN_FIGHTERS,
  PRICE_FLOOR,
  START_PRICE,
} from "./GameSettings";

// A small seedable PRNG so battle/generation tests are deterministic.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a fighter with sensible defaults for battle tests.
function fighter(id: string, ownerId: string | null, overrides: Partial<Fighter> = {}): Fighter {
  return {
    id,
    seq: 0,
    name: id,
    botType: 0,
    maxHp: 30,
    hp: 30,
    str: 10,
    def: 2,
    ownerId,
    ...overrides,
  };
}

describe("randInt", () => {
  it("stays within the inclusive range", () => {
    const rand = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const v = randInt(rand, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("can hit both ends", () => {
    // rand() -> 0 gives min, rand() -> ~1 gives max
    expect(randInt(() => 0, 5, 9)).toBe(5);
    expect(randInt(() => 0.9999, 5, 9)).toBe(9);
  });
});

describe("fightersPerRound", () => {
  it("scales at ~1.5x the field", () => {
    expect(fightersPerRound(4)).toBe(6);
    expect(fightersPerRound(6)).toBe(9);
  });
  it("clamps to the min and max", () => {
    expect(fightersPerRound(1)).toBe(MIN_FIGHTERS);
    expect(fightersPerRound(0)).toBe(MIN_FIGHTERS);
    expect(fightersPerRound(100)).toBe(MAX_FIGHTERS);
  });
});

describe("generateFighters", () => {
  it("makes the requested count with unique ids and full HP", () => {
    const bots = generateFighters(2, 5, mulberry32(42));
    expect(bots).toHaveLength(5);
    expect(new Set(bots.map((b) => b.id)).size).toBe(5);
    bots.forEach((b, i) => {
      expect(b.id).toBe(`r2_b${i}`);
      expect(b.seq).toBe(i);
      expect(b.hp).toBe(b.maxHp);
      expect(b.ownerId).toBeNull();
      expect(b.name).toMatch(/Mk\.\d+$/);
    });
  });

  it("is deterministic for a given seed", () => {
    const a = generateFighters(1, 4, mulberry32(7));
    const b = generateFighters(1, 4, mulberry32(7));
    expect(a).toEqual(b);
  });

  it("keeps stats inside the configured ranges", () => {
    const bots = generateFighters(1, 50, mulberry32(99));
    for (const b of bots) {
      expect(b.maxHp).toBeGreaterThanOrEqual(20);
      expect(b.maxHp).toBeLessThanOrEqual(60);
      expect(b.str).toBeGreaterThanOrEqual(5);
      expect(b.str).toBeLessThanOrEqual(15);
      expect(b.def).toBeGreaterThanOrEqual(0);
      expect(b.def).toBeLessThanOrEqual(8);
    }
  });
});

describe("priceAt", () => {
  it("starts at the opening price", () => {
    expect(priceAt(START_PRICE, 100, PRICE_FLOOR, 0)).toBe(1000);
  });
  it("drops $100 per second, floored to whole dollars", () => {
    expect(priceAt(1000, 100, 0, 1000)).toBe(900);
    expect(priceAt(1000, 100, 0, 3500)).toBe(650);
  });
  it("never goes below the floor", () => {
    expect(priceAt(1000, 100, 0, 100000)).toBe(0);
    expect(priceAt(1000, 100, 50, 100000)).toBe(50);
  });
});

describe("msToFloor / isScrapReady", () => {
  it("reaches the floor after the expected time", () => {
    expect(msToFloor(1000, 100, 0)).toBe(10000);
  });
  it("is scrap-ready only after the grace past the floor", () => {
    expect(isScrapReady(10000, 1000, 100, 0, 1200)).toBe(false);
    expect(isScrapReady(11199, 1000, 100, 0, 1200)).toBe(false);
    expect(isScrapReady(11200, 1000, 100, 0, 1200)).toBe(true);
  });
});

describe("canAfford", () => {
  it("allows a bid at or under the bank", () => {
    expect(canAfford(1000, 1000)).toBe(true);
    expect(canAfford(1000, 700)).toBe(true);
    expect(canAfford(1000, 1001)).toBe(false);
  });
});

describe("resolveBuyContest", () => {
  const bid = (playerId: string, clientTapMs: number, receiveOrder: number): BuyBid => ({
    playerId,
    clientTapMs,
    receiveOrder,
  });

  it("returns null with no bids", () => {
    expect(resolveBuyContest([])).toBeNull();
  });

  it("earliest tap wins even if it arrived second", () => {
    // B's tap is earlier though it reached the presenter later.
    const winner = resolveBuyContest([bid("A", 500, 0), bid("B", 400, 1)]);
    expect(winner).toBe("B");
  });

  it("breaks a tap tie by arrival order", () => {
    const winner = resolveBuyContest([bid("A", 500, 1), bid("B", 500, 0)]);
    expect(winner).toBe("B");
  });

  it("is deterministic on a full tie", () => {
    const winner = resolveBuyContest([bid("B", 500, 0), bid("A", 500, 0)]);
    expect(winner).toBe("A"); // id tiebreak
  });
});

describe("resolveBattle", () => {
  it("returns no winner when nobody owns a bot", () => {
    const log = resolveBattle([fighter("x", null)], mulberry32(1));
    expect(log.winnerId).toBeNull();
    expect(log.events).toHaveLength(0);
  });

  it("a single owner wins with no fighting", () => {
    const log = resolveBattle([fighter("a1", "A"), fighter("a2", "A")], mulberry32(1));
    expect(log.winnerId).toBe("A");
    expect(log.events).toHaveLength(0);
  });

  it("the stronger solo team wins a 1v1", () => {
    const strong = fighter("a", "A", { maxHp: 60, str: 15, def: 8 });
    const weak = fighter("b", "B", { maxHp: 20, str: 5, def: 0 });
    const log = resolveBattle([strong, weak], mulberry32(3));
    expect(log.winnerId).toBe("A");
    expect(log.events.length).toBeGreaterThan(0);
    // The final event must be a kill.
    expect(log.events[log.events.length - 1].dead).toBe(true);
  });

  it("always terminates with a single winning team", () => {
    for (let seed = 0; seed < 25; seed++) {
      const participants = [
        fighter("a1", "A"),
        fighter("a2", "A"),
        fighter("b1", "B"),
        fighter("c1", "C", { str: 12 }),
      ];
      const log = resolveBattle(participants, mulberry32(seed));
      expect(["A", "B", "C"]).toContain(log.winnerId);
    }
  });

  it("damage never drops below 1 even against high defense (fights end)", () => {
    // def >= str for everyone: without the max(1,...) floor this would never resolve.
    const a = fighter("a", "A", { str: 3, def: 10, maxHp: 25 });
    const b = fighter("b", "B", { str: 2, def: 10, maxHp: 25 });
    const log = resolveBattle([a, b], mulberry32(5));
    expect(log.winnerId === "A" || log.winnerId === "B").toBe(true);
    for (const e of log.events) expect(e.damage).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic for a given seed", () => {
    const build = () => [fighter("a", "A"), fighter("b", "B"), fighter("c", "C")];
    const log1 = resolveBattle(build(), mulberry32(11));
    const log2 = resolveBattle(build(), mulberry32(11));
    expect(log1).toEqual(log2);
  });

  it("does not mutate the input fighters", () => {
    const bots = [fighter("a", "A"), fighter("b", "B")];
    resolveBattle(bots, mulberry32(2));
    expect(bots.every((b) => b.hp === b.maxHp)).toBe(true);
  });
});

describe("battleDurationMs", () => {
  it("clamps to the min and max window", () => {
    expect(battleDurationMs(0)).toBe(BATTLE_MIN_MS);
    expect(battleDurationMs(1)).toBe(BATTLE_MIN_MS);
    expect(battleDurationMs(100000)).toBe(BATTLE_MAX_MS);
  });
});

describe("eventsElapsed", () => {
  it("returns all events at or past the end", () => {
    expect(eventsElapsed(10, 1000, 1000)).toBe(10);
    expect(eventsElapsed(10, 1000, 5000)).toBe(10);
  });
  it("is proportional midway", () => {
    expect(eventsElapsed(10, 1000, 500)).toBe(5);
    expect(eventsElapsed(10, 1000, 0)).toBe(0);
  });
});

describe("hpAfter", () => {
  it("is full HP before any events", () => {
    const bots = [fighter("a", "A", { maxHp: 30 }), fighter("b", "B", { maxHp: 40 })];
    const log = resolveBattle(bots, mulberry32(4));
    const hp = hpAfter(bots, log.events, 0);
    expect(hp.get("a")).toBe(30);
    expect(hp.get("b")).toBe(40);
  });

  it("matches the last recorded HP after applying events", () => {
    const bots = [fighter("a", "A"), fighter("b", "B")];
    const log = resolveBattle(bots, mulberry32(6));
    const full = hpAfter(bots, log.events, log.events.length);
    // The loser ends at 0; the winner is still alive (>0).
    const winnerId = log.winnerId!;
    const winnerFighter = bots.find((b) => b.ownerId === winnerId)!;
    const loserFighter = bots.find((b) => b.ownerId !== winnerId)!;
    expect(full.get(loserFighter.id)).toBe(0);
    expect(full.get(winnerFighter.id)!).toBeGreaterThan(0);
  });
});

describe("checkChampion", () => {
  it("returns null until someone reaches the target", () => {
    const players = [
      { playerId: "A", wins: 2 },
      { playerId: "B", wins: 1 },
    ];
    expect(checkChampion(players, 3)).toBeNull();
  });
  it("returns the first player to reach the target", () => {
    const players = [
      { playerId: "A", wins: 1 },
      { playerId: "B", wins: 3 },
    ];
    expect(checkChampion(players, 3)).toBe("B");
  });
});
