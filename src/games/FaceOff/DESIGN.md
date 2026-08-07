# FaceOff — Design Spec (MVP)

> Designer's source-of-truth spec the implementation follows. See
> [CLAUDE.md](CLAUDE.md) for how the code maps to it and which cut-lines were taken.
> Closest shipped cousin is **PartyPix** (camera → downscaled base64 over the relay,
> images never serialized, file-pick fallback for headless/desktop).

A photo-booth mimicry battle for ClusterFun. Each round, every camera-capable player is
paired with one rival onto a **shared secret prompt** — a headshot, a meme, or a text
scenario ("The face you make when you bite into a soggy corn chip"). One synced 3-2-1
countdown, **everyone snaps at the same instant** (photo-booth style, no retake). Then the
room votes head-to-head on each pair — _who nailed it best_ — and points rain down. Highest
score after 5 rounds wins.

## Core loop

`Pair up on prompts → all contestants frame live → presenter counts 3-2-1 → auto-snap at
zero → room votes each matchup (not your own) → reveal winners on the big screen → score →
next round.` Turn-structured (fixed rounds), but **capture is simultaneous** so nobody sits
idle: you shoot your matchup, then judge the ones you're not in.

## The pivot (why it beats the raw pitch)

The naive "some mimic, rest watch" leaves voters idle during capture. Instead **everyone with
a camera is a contestant every round**, split into head-to-head matchups by prompt (P1+P2 →
prompt A, P3+P4 → prompt B, …). Everyone captures at once under one countdown; during voting
you judge every matchup **except** the one you're in. No idle players.

## Players

- **4+** players (need ≥2 matchups so every matchup has an outside voter). Max 12.
- **Contestants** = players whose device reports a camera. **Non-camera players vote only**
  (never assigned a prompt). Camera capability is reported to the presenter on onboard.
- Join mid-game → folded in from the **next** round. Drop → their matchup still resolves
  (walkover / remaining entrant); rejoin-by-name restores cumulative score.
- Edge: fewer than 2 camera-capable players → the presenter can't form a matchup and shows a
  "need at least 2 players with cameras" gate.

## Round shape / phases

1. **Pairing** (internal) — shuffle contestants into matchups (groups of 2; one group of 3 if
   the contestant count is odd). Assign each matchup a distinct prompt not used this game
   until the bank is exhausted.
2. **Capturing** — each contestant's **phone** privately shows _their_ prompt + live camera +
   a countdown mirrored from the presenter. The **big screen** shows only "STRIKE YOUR POSE"
   - 3-2-1 (prompts stay secret — they differ per matchup). At zero the **presenter** pushes
     `SnapNow`; every contestant phone grabs the current frame, downscales, and uploads. No
     retake. Presenter collects photos until all are in or a short grace timeout, then → Voting.
3. **Voting** — all matchups open **simultaneously**. Each phone shows the matchups it is
   eligible to vote on (all except ones it is a contestant in) as **anonymized** photo pairs →
   tap the better mimic. One vote per matchup, cannot vote your own. Timer bounds the phase.
4. **Revealing** — big screen reveals matchups **one at a time**: the prompt + both photos +
   the winner + authors (avatars) + a score sound.
5. **RoundScoreboard** — cumulative standings with avatars → next round. After round 5 →
   `GameOver` winner fanfare.

## State machines

- **Presenter:** `Gathering` (join screen + host "Start" gate) → **`Capturing`**
  (countdown + collect) → **`Voting`** (parallel) → **`Revealing`** (cycles `revealIndex`
  through matchups) → **`RoundScoreboard`** → loop to `Capturing` → … → `GameOver`.
- **Client:** `WaitingToStart` → **`Capturing`** (contestant: camera + prompt + auto-snap →
  "submitted, sit tight"; non-contestant: "get ready to judge") → **`Voting`** (vote eligible
  matchups → "waiting for reveal") → **`Revealing` / `Scoreboard`** ("watch the big screen" +
  standings). Phones render input UI only, never the game.

## Message table

