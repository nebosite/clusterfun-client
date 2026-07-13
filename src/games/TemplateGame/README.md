# TemplateGame — the starting point for new ClusterFun games

TemplateGame ("Template" in the debug lobby) is a small but complete, working game that
demonstrates every best practice a ClusterFun game should follow. **New games start as a
copy of this folder.** It is registered in the debug game list only, so it never ships to
players.

Playing it: everyone joins from their phone, taps their screen to move their name around
the presenter's canvas (each tap scores a point), and can recolor their name or send a
message. After the final round the highest scorer wins. Not much of a game — but it
exercises the whole framework:

- **Presenter/client split** — the presenter model owns all state; the client model only
  sends typed input messages and mirrors what it needs.
- **Typed message endpoints** ([models/templateEndpoints.ts](models/templateEndpoints.ts)) —
  the complete wire API in one file, with named request/response interfaces, both
  request/response (`Onboard`) and fire-and-forget (`Tap`, `ColorChange`, `Message`) styles.
- **Pure, unit-tested game rules** ([models/templateLogic.ts](models/templateLogic.ts) +
  [templateLogic.spec.ts](models/templateLogic.spec.ts)) — rule decisions live in plain
  functions with Jest specs; the models stay thin.
- **Save/restore** — type helpers in both models make refresh-resume work (refresh the page
  mid-game; the game continues where it was).
- **State machines** — presenter states (Gathering → Playing → EndOfRound → GameOver) and
  client states, each mapped to a sub-screen component in the views.
- **Player avatars** — the standard feature: players pick an avatar in the lobby; it rides
  the Join message onto `player.avatarId`, and the views render it with the shared
  `PlayerAvatar` component (join list, in-game scoreboard, winner banner, phone top bar).
- **Sounds & events** — model events (`ScoreChanged`, `WinnerAnnounced`, ...) trigger sounds
  in the view layer: join (hello.mp3), message (response.mp3), countdown/color (ding.wav),
  score increase (score.wav), and winner announcement (winner.wav).
- **Animations** — a scripted round-intro animation and per-frame canvas drawing on both
  presenter and client.

## How to add a new game by hand

Suppose your game is called **Quizzo**.

1. **Copy the folder.** Duplicate `src/games/TemplateGame` to `src/games/Quizzo`.
   Delete `CLAUDE.md` from the copy (it is the template's authoring guide, not part of a
   game) and replace this README with a description of your game.

2. **Rename everything.** In the copied folder, replace every identifier consistently:
   - `Template` → `Quizzo` (class names: `QuizzoPresenterModel`, `QuizzoPlayer`, enums,
     type-helper names, `templateEndpoints.ts` → `quizzoEndpoints.ts`, etc.)
   - `template` → `quizzo` (endpoint routes like `/games/quizzo/actions/...`)
   - The strings passed to the model constructors (`super("Template", ...)`,
     `super("TemplateClient", ...)`) and the serializer type names inside both type
     helpers (`rootTypeName`, `getTypeName`, `constructType`) — these are saved into
     checkpoints, so they must match the class renames.

