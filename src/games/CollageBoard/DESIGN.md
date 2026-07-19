# CollageBoard — Design Spec (MVP)

> The designer's source-of-truth spec the implementation follows. See [README.md](README.md)
> for how to play.

A communal photo-collage game for ClusterFun. The presenter shows one shared 16:9 canvas on
the big screen. Every player, on their phone, pans and zooms around that canvas, draws an
outline around any region they want to fill, and that shape becomes a live viewport for
their camera. Snap a picture and it is painted into the canvas, clipped to the outline.
Repeat forever — the collage grows and mutates as the party plays.

## Core loop

`Join → pan/zoom the board → draw an outline → outline becomes a live camera viewport →
snap → photo lands on the big canvas clipped to the shape → zone released → draw again.`
Continuous / arcade, never turn-based. Join at any moment.

## Rules

- **The whole canvas is free game.** Players may draw zones anywhere, including over
  existing pictures; newer photos paint over older ones.
- **Claims are advisory, not exclusive.** While a player has a zone selected, its outline
  shows on the big screen in that player's color so everyone knows it's being edited —
  but claims never block other players from overlapping zones.
- **One active zone per player.** Claiming a new zone releases the old one.
- **Abandoned claims expire** after `ZONE_LIFETIME_MS` (2 min) so a pocketed phone can't
  leave a ghost outline forever.
- **Player colors.** Each player is assigned a unique color from a fixed palette on join
  (least-used first). The color shows in the phone's banner and is used for that player's
  zone outlines on both screens. `maxPlayers` equals the palette size so colors stay unique.
- No scoring, no rounds, no winner. The game ends when the host quits (or pauses).

## State machine

- **Presenter:** `Gathering` (join screen) → host taps Start → `Playing` forever
  (`timeOfStageEnd` = ∞). Players may join during both states.
- **Client:** joins → `Playing`, with a local `mode`: `navigate` (pan/zoom/draw) ↔
  `camera` (a granted claim opens the live clipped camera; commit/cancel/expiry returns to
  `navigate`).

## Coordinates & geometry

- Board coordinates are normalized `0..1 × 0..1` mapped onto a 16:9 surface. All wire
  messages use board coordinates.
- Outlines are freehand polygons, clamped to the board, deduped and simplified
  (Ramer–Douglas–Peucker) to ≤ `MAX_ZONE_POINTS` points, and rejected under a minimum
  area (`MIN_ZONE_AREA`) — both on the phone (UX) and again on the presenter (authority).
- A committed photo travels as a JPEG of the zone's **bounding box** (camera frame
  cover-cropped to the bbox aspect); the presenter clips it to the polygon when painting.
  JPEG quality steps down toward `PATCH_TARGET_BYTES` (~120 KB), as in PartyPix.

## Messages (all routes under `/games/collageboard/`)

| Endpoint               | Direction         | Kind        | Payload                                               |
| ---------------------- | ----------------- | ----------- | ----------------------------------------------------- |
| `lifecycle/onboard`    | client→presenter  | request     | → `{ state, playerColor, preview, zones[] }`          |
| `actions/claim-zone`   | client→presenter  | request     | `{ points[] }` → `{ granted, zoneId?, reason? }`      |
| `actions/release-zone` | client→presenter  | fire-forget | `{ zoneId }`                                          |
| `actions/commit-photo` | client→presenter  | request     | `{ zoneId, image }` → `{ ok, reason? }`               |
| `push/zones`           | presenter→clients | fire-forget | `{ zones[] }` (zoneId, playerId, name, color, points) |
| `push/preview`         | presenter→clients | fire-forget | `{ preview }` (small composite JPEG)                  |

**Client board preview:** phones navigate over a downscaled composite of the collage
(`PREVIEW_WIDTH×PREVIEW_HEIGHT` JPEG) that the presenter re-renders after each commit and
pushes at most every `PREVIEW_PUSH_MIN_INTERVAL_MS`. One bounded-size image regardless of
how many photos exist — patch images themselves never fan out to phones.

## Big screen (presenter)

- `Gathering`: title, room code + join URL, joined players (avatar + name + color chip),
  Start button (min 1 player).
- `Playing`: the 16:9 collage canvas — photos painted in commit order, clipped to their
  polygons — with every active zone outlined (dashed) in its owner's color plus the owner's
  name. A slim strip shows players (avatar + color) and the room code so latecomers can join.
- Sounds: player joined, zone claimed, photo committed.

## Phone (client)

- Banner tinted with the player's assigned color (avatar + name + quit).
- `navigate`: the board preview with active-zone outlines. Tools: **Move** (drag pans,
  pinch/buttons zoom) and **Draw** (drag draws an outline; lifting closes it → Claim /
  Clear). Claim errors surface inline.
- `camera`: the claimed shape becomes a live camera viewport — `getUserMedia` video
  cover-fills the zone's bounding box, CSS-clipped to the polygon, outlined in the player's
  color. **Snap** freezes a frame for confirm (**Use it / Retake / Cancel**); Use it
  commits. If the camera is unavailable (desktop dev, denied permission), a file-pick
  fallback (`capture="environment"`) feeds the same confirm flow. Cancel releases the zone.

## MVP cut-lines (deferred)

- Collage persistence: patches are **not** checkpointed (base64 would blow localStorage
  quota — PartyPix precedent). A presenter refresh keeps the room and players but clears
  the artwork. Later: flatten to IndexedDB / disk folder like PartyPix's PhotoStore.
- Exclusive (blocking) claims, per-zone undo/history, moderation/flagging, EXIF rotation
  fixes, front/back camera toggle, save-collage-to-file button, QR join code.
