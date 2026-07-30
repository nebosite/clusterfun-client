# EITtris — Design

A frenetic vs-Tetris for many simultaneous players, ported from the C# MonoGame original
(`F:\Git\eitrix`) to the ClusterFun presenter/client architecture. Every player plays a
full Tetris board on their own phone/PC; the host screen shows everyone's boards side by
side; powerups (later increments) let players mess with each other.

Status: **Increment 1 — basic multiplayer Tetris over the ClusterFun interface.** Standard
pieces, touch controls, authoritative host, last-player-standing. No powerups yet, minimal
visual fit and finish. The full eitrix catalog is documented below so later increments can
port it faithfully.

## Architecture (the one big departure from other ClusterFun games)

The **host (presenter) is the source of truth for every board**. It runs the simulation for
all players — gravity, collision, locking, line clears, scoring — on its game tick. Clients
are thin: they translate touch gestures into small **commands**, send them to the host, and
render their own board from the compact **board updates** the host sends back. A client
never decides anything authoritative about its own board.

```
phone gesture ──command──▶ presenter simulates ──board update──▶ phone animates its grid
                                    │
                                    └────────▶ host screen renders ALL grids (direct model access)
```

Board updates ride the standard `sendToEveryone` broadcast, but the payload generator is
per-player, so each phone receives only _its own_ board state (~250 bytes). Missed updates
are healed by the standard invalidate → onboard resync.

## Increment 1 rules (faithful to eitrix unless noted)

- **Grid:** 10 × 21, row 0 at top. Cells above the top are legal and non-colliding.
- **Pieces:** the 7 standard tetrominoes only (user call for v1; eitrix's 4 "extra pieces"
  ship default-on in the original — later increment). Shapes and rotation match eitrix:
  pure 90° matrix rotation about a center (or corner for O), **no SRS, no wall kicks,
  no lock delay** — a rotate or move that collides is simply refused, and a piece locks
  the instant it lands. This is the original's feel; revisit only if playtests hate it.
