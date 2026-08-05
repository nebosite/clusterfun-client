# EITtris

Versus-Tetris for up to 16 boards at once. Every player plays a full 10×21 board on their
phone; the shared screen shows all boards; clearing rows collects powerups that fire at a
chosen target; last board standing wins. Ranking is **rows cleared** — there is no score.

The largest game in the repo (~15k lines, ~5.9k of it specs). Ported from a C# MonoGame
original ("eitrix").

> **⚠ `DESIGN.md` is stale — do not use it as spec.** It describes a host-authoritative
> architecture that the code reversed, plus obsolete numbers (scoring, gravity, spawn column,
> antidote cap, special count). It is kept as history. **The authoritative architecture note
> is the comment block at [`models/eittrisEndpoints.ts:188-197`](models/eittrisEndpoints.ts).**
> Some file-header comments are stale the same way — see Traps §19.

## The one thing to know first: authority is per board

**Each phone simulates its own board. The presenter simulates only robots.** There is no
prediction and no reconciliation, because there is nothing to reconcile — a board has exactly
one owner.

- The phone never accepts a pushed board once it has one ([`ClientModel.ts:329`](models/ClientModel.ts)).
- The presenter never pushes to a phone-owned board ([`PresenterModel.ts:887-892`](models/PresenterModel.ts)).
- The presenter's copy of a human board is a **mirror**, fed by `applyReportToBoard`
  ([`eittrisSimulation.ts:986`](models/eittrisSimulation.ts)).

This is the opposite of the usual ClusterFun rule that the presenter owns all state, and it is
deliberate: a 30 Hz tetris board cannot round-trip input through a relay. The presenter still
owns everything _between_ boards — rounds, targeting, attack delivery, death, ranking.

## The wordmark

`views/EittrisLogo.tsx` — all caps, a red-to-yellow gradient top to bottom, and the **R upside
down**. It is TEXT with `background-clip: text`, not an image, because it lands in a phone
header, a presenter corner and a version tag at three different sizes and has to stay crisp in
all of them; it takes its size from whatever it is dropped into. The gradient leaves nothing for
a screen reader to find, so the component carries `aria-label="EITTRIS"`.

Use it anywhere the name would otherwise be spelled out. `GameVersionTag`'s `title` takes a
ReactNode for exactly this.

**The upside-down R needs its OWN copy of the gradient.** A `transform` gives an element its
own paint context, so the R is no longer painted through the parent's `background-clip: text` -
with only the inherited transparent fill it renders as a hole, and the wordmark reads
"EITT&nbsp;&nbsp;&nbsp;IS". Its copy runs `to top` with the same stops, because the rotation
flips the axis.

**The lobby card cannot use it.** `GameDescriptor.displayName` is a `string`, and in production
it comes from the server manifest anyway - so the tile says "EITTRIS" in plain type. Making it
a wordmark would mean changing a contract shared with the server.

## File map

