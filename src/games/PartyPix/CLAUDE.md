# PartyPix — architecture notes

A ClusterFun game (presenter + client on one shared module). Read [DESIGN.md](DESIGN.md) first for
the product flow, economy, and visual spec; this file is how the code implements it. Built from the
template now called `TemplateGame`.

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
phone produces a **full** JPEG (long edge ≤ `MAX_IMAGE_EDGE`, default 1600) for the slideshow and a
small **thumb** (≤ 256) for phones, and sends both via `PartyPixUploadEndpoint`. The full image
keeps its resolution and **trades JPEG quality to hit a byte budget** (`imageUtil
.scaleImageToJpegUnderSize`): quality starts at `JPEG_QUALITY_START` and steps down toward
`TARGET_IMAGE_BYTES` (~100 KB), never below `JPEG_QUALITY_MIN` (0.30). The full image never leaves
the presenter; only the thumb is pushed to phones (`PartyPixSlideInfo.thumb`) for the "now showing"
strip. Keeps per-message and per-client traffic modest.

**Photos are never serialized to the checkpoint.** `saveCheckpoint()` persists to localStorage;
base64 images would blow the quota. The presenter type helper returns `shouldStringify(...) === false`
for `photos`, and the client excludes `currentSlide`/`myVotes`/`myFlags`. Players (credits/`totalUp`)
do persist. A refreshed client re-pulls everything via `requestGameStateFromPresenter` (onboard).

**Photos persist on disk (optional folder).** The presenter can save photos to a folder the host
picks, so the slideshow survives a refresh and returns between sessions. This is separate from the
checkpoint:

- `models/photoStoreLogic.ts` — PURE rules: which files count as photos, the `partypix-<t>-<n>.jpg`
  naming, and the sidecar index (`partypix-index.json`: uploaded files → author/createdAt, plus a
  `hidden` list). Unit-tested.
- `models/PhotoStore.ts` — browser glue over the **File System Access API** (`showDirectoryPicker`)
  - **IndexedDB** (remembers the directory handle). Chromium-only; `isSupported()` gates it and the
    game falls back to in-memory elsewhere. Also generates phone thumbnails from loaded images
    (canvas, via `imageUtil.scaleImageToJpeg`).
- Flow: `reconstitute()` calls `initPhotoStore()` → `PhotoStore.restore()` reads the remembered
  handle and `queryPermission()` (no prompt). `granted` (same-session refresh) → load silently;
  `prompt`/`denied` (new session after a browser restart) → `folderStatus = "needsReconnect"`, the
  join screen shows a one-click **Reconnect** button (`requestPermission` needs a gesture); no handle
  → the join screen shows **Choose a folder** + an "include existing photos?" checkbox
  (`showDirectoryPicker`, also gesture). So a mid-session refresh never re-asks; a new session is one
  click and never re-picks the folder.
- **Folder preview:** after `chooseFolder` picks a folder it does NOT start the show — it sets
  `folderPreviewOpen` and loads `folderPreview` (thumbnails of up to 24 image files on disk, via
  `PhotoStore.listImageThumbs`, with the total count). The join card shows those thumbnails, a
  re-toggleable "include these" checkbox (`setIncludeExisting` re-persists), and a **Start slideshow**
  button (`startFromFolder` → `loadPhotosFromDisk`). `reconnectFolder`/`restore` skip the preview and
  resume directly. `folderPreview*` are excluded from serialization.
