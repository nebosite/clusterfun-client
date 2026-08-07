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
4. Your outline appears on the big screen in your color. Pick **Take a picture** (live
   camera) or **Upload a picture** (choose an existing photo).
5. Camera path: the zone shows your live camera, clipped to the shape. **Snap** a frame.
6. Frame it — drag to pan, pinch/➕➖ to zoom, twist/↺↻ to tilt — then **Use it**.
7. Your photo lands on the canvas and the zone frees up — go draw another one.

## Development notes

- Registered in the debug game list (`gamesListDebug.ts`); dev-only until added to the
  release list + server manifest.
- Test Lobby: **Upload a picture** works everywhere (file picker, no camera needed), so the
  whole loop is testable on a desktop without a camera. If you pick **Take a picture** with no
  camera present it falls back to a native-camera file pick.
- The collage itself is not checkpointed (images are too big for localStorage); a
  presenter refresh keeps the room but starts a blank canvas.