3. **Register the game.** Add an entry in
   [src/games/lists/gamesListDebug.ts](../lists/gamesListDebug.ts) (debug-only while you
   develop; move it to `gamesListRelease.ts` when it's ready). Optionally add a card entry
   in `src/lobby/LobbyPresentation.ts` (blurb, player count, play time). To appear in
   production the game must **also** be added to the server's `game_manifest`.

4. **Run it.** `npm start` opens the Test Lobby (presenter + four fake phones on one page,
   no server needed). Pick your game and make sure the template gameplay still works after
   the rename — refresh mid-game to prove save/restore survived (a wrong type-helper name
   is invisible until you refresh).

5. **Now make it your game.** The natural order:
   - `models/GameSettings.ts` — your tuning constants.
   - `models/quizzoEndpoints.ts` — design the message API first: what do phones send, what
     does the presenter push or answer? Keep payloads small.
   - `models/quizzoLogic.ts` (+ `.spec.ts`) — the pure rules: scoring, win conditions,
     validation. Write the specs alongside.
   - `models/PresenterModel.ts` — player fields, game states, round lifecycle
     (`prepareFreshGame` / `prepareFreshRound` / `startNextRound` / `handleTick`), and a
     handler per endpoint. Keep the type helper in sync with every new class you add.
   - `models/ClientModel.ts` — input actions and `requestGameStateFromPresenter` (rebuild
     the phone's whole state from the onboard response).
   - `views/Presenter.tsx` and `views/Client.tsx` — one sub-screen component per state.
     Show `PlayerAvatar` wherever players are listed.
   - `assets/` — swap in your logo and sounds; keep `Assets.ts` as the manifest.

6. **Test and format before committing.** `npm test` (your specs plus the whole suite) and
   `npm run format`. Add a serializer round-trip or state-transition spec when your model
   grows new serializable classes.

### Things that bite people

- **Forgetting the type helper.** Every class stored on a model must be registered in
  `getTypeName`/`constructType`, or refresh-resume silently drops it.
- **Fat messages.** Clients are phones. Send ids and small deltas, not whole objects, and
  use the onboard request for full-state rebuilds.
- **Authoritative logic on the client.** The presenter decides everything; the client only
  proposes. If the client "knows" the score, it's a display copy.
- **Missing `saveCheckpoint()`.** Call it after any state change that should survive a
  refresh.
- **New states without screens.** Every value you put in `gameState` needs a case in the
  view's `renderSubScreen` on the affected role — the default case is an error screen.

## How to add a new game with Claude

This folder ships with a [CLAUDE.md](CLAUDE.md) that turns Claude into a game-building
assistant: it instructs Claude to **interview you about the game design first**, write a
short design doc, and only then copy and refactor the template. To use it, just ask
Claude Code (from the repo or client directory) something like:

> Create a new game from the TemplateGame template. Read
> `src/games/TemplateGame/CLAUDE.md` first and follow its process.

Tips for good results:

- **Lead with the elevator pitch, but let the interview happen.** One or two sentences of
  concept ("a bluffing trivia game where players submit fake answers") is enough to start;
  answer Claude's interview questions rather than front-loading a spec — the questions
  cover the decisions that actually shape the code (rounds, timers, screens, scoring,
  what's secret on phones vs. public on the big screen).
- **Ask for thin slices.** "Get joining + one playable round working in the Test Lobby
  first, then we'll add scoring" beats "build the whole game."
- **Hold Claude to the house rules.** The template's CLAUDE.md already requires it, but
  it never hurts to repeat: pure logic with specs, typed endpoints, type helpers kept in
  sync, `npm test` + `npm run format` before every commit, and a refresh-mid-game
  save/restore check in the Test Lobby.
- **Verify in the Test Lobby yourself.** Claude can run the suite, but you can see the
  game. `npm start`, play a round on the fake phones, refresh the page mid-round.

## Folder map

```
TemplateGame/
  CLAUDE.md                    Instructions for Claude: interview process + build steps
  index.ts                     Re-exports views
  assets/
    Assets.ts                  Asset manifest (import images/sounds here)
    images/, sounds/
  models/
    GameSettings.ts            Tuning constants
    templateEndpoints.ts       The typed wire API (client <-> presenter)
    templateLogic.ts           PURE game rules - no framework imports
    templateLogic.spec.ts      Jest specs for the rules
    PresenterModel.ts          Player class, game states/events, presenter model + type helper
    ClientModel.ts             Client model + type helper
  views/
    GameComponent.tsx          Boot: wires models + lazy views into the framework
    Presenter.tsx/.module.css  Big-screen UI, one component per game state, sounds
    Client.tsx/.module.css     Phone UI, one component per client state
    index.ts
```
