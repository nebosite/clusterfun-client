# clusterfun-client

The ClusterFun front end: a single React/MobX app that contains the lobby **and every
game**. This is where all game logic and game state live — the server is just a relay
(see [../clusterfun-server/CLAUDE.md](../clusterfun-server/CLAUDE.md)).

React 18 + MobX 6 + TypeScript, bootstrapped with Create React App (`react-scripts`). Games
are code-split and lazy-loaded so only the chosen game's bundle downloads.

## The presenter / client model (read this first)

Every game is really **two apps** running the same game module in different roles:

- **Presenter** — one per room. Runs the game instance, owns _all_ game state, decides state
  transitions, and drives the shared screen everyone watches. Base class:
  `ClusterfunPresenterModel<PlayerType>`.
- **Client** — one per player device. A lightweight controller: it captures the player's
  input, sends it to the presenter, and renders only what it needs for input. It does **not**
  render the game. Base class: `ClusterfunClientModel`.

Keep presenter↔client messages small — clients are assumed to be phones, possibly watching
the presenter over a video stream. The presenter is the source of truth; clients ask it for
state and react to its "invalidate" nudges.

Both roles extend `BaseGameModel`, which provides the game clock/ticker, scheduled events,
checkpoint save/restore, animation registration, and message-listener bookkeeping.

## Source layout

```
src/
  index.tsx              Entry point. Picks Test Lobby (dev) vs real Lobby (prod). Wires telemetry, storage, sockets.
  GameChooser.tsx        Lazy-loads a game component from the registry by name.
  Globals.ts             App-wide constants (title, mobile detection).
  games/
    lists/               The game REGISTRY (see below).
    TemplateGame/        The template game ("Template"). Copy this to start a new game.
                         See its README.md (manual steps) and CLAUDE.md (design-interview
                         workflow). Debug-only.
    Eittris/             Versus-tetris, 16 boards. BIGGEST game (~15k lines) and the arcade
                         reference. Has CLAUDE.md — read it, it INVERTS the authority rule.
    Lexible/             Two-team territory word game. The flagship. Has CLAUDE.md.
    OneOhOne/            "101" — small round-based racing game. Has CLAUDE.md.
    PartyPix/            Photo slideshow + voting. Camera/base64 reference. Has CLAUDE.md.
    RetroSpectro/        A retrospective/sorting work tool. Has CLAUDE.md (mostly its skin).
    stressgame/          "Stressato" — relay throughput load test. Debug-only.
  lobby/                 Real lobby: pick a game, start/join a room, host the running game.
  testLobby/             Serverless dev harness: presenter + 4 clients + virtual server on one page.
  libs/                  The framework all games build on (see below).
```

### `libs/` — the game framework

| Area          | Key files                                                                                                                                                        | Purpose                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Game models   | `GameModel/BaseGameModel.ts`, `GameModel/ClusterfunPresenterModel.ts`, `GameModel/ClusterfunClientModel.ts`                                                      | Base classes for presenter/client.                                                             |
| Messaging     | `messaging/SessionHelper.ts`, `messaging/MessageEndpoint.ts`, `messaging/ClusterfunListener.ts`, `messaging/ClusterfunRequest.ts`, `messaging/basicEndpoints.ts` | Typed request/response + fire-and-forget over the relay.                                       |
| Transport     | `messaging/MessageThing.ts`                                                                                                                                      | `WebSocketMessageThing` (real) and `LocalMessageThing` (virtual/in-memory for the test lobby). |
| Wire format   | `comms/ClusterFunMessageHeader.ts`, `comms/ClusterFunRoutingHeader.ts`, `comms/messageParsing.ts`                                                                | `{header}^{routing}^{payload}` string encoding. Header shape mirrors the server.               |
| Serialization | `storage/BruteForceSerializer.ts`, `debugging/serialization.ts`                                                                                                  | Class-aware (de)serialization driven by each game's `ITypeHelper`.                             |
| Storage       | `storage/StorageHelper.ts`                                                                                                                                       | `IStorage` (localStorage-backed). Keyed per role in the test lobby.                            |
| Telemetry     | `telemetry/TelemetryLogger.ts`, `telemetry/MockTelemetryLogger.ts`                                                                                               | Google Analytics (prod) or a no-op mock (dev).                                                 |
| UI base       | `components/ClusterfunGameComponent`, `components/ClusterCanvas`, `components/DevUIComponent`                                                                    | Shared React components.                                                                       |
| Misc          | `Animation/`, `Media/` (sound/`MediaHelper`), `types/Vector2.ts`, `Input/`, `Browser/`                                                                           | Support utilities.                                                                             |