| File                          | Lines | Owns                                                                                                                                                                      |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models/eittrisEndpoints.ts`  | 273   | Wire types. **Read first** — the architecture note lives here.                                                                                                            |
| `models/eittrisLogic.ts`      | 2266  | **Pure rules.** Piece tables, SRS kicks, collision, lock/clear, specials catalog, gravity curve, seven-bag, wire codecs, AI scoring, stencils, layout. Change rules here. |
| `models/eittrisSimulation.ts` | 1023  | **Stateful board stepping**, framework-free. `stepBoard`, lock/spawn/kill, specials, `applyCommand`, `applyReportToBoard`. Change per-frame behavior here.                |
| `models/PresenterModel.ts`    | 1062  | Host: rounds, robots, attack relay, death/ranking, thumbnails, wire throttling.                                                                                           |
| `models/ClientModel.ts`       | 922   | Phone: owns its board, mirrors to observables, reports up, banners/vibration.                                                                                             |
| `models/eittrisInput.ts`      | 248   | Key/pad bindings + the player-visible control guide.                                                                                                                      |
| `models/GameSettings.ts`      | 66    | Timing/tuning constants that are not rules.                                                                                                                               |
| `views/Presenter.tsx`         | 720   | Gathering setup UI, board grid layout, all sound/music wiring. No spec.                                                                                                   |
| `views/Client.tsx`            | 1033  | Phone UI **and `GestureTracker` (`:101`) and `ControlsHelp`** — despite `GestureTracker.spec.ts` existing as its own file.                                                |
| `views/BoardGrid.tsx`         | 343   | Shared dumb renderer; runs its own rAF animation clocks.                                                                                                                  |
| `views/RobotDemo.tsx`         | 242   | Cosmetic gathering-screen bot. Own loop, own simplified rules, touches no game state.                                                                                     |

`eittrisSimulation.ts` is **production code, not a test double** — it is the single rule engine
both sides run. It differs from `eittrisLogic` by owning mutation, time, and an event sink
(`SimulationEvents` / `SimulationContext`, `:105-164`); pass `NO_EVENTS` to opt out.

## State machine

- **Presenter** — `EittrisGameState` has only `Playing` (`PresenterModel.ts:88`). Gathering,
  GameOver and Paused come from the framework enums.
  `Gathering → startGame → prepareFreshRound → startNextRound (:449) → Playing → checkForGameEnd (:767, alive ≤ 1) → finishGame (:779) → GameOver → startGame ("Play again")`.
- **Client** — `EittrisClientState` = `Playing | Dead` (`ClientModel.ts:117`); WaitingToStart /
  GameOver / JoinError are framework states.

## Endpoints

| Endpoint                | Direction                 | Rate                                               |
| ----------------------- | ------------------------- | -------------------------------------------------- |
| `EittrisOnboardClient`  | client→presenter req/resp | rare (join/rejoin/invalidate)                      |
| `EittrisStartPlaying`   | presenter→one client      | per round / per handover                           |
| `EittrisBoardReport`    | **client→presenter**      | **chatty** — ≤ every 250 ms, batched events        |
| `EittrisCommand`        | client→presenter          | rare (see Trap 6)                                  |
| `EittrisBoardUpdate`    | presenter→one client      | **suppressed during play**; host-owned boards only |
| `EittrisThumbnails`     | presenter→everyone        | ~1 s, changed boards only, 36-char base64          |
| `EittrisDeliverSpecial` | presenter→one client      | per attack                                         |
| `EittrisSpecialEvent`   | presenter→everyone        | per attack                                         |

`EittrisBoardSnapshot` (`:14`) **omits `grid` to mean "unchanged"** — receivers must retain the
last one.

## Tick & timing

Framework ticker is 33 ms (~30 Hz). The client subscribes `onTick → simulate()`
(`ClientModel.ts:256`); the presenter's `handleTick` (`:483`) steps **robots only**, then
flushes dirty boards and maybe broadcasts thumbnails.

`stepBoard` (`eittrisSimulation.ts:170-265`) **ordering is load-bearing**: specials → stencil →
bridge → jumble → swap → AI → shadows → psycho → affliction clocks → prune orphaned markers,
then **exclusive early-return gates** in order: quake-shake → quake-fall → clearing → spawn-gap
→ gravity. Each gate freezes everything below it.

Gravity drains whole intervals in a `for(;;)` catch-up loop (`:247-264`), so one long frame can
lock **and** spawn within a single tick.

Animations run off their **own rAF clocks** in `BoardGrid.tsx:92-137`, seeded from the
snapshot's `elapsedMs` — not from the model tick. `RobotDemo.tsx` has a third independent loop.

## Traps

These are the things a session gets wrong. Most cost a silent, hard-to-see breakage.

1. **`DESIGN.md` lies about the architecture.** Start at `eittrisEndpoints.ts:188`.
2. **Never rename `spendAntidote` to `useAntidote`** — eslint rules-of-hooks fails the
   production build on any top-level `useX` function (`eittrisSimulation.ts:814`).
3. **`handleBoardReport`'s switch is exhaustive by force** via `unreachable(event)`
   (`PresenterModel.ts:81`, `:625`). A new `EittrisReportEvent` kind without a case is a
   compile error _on purpose_ — that is how the earthquake once went silent for humans.
4. **`currentRound` must keep counting up across games** (`PresenterModel.ts:449`); the phone
   uses it to tell a new round from a stray repeat. Resetting it starts game 2 on stale boards.
5. **"Just push the board to the phone" does nothing during play** — see the two early-returns
   under _authority_ above.
6. **Anything that changes your own board must be applied locally on the phone, never sent as a
   command** (target pick, antidote, earthquake, dev fire — `ClientModel.ts:841-913`). A command
   lands on the host's _mirror_ and is overwritten by the next report. `setForcedSpecial` /
   `setAiControlled` are the exception: applied locally **and** sent, because the preference
   lives on the `EittrisPlayer`.
7. **`SwitchScreens` is the one attack the host applies to a human victim**
   (`PresenterModel.ts:662`) — a phone's `ctx.boards()` contains only itself.
8. **Kick tables are y-UP as published; the sign is flipped at the use site**
   (`eittrisLogic.ts:216`, `:388`). Do not "fix" the tables.
9. **A piece's `x` is its SRS _box_ corner and may be negative** — a vertical I needs `x = -2`
   to touch the left wall (`:402-417`). Never clamp to 0..9; the client sends drags unclamped
   on purpose.
10. **`moveLeft`/`moveRight` exist separately from `dragTo`** because CrazyIvan mirrors an
    absolute column (`eittrisSimulation.ts:947`).
11. **`AFFLICTION_TIMERS` order is a wire contract.** `afflictionMs` is a positional array
    (`eittrisEndpoints.ts:44`, `ClientModel.ts:623`). Reordering silently mislabels every chip.
12. **Adding a `SpecialType` means five edits together**: the enum, `SPECIAL_NAMES`,
    `IMPLEMENTED_SPECIALS`, the sprite strip, and `SPECIAL_ICON_COUNT` (18) — which is used as
    `(n-1)` in five `backgroundPosition` calculations across Client.tsx and Presenter.tsx.
13. **`devFast` scales game time ×32 but the AI timer is real ms**, hence `AI_FAST_MULTIPLIER`.
    Any new real-time timer needs the same treatment.
14. **`spawnDelayMs <= 0`, not `> 0`** (`eittrisSimulation.ts:231`) — a delay of exactly zero
    would strand the board forever.
15. **`pieceSeq` increments twice per piece** (on lock and on spawn). It is a staleness token,
    not a piece counter.
16. **Adding a field to `EittrisBoard` means touching 8 places**: the interface, `makeBoard`,
    `EittrisBoardSnapshot`, `snapshotFor`, `snapshotOfOwnBoard`, `applyReportToBoard`,
    `applySnapshot`, `mirrorBoard`. Miss one and it silently fails to survive the wire or a
    rejoin.
17. **Observability is asymmetric.** On the presenter, boards are deep-observable — every
    mutation needs `action()`/`runInAction` (`PresenterModel.ts:343`, `:362`). On the client the
    board is deliberately **not** observable (`ClientModel.ts:196`); views read `mirrorBoard`'s
    copies. Making it observable would cost dearly.
18. **Serialization:** the presenter helper excludes per-tick bookkeeping and
    **re-wraps `boards` in `observable()` on reconstitute** (`:158-160`) — without that the host
    screen stops updating. The client excludes only `lastSpecialEvent` and `hitPulses` so a
    refresh cannot replay a banner. Both guard against a restored tick time that is ahead of
    `gameTime_ms`.
19. **Stale comments to ignore:** `eittrisSimulation.ts:709` and `eittrisLogic.ts:1013` both
    claim SeeShadows is permanent (it is 30 s); the file headers on `PresenterModel.ts:167` and
    `Client.tsx:1` still describe the old host-authoritative model.

## Input

`eittrisInput.ts` declares 10 actions consumed by the shared `GameInputController`. Four
keyboard "seats" (arrows / WASD / IJKL / numpad) share `Space`; pad uses d-pad + left stick +
face buttons. Only the three movement actions repeat. **`EITTRIS_CONTROL_GUIDE` (`:185`) is
player-visible and must be edited in lockstep with the bindings** — `Client.spec.tsx` asserts
every guide entry maps to a real binding.

Touch is `GestureTracker` (`Client.tsx:101-274`), pointer events only. Drag activates after
12 px and streams `dragTo(column,row)`. A flick (<300 ms, >40 px) first **snaps the piece back
to where the finger went down**, then acts — so mid-swipe wandering doesn't count.

## AI

Two separate things, both shipped:

- **The bot** (`planPlacement`, `nextAiMove`, driven by `tickAi`) plays real boards: host-side
  robot players, a dev CPU checkbox, and **robot takeover when a player drops out**
  (`PresenterModel.ts:339`). It rotates and steps only — gravity does the dropping.
  `MAX_ROBOTS = 4` (20 in dev). Robots use `robot-N` ids and are **deliberately not in
  `players`**.
- **`RobotDemo.tsx`** is cosmetic only.

## Testing

~5,900 lines of spec — the reference standard for the repo. `eittrisLogic.spec.ts` (2437)
covers every pure function; `PresenterModel.spec.ts` (2341) drives the real model with a
recording fake session and includes a **real serializer round-trip mid-game**;
`ClientModel.spec.ts` (994) covers mirroring, round guards and dragging every rotation to both
walls; `aiPlay.spec.ts` is a _measurement_ (lookahead beats blind, `planPlacement` under 5 ms).

**Not covered:** `Presenter.tsx`, `RobotDemo.tsx`, sound/music wiring. `eittrisSimulation.ts`
has no spec of its own — it is exercised through the two model specs.

> jsdom cannot do `getContext("2d")`, so `Client.spec.tsx` prints canvas errors that are
> swallowed. Canvas rendering is asserted only via non-canvas DOM.
