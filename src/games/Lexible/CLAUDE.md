# Lexible

Two-team territory word game on a shared letter grid. Players spell contiguous words by
dragging across letters on their phone; a valid word claims each tile **at that word's
length**, and a tile can only be stolen by a **strictly longer** word.

**Both teams start on the LEFT and both race to the RIGHT edge.** Team A owns column 0 on odd
rows, team B column 1 on even rows — interleaved, so neither is walled in by the other. They
used to own opposite edges and run at each other, which meant the two teams were never playing
the same board. The one definition lives in `models/teamAreas.ts` and is read by three things
that must agree: the seeding, the win search, and the board outline.

The flagship shipped game, and the oldest.

## Files

| File                                           | Owns                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `models/PresenterModel.ts`                     | Grid build, word validation, capture/scoring, win detection, teams.                 |
| `models/ClientModel.ts`                        | Letter chain selection, hint filtering, submission.                                 |
| `models/lexibleEndpoints.ts`                   | Wire types, all under `/games/lexible/...`.                                         |
| `models/teamAreas.ts`                          | Where each team starts, where both are going, which owned tiles are joined to home. |
| `models/LetterGridPath.ts`                     | A\* win search: from a team's home cells to the right edge.                         |
| `models/gridLayout.ts`                         | Board size: the host picks rows; tile size and column count follow.                 |
| `models/wordSearch.ts`                         | The hint search. Pure, and property-tested.                                         |
| `models/dragSelection.ts`                      | What a drag across the board does to the word being spelled.                        |
| `models/LetterGridModel.ts`                    | `rows[y][x]` + the wire serialization format.                                       |
| `models/LetterBlockModel.ts`                   | One tile: letter, score, team, selection, home-connection, fail animation.          |
| `models/WordTree.ts`                           | Plain parent-linked trie, used for hints only.                                      |
| `views/Presenter.tsx`                          | All stage pages; speech wiring. Both team rosters stack in ONE left column.         |
| `views/Client.tsx` + `ClientGameComponent.tsx` | Phone: the drag-to-spell grid.                                                      |
| `assets/words/words50k.txt.gz`                 | The dictionary, 50,000 words gzipped. See _The dictionary_ below.                   |

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

## The dictionary

**50,000 words in a 137KB gzipped text file**, fetched at runtime by
`assets/words/wordList.ts` and inflated with the browser's `DecompressionStream`.

It used to be the full 279,496-word Collins tournament list as a 2.8MB TypeScript module —
parsed as _source_ by the JS engine, and held as a trie of ~1M class instances plus a Set of
every string again, on the order of 150–250MB of presenter heap. That was the largest single
allocation in the app and the most likely reason a presenter tab would die before a party
started. The list was pared down by ranking each Collins word by real-world usage
(`wordfreq`, cutoff zipf 2.16); the original and the recipe are in `_artifacts/`.

Still presenter-only and still lazy — a phone never downloads a dictionary — and the parse is
cooperatively yielded (`await this.waitForRealTime(0)` every 10ms, checking `isShutdown`) so
the tree+set build spans frames rather than freezing the screen.

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

