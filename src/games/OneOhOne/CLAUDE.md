# OneOhOne ("101")

A racing game. Each round, every **piece** secretly picks a number. A unique pick advances
that many; if _k_ ≥ 2 pieces pick the same number they each move **back** _k_ (floor 0). Land
**exactly** on the target to win; overshoot past the bust limit and reset to 0.

**The range grows with the field: 1..N where N is 5 + the number of PIECES racing.** Pieces,
not people - a player with four pieces is four things picking numbers, and it is the pickers
that collide. A fixed 1-10 made this two different games: with three pieces a collision was
bad luck, with sixteen it was nearly unavoidable and the whole field slid backwards every
round.

Position is the score. Ties are allowed. The target is one of **21 / 31 / 41 / 51**, default
41 - four buttons rather than a slider over every number in between, which was a false choice
and fired a checkpoint save and an InvalidateState broadcast on every drag event. Up to 16
pieces: humans get 1–4 each, and the host tops up with Aggressive / Moderate / Cautious bots.

## The reveal is PHASED, and that is the point

`RevealAnimator` used to walk one piece at a time from start to finish. With sixteen pieces
that was a minute of watching other people's turns, and it hid the thing a round is actually
about - who picked the same number as whom, which is a fact about the WHOLE FIELD and only
legible if the field is shown at once.

Three beats, in the order the rules resolve:

1. **PICKS** — every number on screen together, conflicts behind a spiky red splash. Nobody
   moves. A conflict is shown even for a piece at zero with nowhere to slide: it still
   collided.
2. **BACK** — every colliding piece slides backwards, simultaneously.
3. **FORWARD** — every clean pick advances, simultaneously. Pot payouts go last of all.

`computePhasedRevealMs` charges each phase for its **longest** move, not the sum - that is
what makes a sixteen-piece round watchable - and skips a phase's trailing beat when nothing
in it actually moved. It must agree with the animator, because the presenter sets
`timeOfStageEnd` from it; under-count and the next round starts on top of the animation.

## Two optional catch-up rules

101 is a race in which a piece that falls behind has no way to gain on the field faster than
anybody else, so a bad early round used to decide the game before it got interesting. Both are
host toggles in the setup box.

- **Lone last place gets +5** (on by default). Decided on the standings at the START of the
  round, because a bonus you could not have predicted is a surprise rather than a mechanic.
  Two pieces tied at the back get nothing — the rule rescues somebody who is out of it on
  their own.
- **The collision pot** (off by default). Every number somebody collided on feeds it once,
  however big the pile-up. It pays out the first time a piece **enters** the end zone, split
  between everyone at the back, and only once per game. A leader camping in the zone does not
  trigger it again every round.

The **end zone** — the stretch from which the target is reachable in one move — is shaded on
the course, because "am I close enough to win this round" is the only question that matters
once the race is on and counting squares from across a room is not a game mechanic.

The smallest complete round-based game in the repo — a good structural reference, but read the
traps first, several are live bugs.

## Files

| File                                | Owns                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `models/oneOhOneLogic.ts`           | **Pure rules**, fully specced across three spec files. |
| `models/PresenterModel.ts` (460)    | Rounds, phases, bots, reveal animation, win.           |
| `models/ClientModel.ts` (249)       | Per-piece guess entry + confirm.                       |
| `models/oneOhOneEndpoints.ts` (108) | Four endpoints.                                        |
| `views/Presenter.tsx` (553)         | Track, slider, reveal animation.                       |
| `views/Client.tsx` (272)            | Phone: one guess control per owned piece.              |

## State machine

`Gathering → OneOhOneGameState.Playing → GameOver`, plus `Paused`. Within `Playing`, a
sub-phase `OneOhOneRoundPhase = Collecting | Reveal` lives on `roundPhase`. **All transitions
are driven from `handleTick`** (`:319-331`).

`ROUND_TIME_MS = 30000` for Collecting; the Reveal length is computed per round by
`computePhasedRevealMs`. Collecting exits early once every human piece is confirmed.

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

1. ~~**Rejoin is broken**~~ — **fixed.** Pieces key on `ownerId = playerId`, and player ids are
   permanent now, so a reconnecting player comes back to their own pieces and the
   `p.ownerId === sender` filters still match. Covered by `models/PresenterModel.spec.ts`
   ("a reconnected player can still play"). `DESIGN.md:47-49` claims rejoin is supported —
   it finally is.
2. ~~**`animationPathForMove` hardcodes a bust limit of 111**~~ — **fixed.** It takes the
   game's real edge, and on a short track no longer walks a piece off the end of the board.
3. ~~**"101" and "111" are hardcoded in the UI**~~ — **fixed.** The rule text, the in-play
   subtitle and the bust message are all built from the chosen target and the live range.
4. ~~**The `winPosition` setter storms on every slider event**~~ — **fixed.** The slider is
   gone; the target is four buttons.
5. **`GeneralGameState.Playing`, `OneOhOneGameState.Playing` and `OneOhOneClientState.Playing`
   are all the literal string `"Playing"`**, so the guard at `:300` is a no-op by design.
   Don't "fix" it without understanding that.
6. **The type helper rehydrates only `pieces` and `bots` as observables** (`:99-109`);
   `lastResults` is a plain array, so views do not react to it. Any new observable array needs
   a matching case. `recentGuesses` lives INSIDE a piece, so it rides along with `pieces`.
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

`oneOhOneRules.spec.ts` covers the field-scaled range, the bot curves at any width, the end
zone, and both catch-up rules. `revealTiming.spec.ts` covers the phased duration, including
that a phase charges for its longest move rather than the sum, and that a bust is counted
against THIS game's edge.

**Untested:** the presenter and client state machines, every endpoint handler, the serializer
round-trip, `describeMove`, and duplicate `pieceId`s.