Most things are re-exported from `libs/index.ts`, so games import from `"libs"`.

## Anatomy of a game (using TemplateGame / "Template")

A game is a folder under `src/games/<Name>/`:

```
TemplateGame/
  index.ts                     Re-exports views. (Registry entry points at views/GameComponent.)
  views/
    GameComponent.tsx          Extends ClusterfunGameComponent; init(lazyPresenter, lazyClient, presenterTypeHelper, clientTypeHelper)
    Presenter.tsx              React view for the shared screen (observes the presenter model)
    Client.tsx                 React view for a player's device (observes the client model)
    index.ts
  models/
    PresenterModel.ts          TemplatePresenterModel extends ClusterfunPresenterModel<TemplatePlayer>; game states; message handlers; type helper
    ClientModel.ts             TemplateClientModel extends ClusterfunClientModel; input actions; type helper
    templateEndpoints.ts       MessageEndpoint definitions (the typed API between client & presenter)
    templateLogic.ts           PURE, framework-free game rules (+ templateLogic.spec.ts unit tests)
    GameSettings.ts            Constants (e.g. PLAYTIME_MS)
  assets/
    Assets.ts                  Asset manifest (logo image, sounds)
    images/, sounds/
  README.md                    How to start a new game from the template (by hand or with Claude)
  CLAUDE.md                    Claude workflow: interview the user, then scaffold + implement
```

### How a game boots

`GameComponent.tsx` extends `ClusterfunGameComponent` and calls `this.init(...)` with the
lazy Presenter view, lazy Client view, and the presenter/client **type helpers**. The
framework inspects the room role (`presenter` vs `client` from `GameInstanceProperties`),
constructs the right model — restoring a saved game from storage if one exists, otherwise
building fresh via the type helper — calls `reconstitute()`, and renders the matching view.

### State machine

- Shared/base states live in enums: `GeneralGameState` (Unknown, Instructions, Playing,
  Paused, GameOver, Destroyed), `PresenterGameState` (Gathering), `GeneralClientGameState`
  (WaitingToStart, JoinError, Paused).
- Each game adds its own states (e.g. `TemplateGameState.Playing / EndOfRound`) and sets
  `gameState` on the model. Setting `gameState` fires an event and logs; setting it to
  `Unknown` throws.
- The presenter drives time via `BaseGameModel`'s ticker (default 33ms). `ClusterfunPresenterModel`
  computes `secondsLeftInStage`, exposes `isStageOver` (based on `timeOfStageEnd`), and calls
  the game's `handleTick()` each frame. Games override `handleTick`, `startNextRound`,
  `prepareFreshRound`, `prepareFreshGame`.