1. **Board size is one number.** The host picks ROWS on a slider; `gridLayout.ts` derives the
   tile size (rows fill the play area's height) and the column count (columns fill its width).
   The old Small/Medium/Large setting is gone. The presenter's `.playColumn` CSS width and
   `PLAY_AREA_WIDTH` must stay in step.
2. **A drag that starts on a letter you may begin a word from SPELLS; anything else SCROLLS.**
   Decided once, on touch-down, in `ClientGameComponent.handleSelectDragStart`, and enforced by
   not letting the event reach the Slider — `Touchable` listens on its own container, so
   `stopPropagation` is what keeps the board still. Retracing the drag removes letters.
3. **Tile colour encodes strength**, not just ownership: saturation ramps from 20% at score 3
   to full at 9+ (`cozyTheme.teamColorForScore`). Only saturation moves, so hue still names the
   team and the white letter keeps its contrast.
4. **The team-coloured outline** marks tiles genuinely joined to that team's home, four-way,
   through its own tiles. Only outward-facing edges are drawn, so a region gets one outline
   rather than a box per tile. Recomputed by `updateHomeConnections()` whenever the board
   changes — call it if you add another way to change tile ownership.
5. **An inline `transform` on the badge overrides the stylesheet's corner offset.** The badge's
   position comes from `translate(22%, 22%)` in `LetterBlock.module.css`; the inline nudge must
   ADD to it (`calc(22% + 2px)`), not replace it. Replacing it drags the badge over the letter.
6. **There is effectively no round timer.** `PLAYTIME_MS = 900000000` (~250 hours) and
   `handleTick` never checks `timeOfStageEnd`. "Timed game" is an unimplemented TODO — do not
   assume the stage-timer machinery is wired up here.
7. **`checkForWin` is `async` and animates**, awaiting ~50 ms per path node (`:611-624`). A
   second word landing mid-animation **re-enters it**, unguarded.
8. **Path logic is duplicated.** Presenter (`:594`) and client (`ClientModel.ts:248`) each run
   `findHotPathInGrid`. Only the presenter's result declares a win, but the two can drift
   visually.
9. **`reconstitute` must re-attach `onSelectedChanged` to every block** (`:307-309`) as well as
   the endpoint listeners. A restored block otherwise logs a `"WEIRD: Default select action"`
   warning.
10. **"Qu" is a single block**, not two letters (`LetterGridModel.ts:51`).
11. **The wire format is 3 chars per tile** — letter, team, score-as-char — and scores above 9
    continue past `'9'` into `":;<=>?@A..."` (`:89`). The table runs out past 42. This
    round-trip is **untested**.
12. `letterDeck` can come up short of `width*height`; `populate` wraps the index around the grid
    size rather than erroring.
13. `selectedMap` is a per-block array of playerIds and **nothing clears it on disconnect**, so
    stale highlights persist.
14. **Team membership is keyed by `playerId`** — safe, because player ids are permanent across
    a reconnect. `onPlayerDisconnected` clears the dropped player's half-selected letters so
    they do not glow on the shared board with nobody behind them. See the lifecycle contract in
    [../../../CLAUDE.md](../../../CLAUDE.md).
15. `Presenter.tsx:576` has hidden debug "Win: A" / "Win: B" buttons behind a debug click.

## Testing

Now ~80 tests across five specs:

- `LetterGridPath.spec.ts` — the win search, plus the new starting geometry.
- `teamAreas.spec.ts` — the connected-to-home flood fill the outline is drawn from.
- `gridLayout.spec.ts` — the board always fits: rows fill the height, columns fill the width.
- `dragSelection.spec.ts` — start / extend / retract, including that a letter is never reused.
- `wordSearch.spec.ts` — **the hint list is verified as a property**: every word it offers is
  walked over the board by an independent path-finder written for the test, so a hint that
  cannot be traced fails. Mutation-checked (removing the used-tile guard fails it).

**Still untested:** `placeSuccessfulWord` capture and scoring, `handleSubmitWord` validation
and the `#` desync path, team assignment and switching, and the grid
`serialize`/`deserialize` round-trip (the wire format).

## Speech

`libs/Media/SpeechHelper.ts`, replacing SAM (a 1982 formant synth that was frequently
unintelligible — the point of reading a word out is that the room hears which word).

Kokoro-82M runs in the browser, but **neither the library nor the model is bundled**:
`kokoro-js` pulls in transformers.js, which pulls in a 20.6MB ONNX WebAssembly binary, and
bundling it took the deploy from 6MB to 29MB. Both are fetched from a CDN on first use and
cached by the browser thereafter. `REACT_APP_KOKORO_URL` overrides the library URL.

Three rules it is built on: it is lazy (nothing is fetched until something speaks), it never
blocks (`speak()` returns immediately and plays the caller's fallback sound while the model is
still coming down), and it never throws into game code. No network, an old browser, a blocked
CDN — every one of those degrades to the fallback sound. `warmUp()` is called on the gathering
screen so the first word of a round is spoken rather than beeped.
