# Lexible

Two-team territory word game on a shared letter grid. Players spell contiguous words by
dragging across letters on their phone; a valid word claims each tile **at that word's
length**, and a tile can only be stolen by a **strictly longer** word.

**Both teams start in COLUMN 0 and both race to the RIGHT edge.** Team A owns the odd rows,
team B the even rows — interleaved, so every starting square has a neutral one to its right
and neither team is walled in. They
used to own opposite edges and run at each other, which meant the two teams were never playing
the same board. The one definition lives in `models/teamAreas.ts` and is read by three things
that must agree: the seeding, the win search, and the board outline.

The flagship shipped game, and the oldest.

## Files

| File                                           | Owns                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `models/PresenterModel.ts`                     | Grid build, word validation, capture/scoring, win detection, teams.           |
| `models/ClientModel.ts`                        | Letter chain selection, hint filtering, submission.                           |
| `models/lexibleEndpoints.ts`                   | Wire types, all under `/games/lexible/...`.                                   |
| `models/teamAreas.ts`                          | Starting squares, the goal, the connected-region fill, **and the win check**. |
| `models/gridLayout.ts`                         | Board size: the host picks rows; tile size and column count follow.           |
| `models/wordSearch.ts`                         | The hint search. Pure, and property-tested.                                   |
| `models/dragSelection.ts`                      | What a drag across the board does to the word being spelled.                  |
| `models/LetterGridModel.ts`                    | `rows[y][x]` + the wire serialization format.                                 |
| `models/LetterBlockModel.ts`                   | One tile: letter, score, team, selection, home-connection, fail animation.    |
| `models/WordTree.ts`                           | Plain parent-linked trie, used for hints only.                                |
| `views/Presenter.tsx`                          | All stage pages; speech wiring. Both team rosters stack in ONE left column.   |
| `views/InstructionDemo.tsx`                    | The animated 6x6 tutorial board. Real grid, real tiles, real outline.         |
| `views/Client.tsx` + `ClientGameComponent.tsx` | Phone: the drag-to-spell grid.                                                |
| `assets/words/words50k.txt.gz`                 | The dictionary, 50,000 words gzipped. See _The dictionary_ below.             |

## Two different word mechanisms — do not conflate them

1. **Submission** validates against `wordSet: Set<string>` — an exact lookup
   (`PresenterModel.ts:770`). It rebuilds the word from _live grid state_ and substitutes `#`
   for any tile that doesn't match what the client claimed, so a desynced client simply fails
   (`:754-768`).
2. **Hints** use `wordTree` — a DFS from the tapped block (`findWords`, `:542-587`).

**Diagonals differ between the two rules and this is deliberate:** spelling walks all 8
neighbors; territory connects 4-way only (`teamAreas.ts`, `connectedToLeftEdge`).

## Win detection — the outline IS the win condition

One flood fill, in `teamAreas.ts`, answers both "what do I outline?" and "has anyone won?":

- `connectedToLeftEdge(grid, team)` — four-way fill seeded from **every tile in column 0 that
  team already owns**, walking only through its own tiles. Unclaimed and enemy tiles are
  walls, and a visited set means each tile is looked at once.
- `applyHomeConnections(grid)` runs it for both teams, writes the outline mask onto every
  block, and **returns the two regions**. Called by the presenter and by each phone, so the
  board in your hand and the board on the wall cannot disagree.
- `hasCrossedBoard(grid, team, region)` — the region contains a tile in the goal column.
  That is the whole win check, and it is a set lookup on a fill that already happened.

**This replaced an A\* "hot path" search** (`findHotPathInGrid`, deleted along with
`@datastructures-js/priority-queue`). That search found the _cheapest_ crossing — fewest enemy
squares, then fewest neutral ones — and called it a win at zero cost. It answered a different
question, and it came with an animation that painted its path one tile per 50 ms with a white
glow. Because the cheapest path runs straight through **unclaimed and enemy** tiles, what the
room saw was a white wave washing over squares nobody owned, for up to `width * 4` steps —
**ten seconds on a wide board** — re-entered from the top by the next word to land. Both the
presenter and every phone ran it on every accepted word.

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

