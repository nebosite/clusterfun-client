# 101 — Design

A turn-taking racing game. Pieces race along a track by guessing numbers; unique guesses
move you forward, collisions knock you back. First piece to land **exactly on 101** wins.

Status: **mechanics playground** — the presenter UI is deliberately plain HTML/CSS,
awaiting a visual skin treatment (claude.ai/design). Do not invest in visuals yet.

## Rules

Each round, every piece secretly picks a number from 1–10. When all picks are in (or the
round timer expires — stragglers get a random pick), the round resolves:

- **Unique pick** — no other piece picked your number: move **forward by that number**.
- **Collision** — k ≥ 2 pieces picked the same number: each of those pieces moves
  **backward by k** (floored at position 0).
- **Landing on exactly 101 wins** (from either direction). Multiple simultaneous
  winners are all declared winners (tie).
- **Overshoot** — a forward move past 101 is allowed and leaves you in the
  **danger zone (102–111)**. From there you can't reach 101 going forward; only a
  collision can knock you back below it.
- **Bust** — a move that would take you **past 111** resets your position to **0**.

### Decisions made (change in `oneOhOneLogic.ts` if the mechanics need tuning)

- "First to 101" + "over 111 resets" only coexist if the win is _exact_ — so a win is
  landing exactly on 101, not reaching ≥ 101.
- A backward (collision) move that lands exactly on 101 also wins. Rationale: "first
  player to 101 wins," and it creates a fun rescue mechanic in the danger zone.
- Collision penalty is the number of pieces that picked the number (3 pickers → each
  goes back 3).
- Positions are clamped at 0 on the low end.

## Pieces, humans, and bots

- Up to **16 pieces** on the track.
- Every human controls the **same number of pieces** (1–4, host-selected in the
  gathering screen). Piece names are `Name 1`, `Name 2`, ... when a human has more
  than one; pieces inherit the human's avatar.
- The host can add **computer players** (one piece each) with three attitudes:
  - **Aggressive** — biased toward high guesses (7–10): big moves, big collision risk.
  - **Moderate** — biased toward the middle (4–7).
  - **Cautious** — biased toward low guesses (1–3): slow but rarely collides hard.
    Bots pick randomly from their attitude's weight table at resolve time — no strategy.
- Humans × pieces-per-human + bots ≤ 16, enforced by the gathering UI.
- Humans may join only during Gathering (pieces are built at game start). Rejoin
  mid-game is supported; a disconnected human's pieces just get random picks on
  timeout.

## Round flow (presenter is authoritative)

```
Gathering -> [start] -> Playing: collecting  -> resolve -> Playing: reveal -> next round
                          ^  (30s timer or all picks in)      (4s)             |
                          +----------------------------------------------------+
                                        ... until a piece lands on 101 -> GameOver
```

- **collecting** — players pick a number per piece, then **confirm** it (Confirm button
  per piece; a confirmed piece is locked for the round). The round resolves when every
  human piece is confirmed, or when the timer expires — at expiry, unconfirmed picks
  still count and pieces with no pick get a random one. Phones show the countdown.
- **resolve** — bots pick, missing picks are randomized, `resolveRound()` (pure) maps
  picks to moves.
- **reveal** — the presenter animates **one piece at a time, one step per position**,
  playing a click per step (bright tick forward, low thunk backward, ding on a bust
  snap; the moving lane is highlighted). A backward slide is preceded by a **crash
  sound** marking the collision. Reveal duration is computed from the moves
  (`computeRevealDurationMs`, including the crash beats). Phones show every piece's
  move summary. The next round starts automatically.
- **GameOver** — waits for the reveal to finish so the winning move gets its animation.
  Presenter: winner banner + pulsing highlight on the winning lane. Winning players'
  phones show a celebration graphic; everyone else sees the winner's name.

## Messages

| Endpoint                        | Direction                      | Payload                                        |
| ------------------------------- | ------------------------------ | ---------------------------------------------- |
| `OneOhOneOnboardClientEndpoint` | client -> presenter (req/resp) | full rebuild: phase, round, my pieces, winners |
| `OneOhOneSetGuessEndpoint`      | client -> presenter (req/resp) | `{pieceId, guess}` -> `{accepted}`             |
| `OneOhOneRoundStartEndpoint`    | presenter -> all               | `{roundNumber, secondsAllowed}`                |
| `OneOhOneRoundResultEndpoint`   | presenter -> all               | `{roundNumber, results[], winnerIds[]}`        |

Missed pushes are healed by the standard invalidate → onboard re-sync.

## Where the logic lives

All rule decisions are pure functions in [models/oneOhOneLogic.ts](models/oneOhOneLogic.ts)
with specs in `oneOhOneLogic.spec.ts` — tune mechanics there, and the models/UI follow.

## Later (deliberately out of scope now)

- Visual skin (claude.ai/design pass): track art, richer piece/collision effects,
  a real celebration graphic (the current one is placeholder CSS emoji).
- Smarter bot strategy (e.g., avoiding guaranteed busts in the danger zone).
