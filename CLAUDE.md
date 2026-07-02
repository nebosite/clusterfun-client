# clusterfun-client

The ClusterFun front end: a single React/MobX app that contains the lobby **and every
game**. This is where all game logic and game state live — the server is just a relay
(see [../clusterfun-server/CLAUDE.md](../clusterfun-server/CLAUDE.md)).

React 18 + MobX 6 + TypeScript, bootstrapped with Create React App (`react-scripts`). Games
are code-split and lazy-loaded so only the chosen game's bundle downloads.

## The presenter / client model (read this first)

Every game is really **two apps** running the same game module in different roles:

- **Presenter** — one per room. Runs the game instance, owns *all* game state, decides state
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
    TestGame/            The template game ("Testato"). Copy this to start a new game.
    Lexible/             A real word game.
    RetroSpectro/        A retrospective/sorting game.
    stressgame/          "Stressato" — load/stress test game.
  lobby/                 Real lobby: pick a game, start/join a room, host the running game.
  testLobby/             Serverless dev harness: presenter + 4 clients + virtual server on one page.
  libs/                  The framework all games build on (see below).
```

### `libs/` — the game framework

| Area | Key files | Purpose |
|------|-----------|---------|
| Game models | `GameModel/BaseGameModel.ts`, `GameModel/ClusterfunPresenterModel.ts`, `GameModel/ClusterfunClientModel.ts` | Base classes for presenter/client. |
| Messaging | `messaging/SessionHelper.ts`, `messaging/MessageEndpoint.ts`, `messaging/ClusterfunListener.ts`, `messaging/ClusterfunRequest.ts`, `messaging/basicEndpoints.ts` | Typed request/response + fire-and-forget over the relay. |
| Transport | `messaging/MessageThing.ts` | `WebSocketMessageThing` (real) and `LocalMessageThing` (virtual/in-memory for the test lobby). |
| Wire format | `comms/ClusterFunMessageHeader.ts`, `comms/ClusterFunRoutingHeader.ts`, `comms/messageParsing.ts` | `{header}^{routing}^{payload}` string encoding. Header shape mirrors the server. |
| Serialization | `storage/BruteForceSerializer.ts`, `debugging/serialization.ts` | Class-aware (de)serialization driven by each game's `ITypeHelper`. |
| Storage | `storage/StorageHelper.ts` | `IStorage` (localStorage-backed). Keyed per role in the test lobby. |
| Telemetry | `telemetry/TelemetryLogger.ts`, `telemetry/MockTelemetryLogger.ts` | Google Analytics (prod) or a no-op mock (dev). |
| UI base | `components/ClusterfunGameComponent`, `components/ClusterCanvas`, `components/DevUIComponent` | Shared React components. |
| Misc | `Animation/`, `Media/` (sound/`MediaHelper`), `types/Vector2.ts`, `Input/`, `Browser/` | Support utilities. |

Most things are re-exported from `libs/index.ts`, so games import from `"libs"`.

## Anatomy of a game (using TestGame / "Testato")

A game is a folder under `src/games/<Name>/`:

```
TestGame/
  index.ts                     Re-exports views. (Registry entry points at views/GameComponent.)
  views/
    GameComponent.tsx          Extends ClusterfunGameComponent; init(lazyPresenter, lazyClient, presenterTypeHelper, clientTypeHelper)
    Presenter.tsx              React view for the shared screen (observes the presenter model)
    Client.tsx                 React view for a player's device (observes the client model)
    index.ts
  models/
    PresenterModel.ts          TestatoPresenterModel extends ClusterfunPresenterModel<TestatoPlayer>; game states; message handlers; type helper
    ClientModel.ts             TestatoClientModel extends ClusterfunClientModel; input actions; type helper
    testatoEndpoints.ts        MessageEndpoint definitions (the typed API between client & presenter)
    GameSettings.ts            Constants (e.g. PLAYTIME_MS)
  assets/
    Assets.ts                  Asset manifest (logo image, sounds)
    images/, sounds/
  README.md
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
- Each game adds its own states (e.g. `TestatoGameState.Playing / EndOfRound`) and sets
  `gameState` on the model. Setting `gameState` fires an event and logs; setting it to
  `Unknown` throws.
- The presenter drives time via `BaseGameModel`'s ticker (default 33ms). `ClusterfunPresenterModel`
  computes `secondsLeftInStage`, exposes `isStageOver` (based on `timeOfStageEnd`), and calls
  the game's `handleTick()` each frame. Games override `handleTick`, `startNextRound`,
  `prepareFreshRound`, `prepareFreshGame`.
