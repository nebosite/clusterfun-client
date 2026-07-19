# CollageBoard

A communal photo-collage party game. The big screen shows one shared 16:9 canvas. On your
phone you pan and zoom around that canvas, draw an outline around any region, and the shape
becomes a live viewport for your camera. Snap a picture and it is painted into the collage,
clipped to your outline. The whole canvas is free game — paint over anything.

See [DESIGN.md](DESIGN.md) for the full spec.

## How to play

1. The host opens CollageBoard on the shared screen and players join with the room code.
2. Host taps **Start collaging** (one player is enough).
3. On your phone: **Move** to pan/zoom, **Draw** to outline a zone, then **Claim zone**.
4. Your outline appears on the big screen in your color while you line up the shot.
5. The zone shows your live camera, clipped to the shape. **Snap**, then **Use it**.
6. Your photo lands on the canvas and the zone frees up — go draw another one.

## Development notes

- Registered in the debug game list (`gamesListDebug.ts`); dev-only until added to the
  release list + server manifest.
- Test Lobby: on a desktop without a camera the camera screen falls back to a file picker,
  so the whole loop is testable without a phone.
- The collage itself is not checkpointed (images are too big for localStorage); a
  presenter refresh keeps the room but starts a blank canvas.