- **Piece colors** (eitrix's own, deliberately non-standard): T cyan, I red, L green,
  reverse-L magenta, Z orange, reverse-Z yellow, O blue.
- **Spawn:** uniform random piece type (no 7-bag), random initial rotation, at column 5,
  row 0. Next-piece queue; the phone shows the next 2.
- **Gravity:** starts at 1.0 s per row and continuously accelerates using eitrix's curve
  converted to per-second form (the C# decays per _frame_): `interval *= exp(-0.006 * dt)`
  with the linear floor `interval -= 0.00005 * 60 * dt` once below ~0.5 s. One continuous
  ramp, no levels. (~1.0 s → 0.5 s over ~2 minutes at the default rate.)
- **Drops:** dragging the piece downward pays +10 points per row descended (drag contact
  never locks — see controls). Hard drop = slam to floor and stick (+10/row). The next
  piece spawns with completely normal gravity (a carry-over "plummet" mode was tried and
  removed by user request).
- **Spawn gap:** a locked piece is followed by a 200 ms gap (`SPAWN_DELAY_MS`) with **no
  falling piece at all** before the next one appears. Both ends refuse input during it —
  the presenter drops every piece command (only `pickTarget` still works) and the phone
  won't start or continue a gesture. This is the structural cure for gestures leaking onto
  the next piece: a flick whose pointer-up lands off-screen has nothing left to act on.
  Death is evaluated when the delayed piece spawns, not when the previous one locks.
- **Line clear:** atomic full-row clear (the original's per-cell 0.4 s cascade is a later
  polish item). Score `+= rows² × 1000` (1→1000, 2→4000, 3→9000, 4→16000). Rows counted.
- **Game over (per player):** a freshly spawned piece that immediately collides kills the
  board. **Game end: last player standing wins**; if the host quits the round early,
  survivors rank by score. Death order breaks ties (survived longest = better).

## Touch controls (phone) — the input scheme is gesture-only

| Gesture                        | Action                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Free drag** (any direction)  | The piece follows the finger horizontally AND downward at once (never up); +10 per row descended |
| **Release after a drag**       | Locks the piece only if it is resting; an airborne piece just resumes gravity                    |
| **Tap**                        | Rotate clockwise. Every gesture works anywhere on the grid and acts on the falling piece         |
| **Double tap** (within 300 ms) | Drop the piece, exactly like a downward flick. The first tap's rotation is taken back first      |

### Keyboard and controller

A player at a PC gets keys; anyone with a pad attached (PC or phone) gets the pad. Both go
through the shared `libs/Input` framework, and both sit alongside the touch gestures rather
than replacing them. Bindings live in `models/eittrisInput.ts`.

| Action        | Keys                  | Controller          |
| ------------- | --------------------- | ------------------- |
| Move left     | ← / A / J / Num 4     | D-pad ←, left stick |
| Move right    | → / D / L / Num 6     | D-pad →, left stick |
| Move down one | ↓ / S / K / Num 5     | D-pad ↓, left stick |
| Drop          | Space / Num 8         | D-pad ↑, Y          |
| Rotate right  | ↑ / W / I / Num 3 / X | A                   |
| Rotate left   | Z / Ctrl / Num 7      | B                   |
| Prev target   | Q / [ / PageUp        | LB                  |
| Next target   | E / ] / PageDown      | RB                  |
| Use antidote  | F / Enter / Num 0     | X                   |

Four keyboard clusters (arrows, WASD, IJKL, numpad) each carry left/right/down/rotate, so
several people at one PC can each use the keys nearest their hands. Only the three movement
actions repeat while held (170 ms, then every 50 ms).

Movement from a key or pad is **one cell**, sent as `moveLeft`/`moveRight`/`moveDown` -
deliberately not `dragTo`, which takes an absolute column and is mirrored by CrazyIvan, so a
"one step left" routed through it would fling the piece across the board. CrazyIvan inverts
rotation as well as left/right.
| **Swipe left / right** (fast flick) | Slam the piece all the way left / right |
| **Swipe down** (fast flick) | Hard drop (slam + stick); the next piece is unaffected |
| **Swipe up** (fast flick) | Rotate clockwise |

Desktop/PC uses the same pointer gestures with a mouse. Gestures are classified locally on
the client (drag vs. flick vs. tap by duration/distance), and only discrete commands cross
the wire: `dragTo(column, row)`, `release`, `hardDrop`, `slamLeft`, `slamRight`, `rotate`,
`pickTarget(targetId)`. Drag-induced contact never locks the piece; only `release` (when
resting) or a natural gravity landing does. Rotation via a drawn circle gesture is a
later-increment experiment (user request).

## Host screen (increment 1)

All live boards side by side — name + avatar (plus the board's current target, small), mini
grid drawn over the board's randomly-assigned eitrix Grid background (no grid lines),
score/rows. Panels shrink to fit horizontally as the player count grows (eitrix squeezes
past 4 players; we scale to fit 16). Dead boards dim with a "topped out" marker. Winner
banner at game end. Plain visuals; the design pass comes later.

## Powerups (increment 2 — in progress)

Ported from the original's `Specials.cs`. Icons come straight from the eitrix atlas
(`BrickAndOverlay.png` cells 10–25 → `assets/images/specials.png`, a 16-icon strip in
`SpecialType` order).

- **Appearing:** every `SPECIAL_INTERVAL_MS` (8 s) one random settled block on your OWN
  board is tagged. **Only one special is ever on a board at a time, and it never decays** —
  it waits there until you clear its row, and nothing new appears until then. (The original
  decayed tags after 12 s and allowed several; this is a deliberate house change.)
- **Collecting:** clearing the marked block's row collects it. Markers above a cleared row
  ride down with their blocks.
- **Rolls:** 50% antidote (`ANTIDOTE_CHANCE`), otherwise a random implemented special.
  `IMPLEMENTED_SPECIALS` gates what can appear, so unported specials never show up.
- **Defensive vs offensive:** defensive specials are kept by the collector; offensive ones
  (`OFFENSIVE_SPECIALS`) fire immediately at the collector's current **target**. A victim
  with an antidote shield up **repels** the hit — no effect, and everyone is told it bounced.
- **Antidote** (implemented): banked as a charge (max 4, everyone starts with 1). Firing it
  cures all afflictions/attacks and repels new ones for 10 s. The phone has a button showing
  the flask icon and the count, plus a `SHIELDED` countdown while it's up.
- **Attack stencils:** the eitrix signature - an offensive special paints a shape into the
  BOTTOM of the victim's grid, one row per `STENCIL_ROW_MS` (100 ms), **overwriting** what is
  there rather than pushing the stack up, and randomly mirrored. `'#'` places a garbage block
  (`GARBAGE_CELL`, its own gray), `'-'` destroys whatever is there, `'.'` leaves it alone. If
  the burial leaves the victim's falling piece inside solid blocks it is lifted clear (it may
  end up above the board, which tops out naturally on the next lock). Escalator, Bridge,
  Shackle and TowerOfEit are all just different shapes through this same machinery.
- **TheWall** (implemented): 8 solid rows, each with one random gap - a ragged chimney. Plays
  the original `Attack04.wav`.
- **Speedup** (implemented): the victim's gravity interval is permanently multiplied by
  `SPEEDUP_FACTOR` (0.6, verbatim from the original), floored at `MIN_INTERVAL_MS` so a
  stack of them can't make a board literally unplayable. Plays the original `Speedup.wav`
  (`Attack02.wav` when repelled) and flashes a banner on every phone.
- **Dev selector:** in dev mode only (`DevOnly`), the phone shows a `Force special` dropdown.
  Picking a type makes it the only one that spawns, and it appears immediately instead of
  waiting out the interval. Default `(normal random)` = normal play.

**All 16 specials are implemented.** They fall into four families:

- _Stencil attacks_ (TheWall, Escalator, Shackle, TowerOfEit) - paint a shape into the bottom
  of the victim's grid, one row per 100 ms. `STENCIL_SHAPES` + `stencilShapeFor()`.
- _Other attacks_ - Bridge (roofs the stack, column by column; also free on a 4-row clear),
  Jumble (200 single-block nudges), SwitchScreens (trade stacks a column at a time).
- _Afflictions_ (Speedup, EvilPieces, CrazyIvan, FreezeDried, Transparency, Psycho) - each wears
  off on its own after **22 s** (`AFFLICTION_DURATION_MS`); a repeat hit refreshes that clock
  rather than stacking a second one, and an antidote still lifts them all at once. The table
  driving expiry, curing, and the phone's status chips is `AFFLICTION_TIMERS`.
- _Kept for yourself_ (Antidote, SlowDown, SeeShadows) - no antidote strips your own perks.

## Computer player (dev tool)

A `CPU` checkbox beside the dev special picker hands a board to the computer. One
difficulty for now:

- It only **rotates and steps sideways**, twice a second (`AI_MOVE_INTERVAL_MS`), lining the
  piece up so normal gravity drops it where it wants — it never hard-drops.
- `planPlacement` tries every rotation at every column, simulates the landing, and scores it:
  a heavy penalty for **new covered gaps** (an empty cell roofed from above), then a bonus for
  landing **low**, then for **contact** with walls/floor/settled blocks (`AI_GAP_PENALTY`,
  `AI_DEPTH_WEIGHT`, `AI_CONTACT_WEIGHT`).
- It pops an **antidote as soon as it is afflicted**, before worrying about placement.
- All of it is pure and specced in `eittrisLogic.spec.ts`; the presenter just calls
  `planPlacement` + `nextAiMove` on its tick.

Note S/Z pieces provably cannot avoid making a hole on flat ground, so the planner minimises
gaps rather than guaranteeing zero.

## Targeting (increment 1.5 — groundwork for powerups)

Each board has a `targetId`, initialized as a ring at game start (player _i_ targets
_i_+1 mod _n_; null when solo). The phone shows the OTHER players below the board — avatar,
name, alive state, and a live **1-bit thumbnail** of their board (one bit per cell, settled
or current-piece, 210 bits packed into 27 bytes → 36-char base64). The current target is
highlighted; tapping a living entry sends `pickTarget`. When a player dies, every board
targeting them auto-retargets to the next living non-self player in ring order (null if
none). Thumbnails broadcast as ONE shared payload every ~1 s, only when a board changed.

## States

- **Presenter:** Gathering → Playing (all boards simulate on the shared tick) → GameOver.
- **Client:** WaitingToStart → Playing (own board) → Dead (spectating own frozen board,
  waiting for the round to end) → GameOver.

## Message table (increment 1)

| Endpoint                       | Direction                                    | Payload                                                                                                             |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `EittrisOnboardClientEndpoint` | client → presenter (req/resp)                | → `{gameState, board?: full own-board snapshot, winnerName, youWon}`                                                |
| `EittrisCommandEndpoint`       | client → presenter (fire-and-forget)         | `{command, column?, row?, targetId?}` — dragTo / release / hardDrop / slamLeft / slamRight / rotate / pickTarget    |
| `EittrisBoardUpdateEndpoint`   | presenter → each client (per-player payload) | `{grid: string, piece: {type, rot, x, y}, next: type[], score, rows, alive, intervalMs, backgroundIndex, targetId}` |
| `EittrisThumbnailsEndpoint`    | presenter → everyone (one shared payload)    | `{players: [{playerId, name, avatarId, alive, thumb: 36-char base64}]}` — every ~1 s, only when a board changed     |

`grid` is a 210-char string (one char per cell, `.` empty / piece-type digit). Standard
Join/Ping/InvalidateState/GameOver endpoints from the framework.

Update cadence: the presenter pushes a board update to a player **only when that board
changes** (piece moved/rotated/fell/locked, rows cleared, death) — worst case a few per
second per player; no fixed-rate streaming.

## Where the logic lives

All simulation rules are pure functions in `models/eittrisLogic.ts` with Jest specs:
piece shape/rotation tables, collision, movement/slam resolution, lock + clear + score,
spawn queue, and the gravity curve. The presenter model orchestrates per-player board
structs and timers; it makes no rule decisions inline.

## Later increments (the eitrix catalog — port targets, not v1)

1. **Extra pieces** (default-on in the original): short-I, short-L, reverse short-L,
   2-block domino.
2. **Specials/powerups system** — markers spawn on random settled blocks every 8 s
   (50% antidote), decay after 12 s, and are collected by clearing their row. Victim
   targeting is a ring with a "change victim" control. The 16 specials, verbatim from the
   C# (`Specials.cs`):
   - **Speedup** — victim's gravity interval ×0.6, permanent.
   - **Escalator** — paints a 10-row diagonal staircase up the victim's board.
   - **SlowDown** — your own gravity ×1.3 (a self-buff; targets victim in co-op mode).
   - **Jumble** — 200 random single-block scrambles shake the victim's stack apart.
   - **Psycho** — every color the victim sees comes out of a palette of 32 random ones,
     the falling piece smears a translucent trail behind it, and the whole background
     XORs to a different scramble of itself with each new piece (until cured).
   - **Antidote** — stored (max 4); when fired: cures all afflictions/attacks and repels
     new ones for 10 s. Players start with 1.
   - **TheWall** — buries the victim under 8 solid rows, each with one random gap.
   - **SeeShadows** — a faint ghost of the piece appears where it would land.
   - **Bridge** — paints 2 gapped rows directly on top of the victim's stack. Also
     auto-fires at your victim on any 4-line clear.
   - **EvilPieces** — the victim gets nothing but Z pieces, left- and right-handed,
     until cured. Both leave a hole on flat ground however they are turned.
   - **CrazyIvan** — inverts the victim's left/right and rotation controls until cured.
   - **Shackle** — paints an 11-row hollow ring of garbage in the victim's board.
   - **TowerOfEit** — paints a 12-row dark-gray castle tower in the victim's board.
   - **SwitchScreens** — swaps the two boards column by column. You trade stacks.
   - **FreezeDried** — victim's settled blocks render tiny and jittered (unreadable)
     until cured.
   - **Transparency** — the victim's settled stack drops to bare ghost outlines (the
     same brick sprite the landing shadow uses) until cured.
     Attack stencils are painted row by row (~0.1 s per row) in the attacker's color.

### Robot players

The host can add **0-4 robots** on the gathering screen. A robot is a board the host
simulates with the existing computer player - it is deliberately **not** an entry in
`players`, because a player id the relay has never heard of would be handed real network
messages by every broadcast. Their whole identity is derived from the index (`robotRoster`),
so the only thing that needs saving is the count.

Robots never change how many humans are needed: one human is always enough to start, and
zero humans is never enough.

3. **Rounds/tourney** — 5 rounds, placement points 8/5/3/2/1/1/1/0.
4. **Visual/audio port** — glossy brick + bevel atlas rendering, glow behind the falling
   piece, rainbow pulse on special-marked blocks, landing puff/explode/spark animations,
   per-player background art, the 50-sound effect set, attack arrows between panels.
5. **Polish/AI** — per-cell clear cascade animation, circle-gesture rotation, computer
   players (eitrix has a 4-difficulty heuristic AI worth porting for testing and filler).