- On upload, `handleUpload` writes the full JPEG to the folder off the response path and records the
  file name on the `PartyPixPhoto`. On load, `loadPhotosFromDisk` rebuilds `photos` from the folder
  (uploaded files keep their author from the index; pre-existing images appear only if "include
  existing" was chosen, with no author). Disk-loaded photos have `authorId = ""`, so nobody is
  credited for votes on them and `youAuthored` is false for everyone.
- **Safety:** removal only ever DELETES files PartyPix created (`managed`); flagging a pre-existing
  folder image just adds it to the sidecar `hidden` list — a user's own photos are never destroyed.

**Messaging.** Client→presenter requests: `Onboard` (pull full state on join/reconnect/invalidate),
`Upload` (echoes authoritative credits), `Vote` (`up`/`down`/`delete`, echoes tally). Presenter→
clients fire-and-forget pushes: `SlidePush` (current slide changed — sent to everyone, `youAuthored`
filled per recipient) and `CreditsPush` (a player's credit standing moved — broadcast so each phone
reads its own; there is no single-player send in the base class). The presenter is authoritative;
clients update optimistically and reconcile on the echo/push.

**Credits.** `totalUp` is monotonic lifetime upvotes; a bonus credit is granted as it crosses each
`CREDIT_UPVOTE_MILESTONES` value — **2, 5, then 20** upvotes (three bonus credits total; none after
20), capped at `CREDIT_CAP` (9). Retracting or switching a vote never reduces `totalUp` (stay
positive). You can't vote your own photo; one up/down and one flag per player per photo; re-tapping a
direction toggles it off. **Anti-farming:** each voter can move a photo's author toward a credit
**at most once** — `applyVote` tracks a per-photo `creditedVoters` set and only the first upvote from
a given voter returns `countsForCredit`, so an accomplice can't mint credits by toggling one upvote.
So `totalUp` counts _distinct_ approvers, i.e. breadth. The phone shows credits (and "next credit in
N upvotes") **persistently on every tab**, including while voting.

**Flagging & moderation.** A flag pulls a photo **out of rotation on the first flag** (or the
`FLAG_THRESHOLD_APPROVED`th once the host has OK'd it) into `flaggedPhotos` — a holding list kept for
review, not deleted. The presenter's **"Flagged: N"** control opens a review of each held photo with
the names of everyone who flagged it, and two actions: **OK** (`moderateOk` — returns it to rotation
and marks it `approved`, so it now needs 3 flags to be pulled again) and **Ban** (`moderateBan` —
removes it everywhere, deletes its file, and adds its content hash to `bannedHashes`). `handleUpload`
rejects any upload whose `imageHash(full)` is banned, so a banned photo can't be re-uploaded. The
presenter's **Thumbnails** control shows every active photo; tapping one calls `jumpToPhoto` to
resume the slideshow from it. `flaggedPhotos`/`bannedHashes` are excluded from serialization
alongside `photos`.

**MobX.** Photo vote membership is plain `Set`s (for enforcement, consumed by the pure `applyVote`)
with mirrored `@observable` counts (`up`/`down`/`deleteCount`) updated via `syncCounts()` so the
presenter's live tally re-renders. All model mutations run inside `action(() => …)()`.

## The phone is ONE screen

Taking part on top, what is on the big screen below. It used to be two tabs, and whichever
one you were looking at hid the other — a player on Capture never saw the photo they were
meant to be voting on, and a player on Vote had to go looking for the shutter.

**Two file inputs, not one.** `capture` is not a flag you can flip at click time; the
attribute has to be on the element when it is activated. One input with `capture="environment"`
is what shipped, which on a phone forces the camera and offers no album at all — and on a
desktop the attribute is ignored, which is why it looked fine in the Test Lobby. There are now
two hidden inputs behind two buttons, **Take a Photo** and **Upload a photo**.

**The phone re-syncs when it comes back to the foreground.** Taking a photo hands the whole
screen to another app: the browser is suspended, sockets close, pushes are missed, and on a
memory-tight device the page can be discarded. PartyPix is the game in the set that routinely
sends a player away and expects them back, so its client listens for `visibilitychange` and
re-onboards rather than trusting what it was holding when it went away.

**One text size.** `--pp-text` on `.gameclient`, taken from the shutter button, which was the
only thing on the phone already set large enough to read at arm's length. The wordmark is a
quarter larger and the version a quarter smaller; nothing else sets a size of its own.

**Flagging is two steps.** The flag sits in the photo's own upper-right corner, in red, where a
thumb reaches it — which is exactly where a mis-tap lands too, and the first flag pulls a photo
out of rotation for everybody. So the button only STAGES it: nothing reaches the presenter until
the player confirms in the list at the bottom (**Yes, Flag** / **Whoops, No**). `pendingFlags`
is local, never sent and never checkpointed.

## Notices — moments, not numbers

`PartyPixNoticeEndpoint` (presenter → one player, via `sendToPlayer`) covers three things that
HAPPEN rather than three numbers that change: **your photo was flagged**, **your first upvote**,
and **the whole room upvoted one of yours** (`up === players.length - 1`, since an author cannot
vote on their own). Every one of them explains the credit economy, because "why can I not take
another photo" is the question the game otherwise never answers out loud.

## The photo folder is not optional any more

The setup screen will not hand over to the slideshow until `folderDecided` — the host has
picked a folder, or the browser has no File System Access API at all (`"unsupported"`, where
there is nothing to pick and blocking would be careless rather than careful). Photos live in
that folder: start without one and the party's pictures exist only in the presenter tab, and
the first refresh takes them all.

## State machine

- Presenter: `Gathering` (join screen / 0 photos) → `Slideshow` on first upload → back to
  `Gathering` if all photos are removed. `minPlayers = 1`; no host "start" gate — the first photo
  starts the show. Players may join during `Gathering` and `Slideshow`.
- Client: joins → `Playing` (base `Gathering`/`Slideshow` both map here), with `viewMode`
  `capture` | `vote`. Out-of-credits is the Capture view with the action disabled.

## Running / testing

- Dev Test Lobby: `npm start` → pick **PartyPix**. On desktop the camera input becomes a file
  picker, so you can test the whole loop without a phone. **PartyPix ships** — it is in
  `gamesListRelease.ts` and in the server manifest. (Note the manifest tags it `"alpha"` while
  the client tags it with nothing, and the server's tags win in production.)
- Tests: `npm test`. Pure rules in `partyPixLogic.spec.ts`; image fit in `imageUtil.spec.ts`.

## Known limitations (tracked, non-blocking for the MVP)

- ~~**Reconnect mis-attributes photos**~~ — **fixed.** `photo.authorId` is a stored `playerId`,
  and player ids are permanent now, so authorship, credits and `youAuthored` all survive a
  phone going to sleep and coming back. See the lifecycle contract in
  [../../../CLAUDE.md](../../../CLAUDE.md).
- **`photos` is unbounded.** Each `PartyPixPhoto` holds a ~133 KB base64 `full` plus a thumb,
  `flaggedPhotos` retains removed ones, and nothing evicts. At `maxPlayers = 50`, an ordinary
  hour (~150 photos) is ~20 MB of strings on the presenter plus decoded bitmaps. Correctly
  excluded from the checkpoint, but not from memory.
- **`SlidePush` is O(N²) on the wire.** A ~10 KB per-recipient thumb goes to every player on
  every slide change, every 6 s. At 20 players that is ~200 KB per 6 s each way through the Pi,
  sustained.
- **Moderation state is session-only.** `flaggedPhotos`, `approved`, and `bannedHashes` are not
  persisted. With a disk folder connected, a **flagged photo can reappear in rotation after a
  presenter refresh**: `pullToFlagged` doesn't hide its file, so `loadPhotosFromDisk` reloads it into
  the active show (un-flagged, and the review queue is empty). A **Ban** _is_ durable (its file is
  deleted). Mitigation for now: review flagged photos before refreshing. A fix would hide the pulled
  file in the sidecar (and persist/rebuild the flagged queue). Banned-hash blocking is also
  session-scoped — but a banned file is deleted, so it won't reload; only an exact-byte re-upload
  after a full restart could get back in.
- **Sybil / identity-churn farming.** `creditedVoters` keys on `playerId`. Rejoin-by-name restores a
  player's persisted `totalUp`/credits but assigns a **new** `playerId`, which isn't in an old
  photo's `creditedVoters` — so someone who deliberately disconnects/rejoins under the same name
  could re-credit the same photo (and inflate its `up` tally). Inherent to any identity-based abuse
  guard; fine for friends-at-a-party, worth revisiting only if PartyPix ships to untrusted rooms.
- **Rapid uploads can starve rotation.** Each upload jumps the show to the newest photo and resets
  the 6s timer, so at a busy party older photos may rarely display until uploads pause. Intentional
  "instant gratification" for the MVP; revisit ordering (see cut-lines) if it's a problem in play.
- **Reconnecting a folder mid-show is a visible reset.** `loadPhotosFromDisk` rebuilds the array
  and sets `currentIndex = 0` (the slideshow snaps back to photo 1), and reloaded photos get
  `authorId = ""` (author names survive via the sidecar, but the original author loses `youAuthored`
  / future-credit on those photos). A host should ideally connect the folder on the join screen
  before the party starts.
- **Very narrow load-race.** An upload landing during the async `loadPhotosFromDisk` enumeration can
  be dropped from the live array by the following `clear()`; its file still persists and reappears
  on the next load (no data loss). Gated to gesture/startup moments — unlikely in practice.

## Known cut-lines (deferred from the MVP)

Strict round-robin-by-author ordering (MVP shows newest-on-upload, then simple rotation), QR join
code, host start-gate + best-of montage, mini-leaderboard, animated transitions, most-upvoted
weighting, and EXIF-orientation handling on captured photos. See DESIGN.md §MVP cut-lines.
(Cross-reload photo persistence is now **implemented** via the optional on-disk folder above; vote
tallies are still session-only.)
