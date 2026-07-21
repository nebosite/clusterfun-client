# FaceOff

A photo-booth mimicry battle for ClusterFun. See [DESIGN.md](DESIGN.md) for the full spec.

Each round every camera-capable player is paired with one rival onto a **shared secret
prompt** — a headshot, a meme, or a text scenario. One synced 3-2-1 countdown, everyone snaps
at the same instant (no retake). Then the room votes head-to-head on each pair — _who nailed
it best_ — and points rain down. Highest score after 5 rounds wins.

## How to play

1. Everyone joins the room on their phone. Devices with a camera are **contestants**; devices
   without one are **judges** (vote only).
2. **Capture:** your phone shows your secret prompt + a live camera and a 3-2-1 countdown on
   the big screen. At zero your phone snaps automatically — strike the pose in time! (On
   desktop / no camera, pick a photo file; it's committed at zero.)
3. **Vote:** the big screen collects everyone's shots. Your phone shows the matchups you're
   _not_ in as anonymous photo pairs — tap the better mimic.
4. **Reveal:** the big screen reveals each matchup's winner, the authors, and the points.
5. After 5 rounds, highest total score wins.

## Developing

- Registered in the **debug** game list (`gamesListDebug.ts`), so it's dev-only until it's
  added to the server manifest + moved to the release list.
- Test Lobby: `npm start`, pick **FaceOff**. On desktop the camera becomes a file picker so
  the whole loop is playable without a phone.
- Tests: `npm test`. Pure rules in `models/faceOffLogic.spec.ts`; presenter handlers +
  serializer round-trip in `models/PresenterModel.spec.ts`.