1. **Board size is one number.** The host picks ROWS on a slider (8–20; past 20 the tiles are
   under 45 virtual pixels and unreadable across a room); `gridLayout.ts` derives the tile size
   (rows fill the play area's height) and the column count (columns fill its width).
   The old Small/Medium/Large setting is gone. The presenter's `.playColumn` CSS width and
   `PLAY_AREA_WIDTH` must stay in step.
2. **A drag SPELLS if the letter under the finger would change the word; otherwise it
   SCROLLS.** Decided once, on touch-down, by `ClientModel.canDragFrom` — deliberately NOT
   `canStartWordAt`, which is true of every letter once a word exists and made the board
   unscrollable after the first drag. Enforced by not letting the event reach the Slider:
   `Touchable` listens on its own container, so `stopPropagation` is what holds the board
   still. A letter only registers when the finger is near its CENTRE (tiles touch at the
   corners, so a diagonal drag otherwise grabs letters it merely clipped), and moves are
   interpolated so a fast drag does not skip letters between samples.
3. **Tile colour encodes strength**, not just ownership: a score of 3 is 20% team colour on
   white, 9+ is the full colour (`cozyTheme.teamColorForScore`). It mixes towards WHITE rather
   than desaturating — desaturating keeps the original lightness and a weak tile came out a
   muddy grey. **The LETTER is always `COZY.ink`.** It used to flip to white above about half
   strength (`letterColorForScore`, now deleted) — correct about contrast, wrong about reading:
   a scatter of white letters among dark ones looks like a state you are meant to notice, and
   there isn't one.
4. **The team-coloured outline** marks tiles joined to the **left edge**, four-way, through
   the team's own tiles — anchored on any owned square in column 0, not only the seeded ones.
   Two things make it read as one shape rather than a box per tile: only outward-facing edges
   are drawn, and the border goes on the tile's OUTER div so adjacent segments meet across the
   gutter. Recomputed by `applyHomeConnections()` whenever the board changes — and when it
   touches the right-hand column, that team has won. See _Win detection_ above.
5. **The badge's position is computed in `LetterBlock.tsx`, in pixels, and nowhere else.** An
   inline transform REPLACES a stylesheet one rather than adding to it, so having both was how
   the badge kept ending up back on top of the letter. The stylesheet deliberately sets no
   offset. Its background is **half-transparent** so the corner of the letter it overhangs is
   still readable through it.
6. **There is effectively no round timer.** `PLAYTIME_MS = 900000000` (~250 hours) and
   `handleTick` never checks `timeOfStageEnd`. "Timed game" is an unimplemented TODO — do not
   assume the stage-timer machinery is wired up here.
7. **`checkForWin` is synchronous and cheap**, and takes the regions `applyHomeConnections`
   just built rather than searching again. It used to be `async` and animate for up to ten
   seconds, re-entered unguarded by the next word — see _Win detection_.
8. **Presenter and client share the board maths.** Both call `applyHomeConnections` from
   `teamAreas.ts`; only the presenter's copy declares a win. They cannot drift, because there
   is one function.
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
15. `Presenter.tsx` has hidden debug "Win: A" / "Win: B" buttons behind a debug click.
16. **A STOLEN tile throws a firework** — 30 white sparks three tiles out with a team-coloured
    afterglow, on the presenter and on every phone. It fires only when a tile comes **off the
    other team**, not when neutral ground is claimed: at this size, every few seconds it would
    be wallpaper. `LetterBlockModel.capture()` bumps a COUNTER (`captureSeq`), not a flag — the
    view keys the element on it, so a re-mount replays the CSS animation, where a boolean would
    already be true and the second burst would never be seen. `CAPTURE_SPARK_MS` must cover the
    keyframes **plus the longest per-spark delay**, and a bursting tile takes `zIndex: 20` or
    later siblings in the flex row paint over the sparks.
17. **`shouldStringify` matches the PRIVATE field name.** The serializer walks real properties,
    so the old `case "failFade"` (the getter) never fired and a checkpoint taken mid-flash
    restored a tile stuck red forever. Transient animation state is excluded as `_failFade` and
    `_captureSeq`.
18. **A disconnected player keeps their seat**, so the roster keeps listing them — greyed and
    italic with a ⚠, from `ClusterFunPlayer.isConnected`. Deleting them would lose their score
    and tell the room nothing about why nobody is playing. Each roster panel is washed with its
    own team colour (`TEAM_PANEL_TINT`) so the two are told apart at a glance.
19. **The instructions ANIMATE, they run the real code, and the three steps are ONE STORY.**
    `InstructionDemo` drives a real `LetterGridModel` through the real `LetterBlock` and calls
    the real `applyHomeConnections` and `hasCrossedBoard`. Step 1: A spells **TRIP** out of its
    home tile. Step 2 opens on exactly that board and B takes it all back with **STRIP**, the S
    prepended from B's home square directly below the T — four fireworks, because four tiles
    changed hands. Step 3 opens on that and B stretches it to **TRIPLED**, which reaches the far
    column and stamps **WIN!** for two seconds. Carrying the state forward is the teaching: step
    2 is not an abstract capture, it is the word you just watched being taken.
    Each frame states the WHOLE board, which is what lets the loop wrap without residue.
    `InstructionDemo.spec.ts` walks every word with the game's own `isAdjacent` and checks the
    win with `hasCrossedBoard`, so a rule change that turns the tutorial into a lie fails there.
    The three `instructions*.png` diagrams are deleted.

## Testing

Now ~80 tests across five specs:

- `teamAreas.spec.ts` — the starting geometry, the flood fill, the outline masks, and
  `hasCrossedBoard` — the win condition, including that neither a diagonal join, a gap, nor a
  chain that never touched the left edge counts as a crossing.
- `gridLayout.spec.ts` — the board always fits: rows fill the height, columns fill the width.
- `dragSelection.spec.ts` — start / extend / retract, including that a letter is never reused.
- `wordSearch.spec.ts` — **the hint list is verified as a property**: every word it offers is
  walked over the board by an independent path-finder written for the test, so a hint that
  cannot be traced fails. Mutation-checked (removing the used-tile guard fails it).

**Still untested:** `placeSuccessfulWord` capture and scoring, `handleSubmitWord` validation
and the `#` desync path, team assignment and switching, and the grid
`serialize`/`deserialize` round-trip (the wire format).

## Submissions are deduplicated

`LexibleSubmitWordEndpoint` retries after 2s, and speaking a word on the WASM speech backend
blocks the presenter for about as long — so a phone gives up waiting and resends mid-synthesis.
The score survives that (a word cannot beat its own score), but everything else in
`placeSuccessfulWord` runs again, and the room hears the word read out twice. The presenter
remembers accepted submissions for 15s and replays the original answer.

## Speech

**The host picks the engine on the start screen; the default is the browser's own voice.**
`LexibleSettings.speechEngine` persists the choice and the presenter re-reads it on each
accepted word, so switching mid-game takes effect on the next one.

| Engine    | Says                                   | Cost                                                    |
| --------- | -------------------------------------- | ------------------------------------------------------- |
| `browser` | the actual word, via `speechSynthesis` | none — voices come from the OS, so they vary by machine |
| `wahwah`  | speech-shaped tones, one per word      | none — Web Audio, deterministic, works anywhere         |

**Kokoro-82M and KittenTTS were built and then removed.** They sounded better than either of
these and were not worth what they cost: tens of megabytes fetched from a CDN, and — on a
machine without a GPU — a **measured 1.8–2.9s freeze of the presenter's main thread per word**,
with zero frames rendered throughout. The `ISpeechEngine` abstraction is what made adding and
dropping them cheap, and is worth keeping for the next one.

The engines live in [`libs/Media/speech`](../../libs/CLAUDE.md) behind `ISpeechEngine`
(`initialize` / `speak` / `dispose`), each reached through a dynamic `import()` so an unchosen
one is never parsed. `SpeechHelper` holds the policy — lazy, non-blocking, never fatal, and
**one word at a time**: two syntheses in flight come back interleaved and two clips started
together play over each other, which the room hears as gibberish either way. At most
`MAX_SPEECH_QUEUE` (2) words wait, anything older than `SPEECH_STALE_MS` (8s) is beeped rather
than narrated late, and an engine that never finishes is abandoned after
`SPEECH_MAX_UTTERANCE_MS` so nothing can wedge the queue for the night.

**The presenter READS THE RULES ALOUD** on the instructions pages, through its own
`SpeechHelper` (no fallback beep — a beep in place of a rule says nothing, and the sentence is
on screen). `LEXIBLE_RULES` in `Presenter.tsx` is the single source for the spoken and the
printed line so they cannot drift, the leading numeral is stripped before speaking, and the
helper is shut down on unmount so `Ready!` never leaves a rule playing over round one.

### Sound effects and speech coexist

They are different subsystems — Web Audio graphs on one side, `speechSynthesis` on the other —
and they mix in the output device, not in the browser. Neither cancels the other.

The capture explosion is not an asset: `libs/Media/SoundEffects.playExplosion()` synthesises it
from a bright **crack**, a swept sine **body** and a filtered noise **tail**, which is smaller
than the mp3 would be and never goes down a wire. Three things had made it inaudible, and all
three are fixed or worth knowing:

1. **The shared `AudioContext` was not resumed when first created.** Autoplay policy hands back
   a SUSPENDED context, and a suspended context does not advance `currentTime` — so the first
   sound of a session was not late, it never played at all. Resume happened only on the second
   and later calls. Pinned by a regression test.
2. **It fires only on a steal**, along with the firework. Claiming neutral ground is silent.
3. **It was a single 280ms lowpassed puff at a third of the current gain**, which does not
   survive being played underneath a word being read out. The crack layer is the part that
   does.