- **Turn-based vs arcade** is just how a game uses the tick and endpoints: turn-based games
  transition on discrete player actions/timeouts; arcade games run continuous per-frame logic
  (see the client's `gameThink(elapsed_ms)` in TemplateGame, which animates every frame).

### Messaging between presenter and client

Communication is via typed **`MessageEndpoint<REQUEST, RESPONSE>`** objects (a `route`
string plus optional retry hints), defined per game (e.g. `templateEndpoints.ts`) plus shared
ones in `libs/messaging/basicEndpoints.ts` (Join, Quit, Ping, GameOver, InvalidateState,
Pause/Resume/Terminate).

- Client → presenter: `this.session.sendMessageToPresenter(endpoint, msg)` (fire-and-forget)
  or `this.session.requestPresenter(endpoint, msg)` (awaitable response).
- Presenter listens: `this.listenToEndpoint(endpoint, handler)` (auto-unsubscribed on
  shutdown). Use `listenToEndpointFromPresenter` on the client to only accept presenter msgs.
- Presenter → clients: `sendToEveryone(endpoint, gen)` (fire-and-forget) or
  `requestEveryone(endpoint, gen)` (awaits all responses).
- The common pattern: presenter changes state → `sendToEveryone(InvalidateStateEndpoint)` →
  each client calls `requestGameStateFromPresenter()` to re-sync (handles missed messages).
- Clients send a `PingEndpoint` keepalive every 10s; the presenter manages join/rejoin
  (`handleJoinMessage`), including rejoin-by-name after a device reboot.
- The Join message carries the player's lobby-chosen **avatar** (`avatarId`), which lands on
  `ClusterFunPlayer.avatarId`. Games should render it with the shared `PlayerAvatar`
  component (from `libs`) wherever players appear — join lists, scoreboards, winner screens,
  and the phone's own header (client models expose `avatarId` too).

### The lifecycle contract (read before writing any presenter)

Four things happen to every game in the wild. The rules below are enforced by the base class
and pinned by `libs/GameModel/PresenterReconnect.spec.ts` — read that spec if anything here
is ambiguous.

### 1. A player's id is PERMANENT; only the connection moves

Three ids live on `ClusterFunPlayer`, and mixing them up is the classic mistake:

| Field          | Lifetime                           | What it is for                                                  |
| -------------- | ---------------------------------- | --------------------------------------------------------------- |
| `playerId`     | **Permanent** for the game         | Keying game state: boards, pieces, photos, teams, scores.       |
| `connectionId` | Changes on **every** reconnect     | Nothing, in game code — the base class does all the addressing. |
| `playerToken`  | Permanent, **private** to a device | Proving a returning phone owns a seat. Never publish it.        |

A returning player is matched **token → live connection → name** (name only when
`allowRejoinOnNameOnly` and no token was offered — a name is public, it is on the big screen).
Their `playerId` is never reassigned, so **nothing needs migrating**.

> `playerId` is deliberately not derived from `playerToken`: the id travels in every roster to
> every phone, while the token is the private proof of seat ownership.

**`sender` in a presenter's handler IS the stable `playerId`.** The base class translates the
relay's connection id before your handler sees it, which is why
`players.find(p => p.playerId === sender)` keeps working across a reconnect. Use
`listenToConnection` only if you truly need the raw connection — `Join` is the sole case.

**On the client**, `ClusterfunClientModel.playerId` is the permanent id the host assigns and
returns in the join ack — _not_ `session.personalId`. Compare against it when deciding whether
a broadcast is about you.

### 1b. `onPlayerReturned` is abstract — every game must answer

```ts
protected abstract onPlayerReturned(player: PlayerType, info: ReconnectInfo): void;
```

It will not compile if you forget, which is the point: reconnecting should be a decision, not
an oversight. Because ids are stable there is usually nothing to migrate, so an empty body
**with a comment saying why** is a correct answer. Games that hand a seat back from a bot do
it here — see `Eittris/models/PresenterModel.ts`. `onPlayerDisconnected(player)` is the
optional other half.

### 1c. Dropping out never costs you your seat

A player unheard-from for `DISCONNECT_TIMEOUT_MS` (30s — three missed pings) is marked
`isConnected = false` and **stays in `players` with all their state**. A clean `Quit` does the
same thing: the two are not distinguished, because a phone in a tunnel never sends one. Show
them greyed out; delete nothing.

- `sendToEveryone` / `requestEveryone` **skip disconnected players** — a sleeping phone would
  otherwise hang an awaited round. Use `sendToPlayer(endpoint, player, msg)` for one player.
- The **only** way a seat is freed mid-game is the host calling `bootPlayer(player)`.
- If the game auto-paused because connected players fell below `minPlayers`, it **auto-resumes**
  when enough return. A pause the host asked for is left alone.

### 2. "Play again" → the phones must reset too

Replay reuses the room and the player list. A presenter that resets its own state but doesn't
re-onboard the clients leaves phones showing the previous game. Broadcast `InvalidateState`
and let each client rebuild via `requestGameStateFromPresenter()`. Counters the client uses to
detect a new round (Eittris's `currentRound`) **must keep incrementing across games**, not
reset to zero — otherwise round 1 of game 2 looks like a stale repeat.

### 3. Mid-game join

`Gathering` is not the only state a player can arrive in. Decide explicitly what a late joiner
gets (a seat, spectator, refused) and make `requestGameStateFromPresenter` return enough to
render it.

### 4. Refresh-resume

Both roles checkpoint. See below — and note that a restored model's private timers may be
_ahead_ of `gameTime_ms`, which every ticking game must guard against.

## Save / restore (this is a headline feature)

`BaseGameModel.saveCheckpoint()` serializes the whole model to `IStorage` (localStorage) via
the game's `ITypeHelper`. On load, `instantiateGame` restores it unless the state was
`Destroyed`. This is why **refreshing the page resumes the game exactly where it was** — very
useful when editing code mid-game. Call `saveCheckpoint()` after meaningful state changes
(the models already do so in their handlers).

Each game provides a **type helper** (`getTemplate...TypeHelper`) that tells the serializer how
to name/construct its classes and which properties to skip or specially rehydrate (e.g.
wrapping arrays back into MobX `observable`). The base class helpers
(`getPresenterTypeHelper`/`getClientTypeHelper`) wrap the game's helper to add framework
types like `ClusterFunPlayer`.

## Versions

Two of them, on purpose.

**The platform version** is `package.json` (0.6.0), surfaced as `GLOBALS.Version` and shown in
the lobby **beside the wordmark** (it used to sit in the footer next to "I have a room code",
which is not where anyone looks for "which build is this"). It says which build of ClusterFun
is running.

**Each game has its own version, on top of that** — all at 0.1.0. A player says "Lexible did
X"; "which version?" now has an answer per game rather than one number for the whole app.

A game's version is **not a bare string**: it is the newest entry of a change history in its
`GameSettings.ts`, and the number is derived from it.

```ts
export const LEXIBLE_VERSION_HISTORY: GameVersionEntry[] = [
  { version: "0.1.0", changes: ["...", "..."] }, // newest FIRST
];
export const LexibleVersion = currentVersion(LEXIBLE_VERSION_HISTORY);
```

That is the whole point: the version and the changelog cannot drift, and there is no way to
bump a number without saying what changed. `libs/config/GameVersion.spec.ts` checks every
game's history at once — well-formed numbers, newest first, no duplicates, and **no entry with
an empty change list**.

**The lobby shows every game's version on its card**, next to the title. It reads them from
`games/lists/gameVersions.ts`, which maps a registry `name` to that game's own version
constant. This does not break code-splitting — every `GameSettings.ts` imports from `libs` and
nothing else, so the map costs the version strings and no game bundle — and it is not a second
copy of the numbers, because each entry points at the constant the game derives from its own
change history. `gameVersions.spec.ts` fails if the map and the registry drift in either
direction.

`<GameVersionTag>` (in `libs/components`) renders the name with the version small and faded to
its right, and every game uses it on both surfaces:

- **Presenter** — pass `showChanges`; clicking opens the change list. The panel is
  `position: fixed`, which inside `UINormalizer`'s CSS transform means it covers the
  **normalized 1080-tall canvas** rather than the browser window — which is what makes it land
  correctly at any window size. Its font-size is **absolute (24px)** rather than inherited: it
  used to take the size of whatever corner the tag sat in, and PartyPix's 14px footer produced
  a 9.8px changelog on a television.
- **Client** — no `showChanges`. A modal over a player's controls mid-round is a bug.
- `title` is optional. Lexible's phone header already says which TEAM you are on, which is
  worth more than the game's name, so it passes the history alone and only the version renders.

## The game registry (`src/games/lists/`)

- `GameDescriptor.ts` — three types, and the split matters:
  - `GameDescriptor` — a **registry** entry: `name`, `displayName?`, `logoName`, `importThunk`.
    **Carries no tags.**
  - `GameManifestItem` — what the **server** serves: `name`, `displayName?`, `tags`.
  - `LobbyGame` — a registry entry with the manifest folded in. What the lobby renders.
- `gamesListRelease.ts` — games shipped in production: Eittris, OneOhOne, PartyPix, Lexible,
  RetroSpectro.
- `gamesListDebug.ts` — `releaseGames.concat(...)` **plus** Stressato and Template.
- `gamePopularity.ts` — fetches `GET /api/game_popularity` and sorts descending by score, ties
  broken by registry index. Any failure silently keeps registry order.
- `GameChooser.tsx` picks debug vs release list based on `REACT_APP_SHOW_DEBUG_GAMES`.

### Registering a game — five places, not one

1. `src/games/<Name>/` — the folder. `views/GameComponent.tsx` is the default-export target;
   `assets/Assets.ts` must export `images.logo`.
2. `src/games/lists/gamesListDebug.ts` → add to `debugOnlyGames` while developing.
3. `src/games/lists/gamesListRelease.ts` → move it here to ship (debug list picks it up).
4. `src/lobby/LobbyPresentation.ts` → a `KNOWN[<name>]` card (category, blurb, players,
   playTime, thumbKind). There are defaults, but every shipped game has one — without it the
   lobby renders fallback art.
5. `clusterfun-server/src/apis/ApiHandlers.ts` → `getGameManifest`, **with the tag you want**
   (`alpha` / `beta` / `debug`, or none for a full release). **Requires a server deploy.**
   Without this the game does not appear in production at all.

> ### The server manifest is the sole authority on tags
>
> The client registry deliberately **has no tags**. `index.tsx` builds the production list from
> the manifest, matches case-insensitively by name, and takes the manifest's `tags` (and its
> `displayName`, when set). Outside production there is no manifest, so tags are empty and
> every game the build knows about is visible.
>
> So **badging a game is a server-side edit and a server deploy** — you cannot promote a game
> from alpha to release by changing the client. The lobby renders a badge for `beta`, `alpha`
> and `debug`, and hides any game whose tags don't intersect `showTags` (default `production`,
> `beta`, `alpha` — so a `debug`-tagged game needs `?show=debug`).