| Endpoint                                       | Dir     | Request → Response                                                                                                                                                          |
| ---------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FaceOffOnboardEndpoint`                       | C→P req | `{hasCamera}` → `{state, round, totalRounds, role, myPrompt?, submitted, votableMatchups[], myVote{matchupId:entryId}, standings[], countdownMsLeft?}` — full phone rebuild |
| `FaceOffSubmitPhotoEndpoint`                   | C→P req | `{roundId, full, thumb}` → `{accepted, error?}` — contestant sends the captured frame                                                                                       |
| `FaceOffVoteEndpoint`                          | C→P req | `{matchupId, entryId}` → `{accepted, error?}` — vote by **opaque entryId** (keeps voting anonymous)                                                                         |
| `FaceOffSnapNowEndpoint`                       | P→C f&f | `{roundId}` → contestant phones capture the current frame + upload                                                                                                          |
| `InvalidateStateEndpoint`                      | P→C f&f | (shared) phase change → every client re-onboards                                                                                                                            |
| Join/Quit/Ping/GameOver/Pause/Resume/Terminate | shared  | base framework endpoints                                                                                                                                                    |

`VotableMatchup` (in onboard): `{matchupId, prompt:{kind,text?,src?}, entries:[{entryId, thumb}]}`
— **no authorId/avatar until reveal** so votes are on merit. The full-resolution photo never
leaves the presenter; phones receive only thumbs.

## Rules & scoring (v1)

- Within a matchup, each eligible voter picks one entry. The entry with the most votes wins
  (ties → all top entries marked winners; each still earns its vote points).
- Contestant score for a matchup: `votes × POINTS_PER_VOTE` (100) plus `WIN_BONUS` (200) if
  they won the matchup. Cumulative across rounds.
- Voters earn nothing in v1 (majority/bandwagon bonus is a cut-line).
- Cannot vote your own matchup; one vote per matchup (re-tap switches the choice while voting
  is open). All scoring/pairing/prompt-selection lives in pure `faceOffLogic.ts` with specs.

## Transport & persistence

- Phone downscales the captured frame to a **full** JPEG (long edge ≤ 1200, quality stepped
  toward a byte budget) + a small **thumb** (≤ 256), base64 over the relay — PartyPix's
  `imageUtil`. Presenter holds fulls in memory for the big-screen reveal; only thumbs are
  pushed to phones for voting.
- **Full images are never serialized** to the checkpoint (localStorage quota) — listed in the
  presenter type helper's `shouldStringify` skip-list, covered by a round-trip spec.
  **Cumulative player scores survive** a refresh. A mid-round **presenter** refresh loses the
  in-flight round's photos → the round restarts (PartyPix's disk-folder persistence deferred).
- `FaceOffPlayer` subclass calls `makeObservable(this)` in its constructor (per-player
  `score`/`role`/`submitted`/`hasCamera` are read by the presenter UI; the base
  `ClusterFunPlayer` never calls it, so without this those fields are inert in MobX 6).

## Camera gating vs. testability (explicit reconciliation)

Production: contestant eligibility requires a working camera; no-camera devices vote only. The
repo also **requires** a file-pick fallback or the game can't be verified headless in the Test
Lobby (and desktop players can't play). Resolution: the capture component uses the live camera
where present (auto-snap the live frame on `SnapNow`); where there is no live stream it exposes
a `<input type="file" accept="image/*" capture="environment">` whose selected image is the
frame committed at zero. A device with either a live camera **or** a staged file reports
`hasCamera = true` and is contestant-eligible. This keeps the design camera-gated while
remaining playable on desktop and drivable by the headless verifier; a hardened build can
restrict eligibility to real live cameras only.

## Prompt bank (v1)

Bundled **safe** pack in `models/prompts.ts`: ~12 text scenarios + a handful of royalty-free
expressive faces + open memes under `assets/prompts/`. **No celebrities shipped.** Distinct
prompt per matchup; no repeats within a game until the bank is exhausted.

## Visual (Spotlight Studio)

Dark stage, a warm spotlight pool, big film-strip / photo-booth framing, oversized countdown
numerals. Winner reveal pops the victor's photo forward. Avatars beside every player name
(join list, scoreboards, reveal authors, winner, phone header). Reduced-motion respected.

## MVP cut-lines

**In:** join + roster + avatars + host start gate; camera detection → contestant eligibility
(no-camera = voter); 5-round loop; matchup pairing with distinct prompts (pairs, one 3-way if
odd); per-phone secret prompt; presenter countdown + presenter-triggered auto-snap at zero (no
retake) with file-pick fallback; downscaled base64 upload; parallel anonymous voting (one per
matchup, no self-vote); matchup-by-matchup big-screen reveal with authors + score sound;
contestant scoring (votes + win bonus); cumulative scoreboard; winner fanfare; bundled safe
prompt pack; checkpoint (scores survive, images excluded); Spotlight Studio styling;
reduced-motion.

**Deferred (later):** celebrity / pop-culture / host-added / URL prompt packs + categories;
voter (bandwagon) scoring; retake / multiple shots / filters; mid-round presenter-refresh
photo persistence (PartyPix disk folder); QR join code; animated transitions; best-of montage
/ per-round MVP callouts; configurable group size + team modes; EXIF-orientation handling;
photo moderation/flagging.
