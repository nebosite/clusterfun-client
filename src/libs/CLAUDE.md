# libs — the game framework

Everything every game builds on. **Import from `"libs"`** (most things are re-exported from
`index.ts`), not from deep paths.

Two categories, and the distinction matters:

- **Contracts** — `GameModel`, `messaging`, `comms`, `storage`. Changing these changes every
  game at once, and there is almost no test coverage protecting them (see _Testing_ below).
- **Utilities** — `components`, `Input`, `Media`, `Animation`, `types`, `Browser`, `telemetry`,
  `config`, `debugging`. Optional; a game uses what it needs.

## Map

| Folder                                        | Key files                                                                                                                                                        | What it is                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GameModel/`                                  | `BaseGameModel.ts`, `ClusterfunPresenterModel.ts`, `ClusterfunClientModel.ts`                                                                                    | The base classes. **Read this folder before writing a model.**                                                                                                     |
| `messaging/`                                  | `MessageEndpoint.ts`, `SessionHelper.ts`, `ClusterfunListener.ts`, `ClusterfunRequest.ts`, `basicEndpoints.ts`, `MessageThing.ts`                                | Typed request/response + fire-and-forget. `MessageThing` holds both the real `WebSocketMessageThing` and the in-memory `LocalMessageThing` the Test Lobby runs on. |
| `comms/`                                      | `ClusterFunMessageHeader.ts`, `ClusterFunRoutingHeader.ts`, `messageParsing.ts`                                                                                  | Wire format: `{header}^{routing}^{payload}`. **Mirrored in the server — see the warning below.**                                                                   |
| `storage/`                                    | `BruteForceSerializer.ts`, `StorageHelper.ts`                                                                                                                    | Class-aware (de)serialization driven by each game's `ITypeHelper`; `IStorage` over localStorage.                                                                   |
| `components/`                                 | `ClusterfunGameComponent`, `UINormalizer`, `PlayerAvatar`, `ClusterCanvas`, `Touchable`, `Slider`, `DragScroller`, `DevUIComponent`, `ErrorBoundary`, `LabelBox` | Shared React. **Check here before building a UI primitive** — games have re-invented several of these.                                                             |
| `Input/`                                      | `GameInputController`, `ActionRepeater`                                                                                                                          | Declarative keyboard/gamepad binding tables.                                                                                                                       |
| `Media/`                                      | `SoundHelper`, `MediaHelper`, `MusicLibrary`, `MusicPlayer`, `VolumePreferences`                                                                                 | Sound + the server-hosted music stack. Only Eittris uses the full set.                                                                                             |
| `Animation/`, `types/`, `Browser/`, `config/` | `AnimationController`, `Vector2`, `SafeBrowser`                                                                                                                  | Support utilities.                                                                                                                                                 |
| `telemetry/`                                  | `TelemetryLogger`, `MockTelemetryLogger`, `GameAnalytics`                                                                                                        | GA4 in prod, console mock in dev. Reached via `this.analytics`.                                                                                                    |
| `debugging/`                                  | `serialization.ts`                                                                                                                                               | Effectively dead — its only export has no callers.                                                                                                                 |

## The rules that are easy to get wrong

**Wire everything in `reconstitute()`, never in a constructor.** `instantiateGame`
(`GameModel/BaseGameModel.ts:40`) either restores the model from storage **or** builds it
fresh, then `componentDidMount` calls `reconstitute()`. That is the one path both cases share,
so it is the only correct place to attach listeners, re-subscribe events, and re-wrap restored
arrays in `observable()`.

**Setting `gameState` fires an event named after the state** (`BaseGameModel.ts:170`) — that is
how `subscribe(GeneralGameState.Destroyed, ...)` works. Setting it to `Unknown` throws.

**`shouldStringify`'s exclusion list is matched by string literal**
(`BaseGameModel.ts:104-120`). Rename a private field on `BaseGameModel` and it silently starts
being serialized into every game's checkpoint.

**`saveCheckpoint()` is synchronous main-thread work** — serialize, `JSON.stringify` with
pretty-printing, then a synchronous `localStorage.setItem` — debounced to ~500 ms. Don't call
it per tick, and exclude heavy fields via the type helper.

**`sendToEveryone` / `requestEveryone` take `(player, isExited)`.** `player` is real and useful
for per-recipient payloads. **`isExited` is always `false`** — both methods only ever iterate
connected players. Booted players are never messaged, and disconnected ones are skipped
(they would not answer, and an awaited `requestEveryone` would hang on them). Use
`sendToPlayer(endpoint, player, message)` to reach exactly one.

**A player's `playerId` is permanent; `connectionId` is the relay address and moves on every
reconnect.** Never key game state on `connectionId`. Presenter message handlers receive the
**stable `playerId`** as `sender` — `listenToEndpoint` translates it — so
`players.find(p => p.playerId === sender)` survives a reconnect. `listenToConnection` is the
untranslated form and exists for `Join` alone. The full contract, including disconnect and
boot semantics, is in [../../CLAUDE.md](../../CLAUDE.md) and pinned by
`GameModel/PresenterReconnect.spec.ts`.

**`BruteForceSerializer` preserves explicit `null`s** (and `parseData` returns early on them).
It used to drop any property that normalized to null, which silently turned a stored `null`
into `undefined` on restore — so `x !== null` took the wrong branch after every refresh.

**Every inbound message is parsed once per registered listener.** `ClusterfunListener` and each
in-flight `ClusterfunRequest` attach their own raw `"message"` handler and run a full
`parseMessage` — regex plus `JSON.parse` of the whole payload — **before** checking whether the
route matches. Cost is O(listeners × messages × payload size). Keep listener counts low and
payloads small; a 133 KB PartyPix upload gets parsed ~10 times on the presenter.

**Payloads are untrusted and unverified.** `listen()` does not check that the sender is a joined
player (there is an explicit `TODO` at `ClusterfunListener.ts:33`), so each game re-implements
its own `players.find(p => p.playerId === sender)`. A missed check is a per-game hole.

**`allowRejoinOnNameOnly` defaults to `true`** (`ClusterfunPresenterModel.ts:131`), and names
are visible on the shared screen. The `playerToken` path already handles honest rejoins.

> ### `comms/` and `config/` are duplicated in the server
>
> `ClusterFunMessageHeader.ts` and `config/GameInstanceProperties.ts` each exist twice — the
> two projects are separate repos with no shared package between them. **They must be
> byte-identical**, and the root repo's `scripts/check-shared-contracts.js` enforces it: the
> deploy runs it before building, and `npm run check:contracts` runs it by hand.
>
> They had drifted, which is why the check exists. Treat any edit here as a two-repo change.

## Testing

Coverage is thin exactly where the blast radius is largest.

| Area                                          | State                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comms`, `storage`, `types`                   | Genuinely well covered — serializer round-trips, message framing, `Vector2`.                                                                                                                              |
| `GameModel` (1,120 lines)                     | **One spec**, `PresenterAnalytics.spec.ts` — and it asserts _analytics params_, not join/rejoin/checkpoint behavior. It walks the join path and would still pass if `onPlayerReturned` were never called. |
| `messaging`                                   | `SessionHelper.ts` (226 lines) and `ClusterfunListener.ts` (100 lines) have **zero** specs.                                                                                                               |
| `components`                                  | 19 source files, 1 spec (`LabelBox.spec.tsx`).                                                                                                                                                            |
| `Animation`, `Browser`, `config`, `debugging` | None.                                                                                                                                                                                                     |

**A change to `BaseGameModel` or the serializer has no cross-game regression net.** Only Eittris
and PartyPix have presenter specs; the other five games would break silently until someone
played them. If you touch a contract folder, verify in the Test Lobby with a mid-game refresh
and a rejoin — `npm test` will not tell you.