## Lobby vs Test Lobby (`index.tsx` chooses)

`index.tsx` branches on env vars:

- `REACT_APP_QUICKTEST` → `QuickTestComponent`.
- `REACT_APP_DEVMODE === 'development'` → **Test Lobby** (`GameTestModel` + `GameTestComponent`).
- otherwise → **real Lobby** (`LobbyModel` + `LobbyMainPage`), which calls the real server
  (`/api/startgame`, `/api/joingame`, `/api/game_manifest`) over real WebSockets.

### Test Lobby (`src/testLobby/`) — serverless game development

The primary way to develop a game. `GameTestModel` builds **one presenter `LobbyModel` + four
client `LobbyModels`** on a single page, wired to a **virtual server**:

- `serverCall(url, payload)` is a local function that fakes `/api/startgame`, `/api/joingame`,
  `/api/terminategame`, `/api/am_i_healthy` and `/api/health_data` — no HTTP.
- Transport is `LocalMessageThing` (in `libs/messaging/MessageThing.ts`), which routes
  messages through an in-memory `Map` of room inhabitants with simulated latency, instead of
  a WebSocket.
- Because presenter and clients don't know they're in this mode, "if it works in the test
  lobby, it works on the server" — you can be ~99% sure.
- State is checkpointed per role, so refreshing the page resumes all five participants where
  they were. Use the page's **"clear all"** to start over.

