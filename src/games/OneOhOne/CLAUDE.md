# OneOhOne ("101")

A racing game. Each round, every **piece** secretly picks 1–10. A unique pick advances that
many; if _k_ ≥ 2 pieces pick the same number they each move **back** _k_ (floor 0). Land
**exactly** on the target to win; overshoot past the bust limit (target + 10) and reset to 0.

Position is the score. Ties are allowed. The target is host-selectable 11–101 on a slider.
Up to 16 pieces: humans get 1–4 each, and the host tops up with Aggressive / Moderate /
Cautious bots.

The smallest complete round-based game in the repo — a good structural reference, but read the
traps first, several are live bugs.

## Files

| File                                | Owns                                           |
| ----------------------------------- | ---------------------------------------------- |
| `models/oneOhOneLogic.ts` (206)     | **Pure rules**, fully specced (280-line spec). |
| `models/PresenterModel.ts` (460)    | Rounds, phases, bots, reveal animation, win.   |
| `models/ClientModel.ts` (249)       | Per-piece guess entry + confirm.               |
| `models/oneOhOneEndpoints.ts` (108) | Four endpoints.                                |
| `views/Presenter.tsx` (553)         | Track, slider, reveal animation.               |
| `views/Client.tsx` (272)            | Phone: one guess control per owned piece.      |

## State machine

`Gathering → OneOhOneGameState.Playing → GameOver`, plus `Paused`. Within `Playing`, a
sub-phase `OneOhOneRoundPhase = Collecting | Reveal` lives on `roundPhase`. **All transitions
are driven from `handleTick`** (`:319-331`).

`ROUND_TIME_MS = 30000` for Collecting; the Reveal length is computed per round by
`computeRevealDurationMs`. Collecting exits early once every human piece is confirmed.

## Endpoints

| Endpoint                | Dir     | Payload                                                   |
| ----------------------- | ------- | --------------------------------------------------------- |
| `OneOhOneOnboardClient` | C→P req | full phone state incl. `myPieces`, `lastResults`, winners |
| `OneOhOneSetGuess`      | C→P req | `{pieceId, guess, confirmed}` → `{accepted, reason?}`     |
| `OneOhOneRoundStart`    | P→all   | `{roundNumber, secondsAllowed}`                           |
| `OneOhOneRoundResult`   | P→all   | `{roundNumber, results, winnerIds, winnerNames}`          |

> The real re-sync safety net is **not** `InvalidateState` — the presenter only sends that on
> round 1 and on a target change. It is the `myPieces.length === 0` re-onboard inside
> `handleRoundStart` (`ClientModel.ts:183-185`). Keep that check if you touch the client.

## Traps

1. **Rejoin is broken — this is a live bug.** Pieces key on `ownerId = playerId`
   (`PresenterModel.ts:258`), the relay issues a new playerId on reconnect, and this model
   never overrides `onPlayerReturned`. The `p.ownerId === sender` filters (`:403`, `:442`)
   then match nothing, so **a reconnected player has zero pieces and cannot play**.
   `DESIGN.md:47-49` claims "rejoin mid-game is supported"; it is not. Fix by overriding
   `onPlayerReturned` (copy `Eittris/models/PresenterModel.ts:352`).
2. **`animationPathForMove` hardcodes a bust limit of 111** (`oneOhOneLogic.ts:153`) while the
   real edge is `winPosition + 10`. With a short target the animation runs off the track
   (`Presenter.tsx:41` `pct()` exceeds 100%).
3. **"101" and "111" are hardcoded in the UI** in five places despite the host-chosen target
   (`Presenter.tsx:48,54-59,388,421`, `Client.tsx:30`).
4. **The `winPosition` setter calls `saveCheckpoint()` and broadcasts `InvalidateState` on
   every slider input event** (`:129-133`) — a message storm while the host drags.
5. **`GeneralGameState.Playing`, `OneOhOneGameState.Playing` and `OneOhOneClientState.Playing`
   are all the literal string `"Playing"`**, so the guard at `:300` is a no-op by design.
   Don't "fix" it without understanding that.
6. **The type helper rehydrates only `pieces` and `bots` as observables** (`:99-109`);
   `lastResults` is a plain array, so views do not react to it. Any new observable array needs
   a matching case.
7. **`Presenter.tsx:457,485` create an `onTick.subscribe` and a MobX `reaction` in the
   constructor and never dispose them.**
8. **"Play again" calls `startGame()`, not `playAgain()`** (`Presenter.tsx:425`) — it reuses
   stale player ids and the previous bot lineup.
9. `minPlayers = 1`, but the base `pauseWhenTooFewPlayers` defaults true — the last human
   quitting pauses the game even though the bots could finish it.
10. `RevealAnimator` animates a **display copy**. New views must read `animator.positionFor()`,
    not `piece.position`.
11. Mutations in `handleSetGuess` / `resolveCurrentRound` are **not wrapped in `action()`**.
12. Bot avatar index is `(newPieces.length + i) % 8` (`:274`), which double-counts, so avatars
    skip.

## DESIGN.md drift

`DESIGN.md` predates the host-selectable target and is stale on all four endpoints, the reveal
duration ("4s" — actually computed), the re-sync mechanism, and rejoin support (trap 1).
Accurate: the core rules, bot attitudes, ≤16 pieces, 1–4 per human, confirm-or-timeout,
GameOver-waits-for-reveal, and "visuals deliberately plain".

## Testing

`oneOhOneLogic.spec.ts` (280 lines) covers the pure layer well: every resolve case (forward,
collision, floor at 0, exact win, overshoot, collision-rescue win, bust, simultaneous
winners), bot legality and skew, animation path shapes, reveal duration, piece allotment, and
target sanitizing.

**Untested:** the presenter and client state machines, every endpoint handler, the serializer
round-trip, `describeMove`, duplicate `pieceId`s, and `animationPathForMove` under a
non-default target (which is where trap 2 lives).
