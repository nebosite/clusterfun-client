# Lexible

Two-team territory word game on a shared letter grid. Players spell contiguous words by
dragging across letters on their phone; a valid word claims each tile **at that word's
length**, and a tile can only be stolen by a **strictly longer** word. First team to own an
orthogonally-contiguous path from their side of the board to the other wins the round.

The flagship shipped game, and the oldest. Note the asymmetry: it is one of the most-played
games and one of the least-tested (**one spec file**, covering path-finding only).

## Files

| File                                           | Owns                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `models/PresenterModel.ts` (815)               | Grid build, word validation, capture/scoring, win detection, teams. |
| `models/ClientModel.ts` (398)                  | Letter chain selection, hint filtering, submission.                 |
| `models/lexibleEndpoints.ts` (146)             | Wire types, all under `/games/lexible/...`.                         |
| `models/LetterGridPath.ts` (185)               | A* path search. **The only specced file.**                          |
| `models/LetterGridModel.ts` (104)              | `rows[y][x]` + the wire serialization format.                       |
| `models/LetterBlockModel.ts` (115)             | One tile: letter, score, team, selection, fail animation.           |
| `models/WordTree.ts` (45)                      | Plain parent-linked trie, used for hints only.                      |
| `views/Presenter.tsx` (602)                    | All stage pages, sound/voice wiring.                                |
| `views/Client.tsx` + `ClientGameComponent.tsx` | Phone: the drag-to-spell grid.                                      |
| `assets/words/Collins_Scrabble_2019.ts`        | 2.82 MB word list. See _Bundle_ below.                              |

## Two different word mechanisms — do not conflate them

1. **Submission** validates against `wordSet: Set<string>` — an exact lookup
   (`PresenterModel.ts:770`). It rebuilds the word from _live grid state_ and substitutes `#`
   for any tile that doesn't match what the client claimed, so a desynced client simply fails
   (`:754-768`).
2. **Hints** use `wordTree` — a DFS from the tapped block (`findWords`, `:542-587`).

**Diagonals differ between the two rules and this is deliberate:** spelling walks all 8
neighbors; the win-path connection is 4-way only (`LetterGridPath.ts:158-163`).

## Win detection

`findHotPathInGrid` (`LetterGridPath.ts:102`) does A* for one team with a lexicographic cost
`(enemy+neutral, enemy, ally+manhattan)`. **The same function both draws the current best path
and decides the win** — a win is `cost.enemy === 0 && cost.neutral === 0`. It uses a custom
`Vector2Map` because `Vector2` is not value-hashable.

## Bundle: the 2.82 MB word list

`Collins_Scrabble_2019.ts` is one giant template literal, loaded by **dynamic `import()`** in
`populateWordSet()` (`PresenterModel.ts:327-357`). Webpack therefore emits it as its own chunk
— **3.10 MB raw / 732 KB gzipped**, versus 182 KB for `main.js`. It is the largest artifact in
the build, and **only the presenter ever fetches it**; phones never do. Parsing is
cooperatively yielded (`await this.waitForRealTime(0)` every 10 ms, checking `isShutdown`), so
the tree+set build spans many frames instead of freezing the screen.

> **Memory:** the trie makes every node a class instance holding a `Map` and a parent pointer,
> and `wordSet` retains all ~280k strings again. This is on the order of **150–250 MB of heap
> on the presenter** and is the single largest memory consumer in the app. It is the most
> likely cause if a presenter tab dies on modest hardware. A flat `Set` + prefix set, or a
> packed DAWG, would cost a fraction — see the risk register.

Neither structure is checkpointed (`shouldStringify` skips `wordTree` and `wordSet`); both are
rebuilt by `populateWordSet()` on every `reconstitute()`.

## Endpoints

| Endpoint                              | Dir      | Notes                                                                                                                                 |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `LexibleOnboardClient`                | C→P req  | grid data, team, `startFromTeamArea`                                                                                                  |
| `LexibleSwitchTeam`                   | C→P req  | refused if it would empty the other team                                                                                              |
| `LexibleReportTouchLetter`            | C→P fire | drives the shared "who's touching what" glow                                                                                          |
| `LexibleServerRecentlyTouchedLetters` | P→all    | flushed from `handleTick`                                                                                                             |
| `LexibleRequestWordHints`             | C→P req  | trie DFS                                                                                                                              |
| `LexibleSubmitWord`                   | C→P req  | the authoritative path                                                                                                                |
| `LexibleBoardUpdate`                  | P→all    | **`suggestedRetryIntervalMs: Infinity`** — fire-once, never retried. A dropped update is only healed by a later win-check or onboard. |
| `LexibleEndRound`                     | P→all    |                                                                                                                                       |

## Traps

1. **There is effectively no round timer.** `PLAYTIME_MS = 900000000` (~250 hours) and
   `handleTick` never checks `timeOfStageEnd`. "Timed game" is an unimplemented TODO — do not
   assume the stage-timer machinery is wired up here.
2. **`checkForWin` is `async` and animates**, awaiting ~50 ms per path node (`:611-624`). A
   second word landing mid-animation **re-enters it**, unguarded.
3. **Path logic is duplicated.** Presenter (`:594`) and client (`ClientModel.ts:248`) each run
   `findHotPathInGrid`. Only the presenter's result declares a win, but the two can drift
   visually.
4. **`reconstitute` must re-attach `onSelectedChanged` to every block** (`:307-309`) as well as
   the endpoint listeners. A restored block otherwise logs a `"WEIRD: Default select action"`
   warning.
5. **"Qu" is a single block**, not two letters (`LetterGridModel.ts:51`).
6. **The wire format is 3 chars per tile** — letter, team, score-as-char — and scores above 9
   continue past `'9'` into `":;<=>?@A..."` (`:89`). The table runs out past 42. This
   round-trip is **untested**.
7. `letterDeck` can come up short of `width*height`; `populate` wraps the index around the grid
   size rather than erroring.
8. `selectedMap` is a per-block array of playerIds and **nothing clears it on disconnect**, so
   stale highlights persist.
9. **Team membership is keyed by `playerId`** — safe, because player ids are permanent across
   a reconnect. `onPlayerDisconnected` clears the dropped player's half-selected letters so
   they do not glow on the shared board with nobody behind them. See the lifecycle contract in
   [../../../CLAUDE.md](../../../CLAUDE.md).
10. `Presenter.tsx:576` has hidden debug "Win: A" / "Win: B" buttons behind a debug click.

## Testing

`models/LetterGridPath.spec.ts` (133 lines, uses `chai`) is **the only spec**: cost
classification, fuzz "doesn't crash" over 1–100 sized grids, and random-walk "finds the
winning path".

**Untested:** `WordTree`, `findWords`, the grid `serialize`/`deserialize` round-trip (the wire
format), `placeSuccessfulWord` capture and scoring, `handleSubmitWord` validation and the `#`
desync path, team assignment and switching, both type helpers, every endpoint handler, and
letter-deck generation. Roughly 1,200 lines of model logic with no coverage.