## Creating a new game

**Follow `src/games/TemplateGame/README.md`** (manual steps and Claude-prompting guide) and,
when building with Claude, `src/games/TemplateGame/CLAUDE.md` (interview the user about the
design first, then scaffold). Short version:

1. Copy `src/games/TemplateGame` to `src/games/<YourGame>` (drop the copied CLAUDE.md).
2. Rename all `Template`/`template` identifiers to your game — including the serializer
   type-name strings in both type helpers.
3. Define your endpoints, pure rules module (+ spec), presenter model (states, `handleTick`,
   round logic, message handlers), client model (input actions,
   `requestGameStateFromPresenter`), and the two views. Keep the type helpers in sync with
   any new serializable classes, and show `PlayerAvatar` wherever players appear.
4. Add assets under `assets/` and reference them via `Assets.ts`.
5. Register the game in `src/games/lists/gamesListDebug.ts` while developing; move it to
   `gamesListRelease.ts` to ship. For it to show in production, also add it to the server's
   `game_manifest`.

## Build & run

```
npm install
npm start          # .env.dev → development → Test Lobby at http://localhost:3000
npm run startlocal # .env.local variant
npm run build      # production build → build/  (served by the relay server / deploy)
npm run analyze    # build with --stats, then open the bundle analyzer
npm test           # react-scripts (Jest) test runner, single pass
```

> `build` deliberately does **not** pass `--stats`: that wrote a 23MB `bundle-stats.json` into
> every build, which the deploy then shipped to the Pi and served publicly. `analyze` (via
> `build:stats`) produces it on demand instead. Source maps are still generated — the deploy
> excludes them rather than the build skipping them, so a stack trace off a real phone can
> still be symbolicated locally.

Env files (CRA `REACT_APP_*`):

