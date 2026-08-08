# BidBots — Design Spec (MVP)

> Designer's source-of-truth spec. See [CLAUDE.md](CLAUDE.md) (written during the build) for how the
> code maps to it and which cut-lines were taken.

A frantic **auto-battler auction** for ClusterFun. The presenter runs a live Dutch-auction of
battle bots on the big TV; players bid from their phones to assemble a squad on a limited budget,
then all the bots they bought are dumped into one arena and fight to the last chassis standing. The
tension is entirely economic: fighters get **cheaper every second**, so waiting saves money — but
someone else will snipe the bot you want first.

## Concept & feel

- **Motif:** clanking, sparking battle bots. Names like `CRUSH-O-MATIC`, `GIGAWATT`, `SPARKJAW`.
- **Feel:** energetic, loud, a little silly. Auction is a game-show countdown; battles are a chaotic
  animated melee with hit flashes, KO explosions, and screen shake.
- **Most like:** the shopping phase of an auto-battler (TFT / Super Auto Pets) crossed with a
  **Dutch (descending-price) auction** game show.

## Players & teams

- **2–8 players**, free-for-all (each player is their own team of the bots they win).
- **Join mid-game:** allowed. A late joiner gets a seat with a fresh bank and **spectates the
  current round**, entering the next auction. (Between-round joins are seamless.)
- **Drop-out:** keeps their seat, bank, wins, and any bots they own (those bots still fight).
  Greyed out in the presenter roster. Reconnect migrates nothing (player ids are permanent).

## Core loop

```
Round = Auction phase → Battle phase → Round result
  Auction: N bots auctioned one at a time, price falling $100/sec from $1000.
           First to BUY wins it at the shown price (spends from their bank).
  Battle:  every bot everyone bought enters one arena, battles to last-team-standing.
           Owner of the last surviving bot WINS the round (+1 win).
  Repeat until a player reaches WINS_TO_WIN (3) → champion.
```

## The auction (the star mechanic)

- Each round auctions **`N = ceil(1.5 × connectedPlayers)`** bots (clamped `[3, 12]`), one at a time.
- Each bot shows its stats up front: **HP**, **Strength**, **Defense**, plus a bot name/portrait.
- **Price starts at `$1000` and falls `$100/sec`** (`DROP_PER_SECOND`), i.e. reaches `$0` in 10s.
  Floor is `$0`; at `$0` it can still be claimed **free**. If it sits at `$0` for `SCRAP_GRACE_MS`
  (~1.2s) with no buyer, it is **SCRAPPED** (nobody gets it) and the auction moves on.
- **Budget / bank:** each player starts a round with `+$1000` **added on top of unspent savings**
  (banking). You can't bid more than your bank; the BUY button disables when the price exceeds it.
- **Buy resolution (the suspense beat):** the presenter is the single authority.
  1. When the **first** BUY for the current bot arrives, the presenter **freezes the price display**
     and enters a `VERIFY_WINDOW_MS` (~700ms) window — on screen this reads as a dramatic
     "SOLD… going once…" pause.
  2. It **collects every BUY** that arrives during the window (near-simultaneous taps).
  3. At window close it awards to the buy with the **earliest client tap timestamp**
     (`clientTapMs`, sent by each phone). The **price paid is the frozen price** (presenter's
     authoritative price at the moment the first buy landed) — money is never trusted to a phone.
  4. Presenter reveals **SOLD to `<player>` for `$X`** (or SCRAPPED), updates banks/rosters, pauses
     `REVEAL_MS` (~1.5s), then starts the next bot.
- The phone animates a **smooth local countdown** for feel (started on receipt of `AuctionStart`);
  it is cosmetic — the authoritative price is always the presenter's.

## The battle (last team standing)

Deterministic pure simulation, seeded per round, computed **up front** by the presenter, then
**played back** as an animation.

- Every bot with an owner enters the arena. `resolveBattle(bots, seed)` produces an ordered
  **event log** `[{ tMs, attackerId, targetId, damage, targetHpAfter, dead }]` plus `winnerPlayerId`
  and `durationMs`.
- **Combat rules (pure, specced):** in seeded initiative order, each living bot attacks a random
  living **enemy** (a bot owned by a different player). `damage = max(1, attacker.str − defender.def)`
  (the `max(1,…)` guarantees the fight always terminates). A bot dies at `hp ≤ 0`; its attacker
  retargets. Repeat until only one owner has living bots — that owner wins the round.
  - Sequential processing means there is **no true tie**: the final exchange kills one bot first,
    leaving the other as the last standing.
  - **Degenerate cases:** 1 owner → auto-win; 0 owners (everything scrapped) → no winner, next round.
- **Playback:** the presenter walks the log on its ticker (scaled so a battle runs ~8–15s),
  animating the arena and, every `BATTLE_PUSH_MS` (~200ms), pushing a **compact HP snapshot**
  `[{id, hp}]` to phones so each phone's **live health bars** track its own bots. Late joiners /
  refreshers get current HP from onboard.

## Scoring & win condition

- Winning a round's battle = **+1 win**. **First to `WINS_TO_WIN` (3)** wins the game → champion
  screen. No points beyond win count; the scoreboard shows wins + current bank.

