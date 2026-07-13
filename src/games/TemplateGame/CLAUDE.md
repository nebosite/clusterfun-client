# Building a new game from TemplateGame — instructions for Claude

You are helping the user create a new ClusterFun game using this folder as the template.
Do NOT start copying files or writing code until you have completed the design interview
below and the user has confirmed the design summary.

Background you should read first if you haven't already:

- [../../../CLAUDE.md](../../../CLAUDE.md) (clusterfun-client) — the presenter/client
  architecture, framework, Test Lobby, and testing conventions.
- [README.md](README.md) (this folder) — what the template demonstrates and the manual
  porting steps; you will be automating those steps.

## Phase 1: Interview the user

Ask about the areas below. Ask a few questions at a time, not one giant wall; skip
anything the user already answered; probe vague answers with a concrete example
("when the timer ends, what does the big screen show?"). The goal is to leave this
phase knowing every screen, every message, and every rule.

1. **Concept & feel** — What's the elevator pitch? Party/silly, competitive, creative,
   trivia? What existing game is it most like (Jackbox title, board game...)?
2. **Players & teams** — Min/max players? Free-for-all, teams, or one-vs-all roles
   (e.g. a judge)? Can people join mid-game? What happens when someone drops?
3. **Game flow** — Rounds or continuous? What are the phases of a round (e.g. prompt →
   answer → vote → reveal)? What ends a round, and what ends the game? Timers — where,
   and how long? Turn-based or everyone-at-once (arcade)?
4. **The big screen (presenter)** — What does everyone watch during each phase? What's
   revealed vs. hidden? Any animations/sounds that matter to the feel (score sound and
   winner fanfare are standard in the template)?
5. **The phone (client)** — What does a player DO in each phase: type text, tap choices,
   draw, aim, take photos? What's on their screen that must stay secret from the big
   screen? Remember phones render only input UI, never the game itself.
6. **Rules & scoring** — How are points earned? Ties? Eliminations? Win condition?
   Any content rules (word lists, moderation, profanity)?
7. **Content & assets** — Does the game need data (question banks, word lists, images)?
   Where does it come from? What logo/sounds vibe does the user want (placeholders from
   the template are fine to start)?
8. **Scope for v1** — What is the smallest version that is fun? Explicitly propose cutting
   anything that isn't; record cut features in a "later" list.

Then write a short design doc at `src/games/<NewGame>/DESIGN.md` (see PartyPix's
DESIGN.md for the style): concept, player counts, the state machine for presenter and
client, a table of messages (name, direction, payload sketch), scoring rules, and the
v1 cut-lines. **Show the user the summary and get a yes before Phase 2.**

## Phase 2: Scaffold from the template

1. Pick the game name with the user (PascalCase folder, e.g. `Quizzo`).
2. Copy `src/games/TemplateGame` → `src/games/<NewGame>`; delete the copied `CLAUDE.md`
   and replace `README.md` with a short description plus how to play.
3. Rename consistently: `Template` → `<NewGame>` in identifiers, `template` → `<newgame>`
   in endpoint routes and file names, including the model-constructor name strings and
   ALL serializer type names in both type helpers.
4. Register in `src/games/lists/gamesListDebug.ts` (debug list only for now) and add a
   `KNOWN` card in `src/lobby/LobbyPresentation.ts`.
5. Run `npm test` and launch the Test Lobby (`npm start`) to confirm the renamed template
   still plays and survives a mid-game refresh before changing any behavior.

## Phase 3: Implement, thin slices first

Work in this order, keeping the game playable in the Test Lobby after each slice:

1. **Endpoints** (`models/<newgame>Endpoints.ts`) — encode the message table from the
   design doc as typed `MessageEndpoint`s with named request/response interfaces.
2. **Pure rules** (`models/<newgame>Logic.ts` + `.spec.ts`) — scoring, validation, win
   detection as pure functions with Jest specs written at the same time.
3. **Presenter model** — player fields, state enum matching the design's phases, round
   lifecycle, one handler per endpoint. Update the type helper with every new class.
4. **Client model** — input actions and a `requestGameStateFromPresenter` that fully
   rebuilds phone state from the onboard response.
5. **Views** — one sub-screen component per state on each role. Show `PlayerAvatar`
   beside player names everywhere players appear (join list, scoreboards, winner screen,
   phone top bar) — it's a standard feature. Wire model events to sounds in the view
   layer (keep the score / winner sounds unless the user wants different audio).
6. **Assets** — swap logo/sounds via `assets/Assets.ts` when the user provides them.

## House rules (non-negotiable)

- Presenter owns all authoritative state; clients only propose via messages.
- Keep messages small — phones on weak connections.
- Every serializable class registered in the type helpers; `saveCheckpoint()` after
  meaningful state changes. Verify by refreshing mid-game in the Test Lobby.
- Rule logic goes in the pure logic file with specs, not inline in models.
- One class per file, MobX observables for view-driving state, imports from `"libs"`.
- `npm test` and `npm run format` must pass before every commit; commit in the
  `clusterfun-client` submodule, not the root repo.
- Verify the real behavior in the Test Lobby (or ask the user to) before declaring a
  slice done — a green suite is not a played round.

## Phase 4: Ship checklist (when the user says it's ready)

- Full `npm test` green, `npm run format:check` clean.
- Playtest notes: joined mid-game, refresh-resumed presenter AND a client, dropped
  player rejoined by name.
- Move the registry entry to `gamesListRelease.ts` and remind the user the server's
  `game_manifest` must also list the game before it appears in production.