- `.env.dev` — `REACT_APP_DEVMODE=development`, `REACT_APP_SHOW_DEBUG_GAMES=1` (Test Lobby + debug games).
- `.env.local` — everything commented out (behaves like production lobby locally).
- `.env.production` — `REACT_APP_USE_REAL_TELEMETRY=1`, loaded automatically by
  `npm run build`, so production reports real analytics. Set `REACT_APP_NO_TELEMETRY=1` to
  opt a build out. Tracking IDs come from `src/secrets.ts` (create from
  `src/secrets.ts.template`; git-ignored) — see Analytics below.
- `proxy` in `package.json` points API/socket calls at `http://localhost:8080` (the relay).

## Background music in the Test Lobby

Music is served by the **relay server** in production, from
`clusterfun-server/hosted_content/music`. The Test Lobby is deliberately serverless, so
`npm start` on its own had nothing behind `/music` — the dev server proxied to `:8080`,
got `ECONNREFUSED`, and every presenter reported "No music installed" while the tracks sat
on disk one directory away.

**`src/setupProxy.js`** fixes that. CRA loads it automatically and it mirrors what the server
does with the same folder: a generated manifest at `/music/music.json` and the files
underneath. Drop a track in and it appears on the next reload. `CLUSTERFUN_MUSIC_PATH`
overrides the folder.

- Its `MUSIC_SCHEMA_VERSION` must match `libs/Media/MusicLibrary.ts` and the server's copy —
  the client drops a manifest whose schema it does not recognise.
- It uses a cheap `(size, mtime)` cache token rather than a content hash. The server upgrades
  to a real hash in the background; in dev the token only has to change when the file does.
- `REACT_APP_MUSIC_BASE_URL` (set to `/music` in `.env.dev`) still decides whether music is on
  at all. Unset means off, and that is not an error.

**"No music" is three different situations** and Eittris' audio bar now says which: music
switched off, a manifest that would not load, or a manifest with no tracks. It said
"No music installed" for all three, which sends somebody looking for missing files when the
truth is that nothing was serving them.

## Keyboard & controller input (`libs/Input/`)

Any game can take keyboard and controller input by declaring a **binding table** and handing
it to `GameInputController`. Nothing in the framework knows about a particular game, so a
game changes its controls by editing data, not event handlers.

```ts
const controller = new GameInputController(MY_BINDINGS, {
  onAction: (action) => {
    /* "moveLeft", "drop", ... */
  },
  onGamepadChange: (connected) => this.setState({ hasGamepad: connected }),
});
controller.attach(); // componentDidMount
controller.detach(); // componentWillUnmount
```

- **Keys are matched on `KeyboardEvent.code`** (the physical key), so WASD still works on
  AZERTY and `Numpad4` is distinguishable from a top-row `4`.
- **Controllers are polled**, because the Gamepad API has no button events. The controller
  runs a `requestAnimationFrame` loop and turns polled state into presses/releases. This
  works on phones too — a Bluetooth pad reports through the same API.
- **Hold-to-repeat is ours, not the browser's** (`ActionRepeater`): the OS repeat rate is a
  user setting, which is no basis for game feel. Repeat is opt-in _per action_ — holding
  "left" should walk a piece across the board, holding "rotate" should not spin it. The
  repeater takes an explicit `dtMs`, which is what makes the cadence unit-testable.
- **Focus loss releases everything.** Alt-tab while holding a key and the `keyup` never
  arrives, which would leave a piece sliding forever.
- **Text fields win.** While an `input`/`textarea`/`select` has focus, keys belong to it.

See `games/Eittris/models/eittrisInput.ts` for a worked example: nine actions bound across
four keyboard clusters (WASD, IJKL, arrows, numpad) plus a controller, following the usual
tetris conventions so muscle memory carries over.

## Analytics

Two separate things, on purpose:

**Google Analytics (GA4)** answers the product questions. Everything goes to **one** GA4
property — the game is a _parameter_ on each event, not a property of its own, so "which
games get played the most" is one report rather than five. The measurement id lives in
gitignored `src/secrets.ts` under the name `DEFAULT` (copy `src/secrets.ts.template`); with
no secrets file the app still runs and just logs events to the console.

