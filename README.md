# clusterfun-client

The ClusterFun front end: one React/MobX app containing the lobby and **every game**. All game
logic and game state live here — the server is only a relay.

Every game runs in two roles from the same module: one **presenter** (the shared screen, owns
the state) and one **client** per player (a phone, sends input, never renders the game).

## Run it

```
npm install
npm start        # Test Lobby at http://localhost:3000
```

`npm start` opens the **Test Lobby** — a presenter and four clients on one page, wired to an
in-memory virtual server. No relay server needed, and because the game code can't tell the
difference, a game that works here will almost certainly work for real. Refreshing the page
resumes all five participants where they were; "clear all" starts over.

```
npm run build    # production build → build/
npm test         # Jest, single pass
npm run format   # Prettier; run before committing
```

To run against the real relay server instead, see the
[root README](../README.md#running-the-whole-thing-locally).

## Layout

| Path             | What                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `src/games/`     | Every game, one folder each, plus `lists/` (the registry).                   |
| `src/libs/`      | The framework games build on — see [src/libs/CLAUDE.md](src/libs/CLAUDE.md). |
| `src/lobby/`     | The real lobby: pick a game, start or join a room.                           |
| `src/testLobby/` | The serverless dev harness described above.                                  |

## Starting a new game

Copy `src/games/TemplateGame` and follow its [README](src/games/TemplateGame/README.md).
Registering a game touches **five** places, one of which is in the server repo — the checklist
is in [CLAUDE.md](CLAUDE.md).

Deeper notes for both humans and Claude are in [CLAUDE.md](CLAUDE.md), and each game has its
own `CLAUDE.md`.
