# PartyPix — architecture notes

A ClusterFun game (presenter + client on one shared module). Read [DESIGN.md](DESIGN.md) first for
the product flow, economy, and visual spec; this file is how the code implements it. Built from the
`TestGame` template.

## The loop

`join → snap → confirm → upload (−1 credit) → shows on the slideshow → others up/down/flag →
3 upvotes = +1 credit → snap more.` Continuous/arcade — no rounds. The presenter owns all state.

## Files

```
models/
  GameSettings.ts       Tuning constants (economy, slide interval, image sizes).
  partyPixLogic.ts      PURE, framework-free rules (economy + slideshow math). Unit-tested.
  partyPixEndpoints.ts  Typed message API + PartyPixSlideInfo shape.
  PresenterModel.ts     PartyPixPlayer, PartyPixPhoto, PartyPixPresenterModel. Owns photos,
                        runs the slideshow, tallies votes, grants credits, pushes to phones.
  ClientModel.ts        PartyPixClientModel. Capture/upload/vote; optimistic; reconciles on push.
views/
  imageUtil.ts          Client-side downscale (fitWithin is pure + tested; rest is canvas glue).
  GameComponent.tsx     Boots the game (wires presenter/client type helpers).
  Presenter.tsx/.css    Join screen + slideshow (Neon Arcade, 1920x1080).
  Client.tsx/.css       Phone: Capture (+Review) / Vote tabs (Neon Arcade, 1080x1920).
```

## Key design decisions

**All economy/slideshow rules are pure functions in `partyPixLogic.ts`.** The models hold the
observable state and delegate every decision (vote acceptance, credit crossings, delete threshold,
slide index math) to these functions, so the rules are unit-tested without the framework — mirrors
RetroSpectro's `groupNaming.ts`. When changing a rule, change it there and update its spec.

**Photo transport = downscaled base64 over the relay.** The server stores nothing. On upload the
phone produces a **full** JPEG (long edge ≤ 1200, q≈0.7) for the slideshow and a small **thumb**
(≤ 256) for phones, and sends both via `PartyPixUploadEndpoint`. The full image never leaves the
presenter; only the thumb is pushed to phones (`PartyPixSlideInfo.thumb`) for the "now showing"
strip. Keeps per-message and per-client traffic modest.

**Photos are never serialized.** `saveCheckpoint()` persists to localStorage; base64 images would
blow the quota. The presenter type helper returns `shouldStringify(...) === false` for `photos`, and
the client excludes `currentSlide`/`myVotes`/`myFlags`. Players (credits/`totalUp`) do persist. On a
presenter refresh the slideshow is empty → `reconstitute()` drops back to `Gathering`. A refreshed
client re-pulls everything via `requestGameStateFromPresenter` (onboard). **Tradeoff:** photos don't
survive a presenter reload — acceptable for the MVP, noted as a deferred item.

**Messaging.** Client→presenter requests: `Onboard` (pull full state on join/reconnect/invalidate),
`Upload` (echoes authoritative credits), `Vote` (`up`/`down`/`delete`, echoes tally). Presenter→
clients fire-and-forget pushes: `SlidePush` (current slide changed — sent to everyone, `youAuthored`
filled per recipient) and `CreditsPush` (a player's credit standing moved — broadcast so each phone
reads its own; there is no single-player send in the base class). The presenter is authoritative;
clients update optimistically and reconcile on the echo/push.

**Credits.** `totalUp` is monotonic lifetime upvotes; a credit is granted each time it crosses a
multiple of `UPVOTES_PER_CREDIT` (3), capped at `CREDIT_CAP` (9). Retracting or switching a vote
never reduces `totalUp` (stay positive). You can't vote your own photo; one up/down and one flag per
player per photo; re-tapping a direction toggles it off. **Anti-farming:** each voter can move a
photo's author toward a credit **at most once** — `applyVote` tracks a per-photo `creditedVoters`
set and only the first upvote from a given voter returns `countsForCredit`, so an accomplice can't
mint credits by toggling one upvote. So `totalUp` counts _distinct_ approvers, i.e. breadth.

**MobX.** Photo vote membership is plain `Set`s (for enforcement, consumed by the pure `applyVote`)
with mirrored `@observable` counts (`up`/`down`/`deleteCount`) updated via `syncCounts()` so the
presenter's live tally re-renders. All model mutations run inside `action(() => …)()`.

## State machine

- Presenter: `Gathering` (join screen / 0 photos) → `Slideshow` on first upload → back to
  `Gathering` if all photos are removed. `minPlayers = 1`; no host "start" gate — the first photo
  starts the show. Players may join during `Gathering` and `Slideshow`.
- Client: joins → `Playing` (base `Gathering`/`Slideshow` both map here), with `viewMode`
  `capture` | `vote`. Out-of-credits is the Capture view with the action disabled.

## Running / testing

- Dev Test Lobby: `npm start` → pick **PartyPix**. On desktop the camera input becomes a file
  picker, so you can test the whole loop without a phone. PartyPix is registered in the **debug**
  game list (`gamesListDebug.ts`), so it's dev-only until added to the server manifest + release list.
- Tests: `npm test`. Pure rules in `partyPixLogic.spec.ts`; image fit in `imageUtil.spec.ts`.

## Known limitations (tracked, non-blocking for the MVP)

- **Sybil / identity-churn farming.** `creditedVoters` keys on `playerId`. Rejoin-by-name restores a
  player's persisted `totalUp`/credits but assigns a **new** `playerId`, which isn't in an old
  photo's `creditedVoters` — so someone who deliberately disconnects/rejoins under the same name
  could re-credit the same photo (and inflate its `up` tally). Inherent to any identity-based abuse
  guard; fine for friends-at-a-party, worth revisiting only if PartyPix ships to untrusted rooms.
- **Rapid uploads can starve rotation.** Each upload jumps the show to the newest photo and resets
  the 6s timer, so at a busy party older photos may rarely display until uploads pause. Intentional
  "instant gratification" for the MVP; revisit ordering (see cut-lines) if it's a problem in play.

## Known cut-lines (deferred from the MVP)

Strict round-robin-by-author ordering (MVP shows newest-on-upload, then simple rotation), QR join
code, host start-gate + best-of montage, mini-leaderboard, animated transitions, most-upvoted
weighting, EXIF-orientation handling on captured photos, and cross-reload photo persistence. See
DESIGN.md §MVP cut-lines.