## State machines

**Presenter** (`BidBotsGameState`, on top of base `Gathering`/`GameOver`):

- `Gathering` — join screen (needs `minPlayers = 2`; host starts).
- `Auction` — auctioning bots; inner `auctionPhase`: `bidding` → `verifying` → `revealing` → next
  bot, or → `Battle` when the last bot is resolved.
- `Battle` — animating the royale from the log.
- `RoundResult` — winner banner + updated scoreboard, `REVEAL_MS`, then next round or `GameOver`.
- `GameOver` (base) — champion.

**Client** (base `WaitingToStart`/`Paused` + a `viewMode`):

- `WaitingToStart` — waiting for host / spectating until next auction.
- `Auction` — current bot's stats, big falling **price**, a **BUY** button, my **bank**, my squad
  so far. BUY disabled when `price > bank` or not in `bidding` phase.
- `Battle` — my bots with **live health bars**; "Watch the big screen!".
- `RoundResult` — round outcome + scoreboard + my win count.
- `GameOver` — champion + final scoreboard.

## Message table

| Endpoint (route)              | Dir              | Request → Response / payload sketch                                                                                                                                                       |
| ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bidbots/onboard` (req/res)   | client → present | `{}` → full phone state: `viewMode`, `round`, current bot+price (if auction), `bank`, `myBots[{id,name,maxHp,hp,str,def}]`, `scoreboard[{id,name,wins,bank}]`, `winsToWin`, `championId?` |
| `bidbots/buy` (req/res)       | client → present | `{ botSeq, clientTapMs }` → `{ received: true, previewPrice }` (ack only; award comes via push)                                                                                           |
| `bidbots/auctionStart` (f&f)  | present → all    | `{ botSeq, name, botType, maxHp, str, def, startPrice, dropPerSecond, floorPrice }`                                                                                                       |
| `bidbots/auctionResult` (f&f) | present → all    | `{ botSeq, winnerId \| null, price, scrapped }` → phones update bank/roster/scoreboard                                                                                                    |
| `bidbots/battleStart` (f&f)   | present → all    | `{ roster: [{id,name,botType,ownerId,ownerName,maxHp,str,def}] }`                                                                                                                         |
| `bidbots/battleUpdate` (f&f)  | present → all    | `{ hps: [{id, hp}], event?: {attackerId,targetId,damage,dead} }` (throttled ~200ms)                                                                                                       |
| `bidbots/roundResult` (f&f)   | present → all    | `{ round, winnerId \| null, scoreboard, championId? }`                                                                                                                                    |
| shared                        | both             | `Join`, `Ping`, `InvalidateState`, `GameOver`, `Pause/Resume/Terminate`                                                                                                                   |

The common pattern still holds: on any coarse phase change the presenter also sends
`InvalidateState`, and clients re-sync via `onboard`. The specific pushes above exist for the
fast/low-latency moments (auction start, sold reveal, battle ticks) where a full re-onboard would be
too slow or too chatty.

## Tuning constants (`models/GameSettings.ts`)

`START_PRICE 1000`, `DROP_PER_SECOND 100`, `PRICE_FLOOR 0`, `SCRAP_GRACE_MS 1200`,
`VERIFY_WINDOW_MS 700`, `REVEAL_MS 1500`, `ROUND_BUDGET 1000`, `WINS_TO_WIN 3`,
`FIGHTERS_PER_PLAYER 1.5` (`min 3, max 12`), `BATTLE_MIN_MS 8000`/`BATTLE_MAX_MS 15000`,
`BATTLE_PUSH_MS 200`. Stat ranges: `HP 20–60`, `STR 5–15`, `DEF 0–8`.

## Visual

Big screen 1920×1080, dark industrial arena. Auction: a spotlit bot on a turntable, giant animated
price readout, a bidder ticker. Battle: bots as chunky sprites/emoji-bots with HP bars, hit flashes,
KO explosions + screen shake, a crowd-roar feel. Round result: podium/scoreboard. `PlayerAvatar`
beside every player name (join list, bidder callouts, scoreboard, champion). Phone 1080×1920.
Standard score + winner fanfare sounds; add bid-accepted, SOLD gavel, hit, KO, and victory cues.

## MVP cut-lines

**In:** join + host start; the descending-price auction with BUY, banking budget, the tie
verification window + suspense reveal, SOLD/SCRAPPED; per-bot stat cards; deterministic battle-royale
sim with an animated arena (HP bars, hit flashes, KO effects); live phone health bars; round-result
scoreboard; first-to-3 wins + champion; mid-game join (spectate → next round); drop/rejoin;
refresh-resume (presenter and phone); sounds; reduced-motion fallback for the battle.

**Deferred (later):** bot special abilities / classes beyond raw stats; bots persisting/accumulating
across rounds (armies); crit/dodge combat depth (defense as a chance, not just mitigation); a
knockout **bracket** mode; spectator side-betting on battles; bespoke bot art/animation beyond simple
sprites; taunts/emotes; a scrap-bot resale market; per-bot targeting AI; host-tunable settings UI.