Real reporting is on whenever `REACT_APP_USE_REAL_TELEMETRY` is set and
`REACT_APP_NO_TELEMETRY` is not. `.env.production` sets it, so **`npm run build` reports for
real**; `.env.dev` leaves it unset, so the Test Lobby gets `MockTelemetryLogger` and prints
`Analytics(<game>): <event> {...}` to the console — which is how you check events without
touching GA.

### Using it from a game

`BaseGameModel` exposes `this.analytics`. That is the whole API:

```ts
this.analytics.track("word_played", { length: 7, bonus: true });
```

Three dimensions are stamped onto **every** event and cannot be overridden by the caller:

| Param       | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `game`      | The game, folded so a host and its phones agree (see below)    |
| `device_id` | A random per-browser id from `localStorage`; anonymous, no PII |
| `entity`    | `host` (shared screen), `client` (a phone), or `lobby`         |

> **Naming:** client models are called `<Game>Client` by convention, and
> `BaseGameModel.analyticsGameName` strips that suffix. If a host and its clients ever report
> different `game` values, every by-game report silently splits in two — override
> `analyticsGameName` if a game names its models some other way.

Analytics never throws into game code: a failing backend is logged and swallowed.

### What the base classes report on their own

A game gets these for free — do not re-send them:

| Event                | Fired by  | Carries                                                                          |
| -------------------- | --------- | -------------------------------------------------------------------------------- |
| `cf_game_started`    | presenter | `player_count`, `replay`                                                         |
| `cf_game_ended`      | presenter | `outcome` (completed/abandoned), `completed`, `player_count`, `duration_seconds` |
| `cf_player_joined`   | both      | `player_count`                                                                   |
| `cf_player_rejoined` | both      | `player_count`, `matched_by` (`id`/`name`)                                       |
| `cf_player_quit`     | presenter | `player_count`                                                                   |
| `cf_join_denied`     | both      | `reason`                                                                         |
| `cf_client_error`    | anywhere  | `error_source`, `error_name`, `error_message`, `error_where`, `error_index`      |

- **Completion** means the game reached `GameOver`; **abandoned** means it was destroyed
  while still playing. A game that simply stops being heard from reports neither, which
  matters when reading completion rates.
- **Rejoins are the lost-connection signal** — the presenter only takes that path for a
  player it had already lost. `matched_by: "name"` means the device had forgotten its id,
  i.e. a reboot.
- Host and client both report joins, tagged by `entity`. **Filter `entity=host` for
  authoritative counts**, or a two-player game looks like four joins.

### Crash reporting (`libs/telemetry/ErrorReporter.ts`)

Nothing to call — it is wired up for you. `installGlobalErrorHandlers()` runs at startup in
`index.tsx` and catches what an error boundary cannot: a throw from an event handler or a
timer, and any unhandled promise rejection. `ErrorBoundary` reports render errors. Each game
model re-points the reporter at its own analytics channel, so an in-game crash arrives tagged
with the game and with host-vs-phone.

Three rules it is built around, and a reason for each:

- **Never throws.** A reporter that breaks while reporting is worse than none.
- **Deduplicates and caps at 10 per page load.** A render loop throws every frame; without
  this the interesting first error is buried under thousands of copies of itself. A count
  here means _distinct failures_, not occurrences.
- **Clips every value to 90 characters.** GA4 silently truncates a parameter at 100, so a raw
  stack would arrive as a useless prefix. `error_where` is the first stack frame that is
  _our_ code, skipping `node_modules`, which is the single most useful line.

Call `reportError(source, error, extra?)` directly if you catch something worth knowing about
and are deliberately swallowing it.

## Game popularity (the lobby's own ordering)

Separate from GA, and deliberately so: the lobby must be able to order itself without a third
party in the loop. The relay counts plays and joins per game and serves them at
`GET /api/game_popularity` (see [../clusterfun-server/CLAUDE.md](../clusterfun-server/CLAUDE.md)).
`games/lists/gamePopularity.ts` fetches that and sorts the list, most-played first.

- The score is **recency-weighted** (a play is worth half as much after a month), so last
  year's hit does not outrank what people are playing now.
- Games with no plays keep their registry position rather than sinking — otherwise a new
  game could never climb.
- If the endpoint is missing or unreachable, the lobby silently keeps registry order.

## Testing

**Add tests for new logic, and run the suite before you commit.** Tests are the cheapest way
to keep the presenter/client/serialization machinery from silently breaking as games change.