- **Turn-based vs arcade** is just how a game uses the tick and endpoints: turn-based games
  transition on discrete player actions/timeouts; arcade games run continuous per-frame logic
  (see the client's `gameThink(elapsed_ms)` in TestGame, which animates every frame).

### Messaging between presenter and client

Communication is via typed **`MessageEndpoint<REQUEST, RESPONSE>`** objects (a `route`
string plus optional retry hints), defined per game (e.g. `testatoEndpoints.ts`) plus shared
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

### Save / restore (this is a headline feature)

`BaseGameModel.saveCheckpoint()` serializes the whole model to `IStorage` (localStorage) via
the game's `ITypeHelper`. On load, `instantiateGame` restores it unless the state was
`Destroyed`. This is why **refreshing the page resumes the game exactly where it was** — very
useful when editing code mid-game. Call `saveCheckpoint()` after meaningful state changes
(the models already do so in their handlers).

Each game provides a **type helper** (`getTestato...TypeHelper`) that tells the serializer how
to name/construct its classes and which properties to skip or specially rehydrate (e.g.
wrapping arrays back into MobX `observable`). The base class helpers
(`getPresenterTypeHelper`/`getClientTypeHelper`) wrap the game's helper to add framework
types like `ClusterFunPlayer`.

## The game registry (`src/games/lists/`)

- `GameDescriptor.ts` — the shape: `name`, `displayName?`, `tags`, `logoName`, `importThunk`
  (returns the lazy game component).
- `gamesListRelease.ts` — games shipped in production.
- `gamesListDebug.ts` — release games **plus** debug-only games (Testato, Stressato).
- `GameChooser.tsx` picks debug vs release list based on `REACT_APP_SHOW_DEBUG_GAMES`, and
  lazy-loads a game's component by name.

> In **production** the lobby intersects this registry with the server's hardcoded
> `game_manifest` — a game must be in *both* to appear. In dev/test lobby the manifest is
> bypassed and the debug list is used directly.

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
  `/api/terminategame`, `/api/am_i_healthy` — no HTTP.
- Transport is `LocalMessageThing` (in `libs/messaging/MessageThing.ts`), which routes
  messages through an in-memory `Map` of room inhabitants with simulated latency, instead of
  a WebSocket.
- Because presenter and clients don't know they're in this mode, "if it works in the test
  lobby, it works on the server" — you can be ~99% sure.
- State is checkpointed per role, so refreshing the page resumes all five participants where
  they were. Use the page's **"clear all"** to start over.

## Creating a new game

1. Copy `src/games/TestGame` to `src/games/<YourGame>`.
2. Rename all `Testato`/`testato` identifiers to your game.
3. Define your endpoints, presenter model (states, `handleTick`, round logic, message
   handlers), client model (input actions, `requestGameStateFromPresenter`), and the two
   views. Keep the type helpers in sync with any new serializable classes.
4. Add assets under `assets/` and reference them via `Assets.ts`.
5. Register the game in `src/games/lists/gamesListRelease.ts` (and it will inherit into the
   debug list). For it to show in production, also add it to the server's `game_manifest`.

## Build & run

```
npm install
npm start          # .env.dev → development → Test Lobby at http://localhost:3000
npm run startlocal # .env.local variant
npm run build      # production build → build/  (served by the relay server / deploy)
npm test           # react-scripts (Jest) test runner, single pass
```

Env files (CRA `REACT_APP_*`):

- `.env.dev` — `REACT_APP_DEVMODE=development`, `REACT_APP_SHOW_DEBUG_GAMES=1` (Test Lobby + debug games).
- `.env.local` — everything commented out (behaves like production lobby locally).
- `REACT_APP_USE_REAL_TELEMETRY=1` swaps the mock telemetry for real GA and pulls tracking
  IDs from `src/secrets.ts` (create from `src/secrets.ts.template`; git-ignored).
- `proxy` in `package.json` points API/socket calls at `http://localhost:8080` (the relay).

## Testing

**Add tests for new logic, and run the suite before you commit.** Tests are the cheapest way
to keep the presenter/client/serialization machinery from silently breaking as games change.

- Runner is **Jest** via `react-scripts test` (works today on Node 26). `npm test` runs one
  pass; `npm test -- --watch` watches; `npm test -- --coverage` reports coverage.
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

## `.d.ts` files in `src`

Several `libs` components have committed `.d.ts` files alongside `.tsx`. These are build
artifacts from the library-packaging webpack configs (`lib-webpack*.config.js`, driven by the
`lib` npm entry). For normal app development you edit the `.ts/.tsx` sources.