- Runner is **Jest** via `react-scripts test` (works today on Node 26). `npm test` runs one
  pass; `npm test -- --watch` watches; `npm test -- --coverage` reports coverage.
- **`--maxWorkers=2` is in the `test` script on purpose.** At the default worker count (one
  per core) this suite exhausts the V8 heap on a many-core box and dies with
  `FATAL ERROR: Zone Allocation failed - process out of memory`. The damage is not a clean
  failure: dying workers report as **module-resolution errors** in whichever specs they were
  holding — `Cannot find module 'dedent' from jest-circus`, `Cannot find module 'libs' from
<some>.spec.ts` — which read as a broken install rather than an OOM, and the same suite
  passes on the next run. It failed two production deploys that way before the cap went in.
- Test files live next to their source as `*.spec.ts` / `*.spec.tsx` (Jest also picks up
  `*.test.*` and `__tests__/`). `src/setupTests.ts` registers `@testing-library/jest-dom`.
- **Logic** (highest value): pure units like `libs/comms/messageParsing`,
  `libs/storage/BruteForceSerializer` (the save/restore engine — round-trip classes, Maps,
  Sets, and shared/circular refs), `libs/messaging/EventThing`, `libs/messaging/MessageThing`
  (the `LocalMessageThing` virtual transport), `libs/types/Vector2`, and game algorithms like
  Lexible's `LetterGridPath`. Use Jest's `expect` (a few older specs use `chai` — either is fine).
- **UI** where it earns its keep: use `@testing-library/react` (`render`/`screen`/`fireEvent`)
  for self-contained components with real interaction logic (see `libs/components/LabelBox.spec.tsx`).
  Components wired to a full MobX model + `SessionHelper` are usually better exercised through
  their model's logic tests and the Test Lobby than through heavy render tests.
- **When you add a new game or change a model:** cover the presenter/client state transitions
  and any new serializable types (a serializer round-trip test catches type-helper mistakes
  that would otherwise only surface as a broken save/restore mid-game).

### The cross-game net (`libs/GameModel/AllGamesLifecycle.spec.ts`)

Runs the lifecycle every game must survive — join → serializer round-trip → drop → rejoin →
play again → shut down — against **every game's real presenter and real type helper**. It
knows nothing about any game's rules.

**Add your game to its `GAMES` list.** That is the whole maintenance burden, and it buys the
serializer round-trip for free: a type helper that has forgotten a class is otherwise invisible
until somebody refreshes mid-game and the party restarts. It found a live bug the first time it
ran — RetroSpectro's own `playAgain` rebuilt the player list by hand and dropped every
`playerToken` and `connectionId`, so after a replay the host had no address to send to.

A game with its own `playAgain` must call `resetPlayersForReplay()` rather than rebuilding
`players` itself.

## Conventions

- **MobX everywhere.** Models use `@observable` + `makeObservable`/`makeAutoObservable`;
  views are `observer` components that read model state. Mutate observables inside actions
  (the base classes wrap setters in `action(...)`).
- **One class per file**, OO structure (matches the global working practices).
- Import shared framework types from `"libs"`.
- Presenter owns state; clients stay thin. Don't push rendering or authoritative logic to the
  client model.
- After state changes that must survive a refresh, ensure a `saveCheckpoint()` happens.
- **Cover new logic with a `*.spec.ts` and run `npm test` before committing** (see Testing).
- **Format with Prettier before committing.** Run `npm run format` (`prettier --write --cache .`);
  `npm run format:check` verifies without writing. Config is in `.prettierrc.json`:
  `printWidth: 100` (100 columns) and **double quotes** (`singleQuote: false`); all else is
  Prettier defaults. Generated `.d.ts` files, `build/`, and `lib/` are in `.prettierignore`.

## `.d.ts` files in `src`

Nine `libs` files have committed `.d.ts` files alongside their `.ts/.tsx`. They are stale
artifacts of an **abandoned** effort to publish `libs` as an npm package; the webpack configs,
`.env.lib`, the `watch` script and the packaging dependencies that went with it have all been
deleted. Always edit the `.ts/.tsx` source; the `.d.ts` can drift and silently win resolution.

> **Exception — do not delete `libs/Media/sam-js.d.ts`.** It looks identical in kind but is
> hand-written: an ambient `declare module "sam-js"` for an untyped package that Lexible's
> presenter imports. Removing it breaks the build.
