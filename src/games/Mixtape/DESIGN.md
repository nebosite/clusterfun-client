# Mixtape — Design Spec (MVP)

> Designer's source-of-truth spec the implementation follows (PartyPix/CollageBoard style).
> Concept, player counts, presenter + client state machines, the message table, the IRV
> voting rules, the music-provider abstraction, and the v1 cut-lines.

A music-matching party game for ClusterFun. The **presenter** is the shared screen and the
jukebox: it reads a scenario prompt aloud, then plays each player's cued-up YouTube track out
loud for 30s. Players **search YouTube on their phones**, cue the song they think best fits the
scenario (with a chosen start timestamp), then **rank their top 3** favorites. Songs are tallied
with **instant-runoff voting**; the submitter of the winning song scores a point. First to a
host-set target wins.

## Core loop

`Prompt → Select (search + cue a track + set start time) → Playback (presenter plays each 30s
snippet, metadata hidden 5s then fades in, submitter always hidden) → Vote (rank top 3, IRV) →
Tally (suspenseful elimination animation, reveal winner THEN submitters, award a point) →
Scoreboard → next prompt.` Round-based. First player to the target score wins; the crossing
round finishes before the game ends.

## Players & teams

- **3–8 players**, free-for-all (no teams, no dedicated judge — everyone submits and votes).
  Min 3 so a vote has ≥2 rankable songs after excluding your own.
- The **presenter** is the shared screen / jukebox and is operated by the host (Skip, force-advance).
- **Mid-game join:** a new player is seated but only participates from the **next** round
  (can't submit into a round already past Select). **Drop:** score is retained; rejoin-by-name
  restores it (standard ClusterFun). A round proceeds with whoever is present.

## Music-provider abstraction (the key architectural decision)

Search and playback are behind interfaces so the game is verifiable headlessly and never hard-
depends on the network:

- `MusicProvider.search(query): Promise<Track[]>` where
  `Track = { videoId, title, artist, thumbnailUrl, durationSec }`.
  - **`RelayMusicProvider`** — `fetch` to the relay server's `/api/youtube_search` proxy
    (same origin). The server owns the YouTube Data API key and caches `search.list` results
    across all rooms, so the key is never in the client bundle and each term burns quota at
    most once. The server maps snippets → `Track[]`; the client renders them directly.
  - **`MockMusicProvider`** — filters a small in-memory catalog (~30 fake tracks) by query
    substring. Used when `REACT_APP_DEVMODE === "development"` (the dev Test Lobby, which has
    no relay server), so the whole loop runs offline.
  - Provider is chosen once at model init; `Track` is identical from both.
- `TrackPlayer` (presenter only) — `load(videoId, startSec)`, `play()`, `stop()`, tick callback.
  - **`YouTubeIFramePlayer`** — wraps the YouTube IFrame Player API (`YT.Player`), audible.
  - **`MockTrackPlayer`** — a silent timer that drives the same 30s timeline + a placeholder
    tile, so Test-Lobby verification exercises the playback/metadata timeline without audio.
  - The **5s metadata-hide** and **30s cap** are enforced by the presenter timeline regardless
    of which player backs it, so the feel is identical in dev and prod.

> Thumbnails are **YouTube URLs (strings)**, not base64 — so the PartyPix base64/localStorage
> trap does **not** apply here. Submissions (ids + short strings + startSec) are small and safe
> to serialize. What we must NOT serialize: transient **search-result caches** and the live
> `TrackPlayer`/IFrame objects (type-helper skip-list).

## Presenter state machine

`Gathering` (join screen; host sets target score N, default 5; needs ≥3 players to start) →

For each round:

1. `PromptReveal` — big scenario prompt shown + read aloud; host taps **Start selecting**.
2. `Selecting` — shows the prompt + a "**submitted: k / m**" roster (names + `PlayerAvatar`,
   check when done; song stays secret). Host **Start playback** enabled once all present players
   submit (or host force-advances; non-submitters simply have no song this round).
3. `Playback` — plays each submitted song in a shuffled order, 30s from its `startSec`:
   - 0–5s: **mystery tile** (equalizer / "Track 3 of 5", no metadata).
   - 5–30s: title, artist, thumbnail **fade in**. **Submitter never shown.**
   - Host **Skip** jumps to the next song; auto-advances at 30s. After the last → `Voting`.
4. `Voting` — songs listed numbered (title/artist/thumb, still no submitter) + "**voted: k / m**".
5. `Tally` — **IRV elimination animation** (see Rules): bars per song; each round the lowest is
   eliminated and its ballots visibly transfer, until a song has a majority. Reveal the winning
   song, **then reveal every song's submitter**, then **+1** to the winner's submitter (score sound).
6. `Scoreboard` — updated standings (avatars). If someone ≥ N → `GameOver`; else host taps
   **Next prompt** → `PromptReveal`.

`GameOver` — winner fanfare + a **playlist/links screen**: for each prompt, its songs as
shareable YouTube watch links (and a "search this prompt" link). (Real per-prompt playlists via
OAuth are deferred — see cut-lines.)

## Client (phone) state machine

Joins → `WaitingToStart`. Then mirrors the presenter phase (re-onboards on every InvalidateState):

- `Selecting` — **search box** → results list (thumb, title, artist) → pick one → a **start-time
  scrubber** (0…duration, default 0) → **Submit**. May re-pick/replace until the presenter locks
  the round. After submit: "submitted, waiting" (avatar + song title, editable).
- `Playback` — passive "listen to the big screen — now playing" card (nothing secret to show).
- `Voting` — the round's songs as a **rank-your-top-3** list: tap to place 1st/2nd/3rd (or a
  drag reorder). **Your own song is disabled** (can't self-vote). Submit ballot (≤3, ≥1). Editable
  until the presenter closes voting.
- `WaitingForResults` / `Scoreboard` — passive standings.
- `GameOver` — final standings + your submitted songs as links.

Phones render only input UI; the shared screen is the only place songs actually play.

## Message table

Search is **not** a relay message — the client hits the `MusicProvider` directly. Only two
game-specific client→presenter messages; everything else is the standard Onboard/Invalidate pattern.

| Endpoint (route)                                           | Dir     | Request → Response                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mixtapeOnboard`                                           | C→P req | `{}` → **full phone state**: `gameState`, `roundNumber`, `prompt`, `targetScore`, `scores[]` (id, name, avatarId, score), `mySubmission?`, `votingSongs[]` (id, title, artist, thumbnailUrl — only in Voting+), `myBallot?`, `winner?` (revealed submitters). Client rebuilds everything from this. |
| `mixtapeSubmitSong`                                        | C→P req | `{ videoId, title, artist, thumbnailUrl, durationSec, startSec }` → `{ accepted, reason? }`. Adds/replaces this player's submission (only during `Selecting`).                                                                                                                                      |
| `mixtapeSubmitBallot`                                      | C→P req | `{ ranking: string[] /* ordered videoIds, len 1..3, excludes own */ }` → `{ accepted, reason? }`. Only during `Voting`; validated (no self-vote, no dupes, known ids).                                                                                                                              |
| `InvalidateStateEndpoint`                                  | P→C f&f | (shared) presenter phase changed → every client calls `requestGameStateFromPresenter()`.                                                                                                                                                                                                            |
| Join / Quit / Ping / Pause / Resume / Terminate / GameOver | —       | shared `basicEndpoints`.                                                                                                                                                                                                                                                                            |

Payloads stay tiny (ids + short strings). No base64 anywhere.

## Rules & scoring (pure logic in `mixtapeLogic.ts` + spec)

**Submission:** one song per player per round; replacing overwrites. `startSec` clamped to
`[0, max(0, durationSec − 30)]` when known, else `≥ 0`.

**Ballot:** ordered list of up to 3 **distinct** videoIds from this round's songs, **excluding
the voter's own**. Invalid entries (unknown/own/dupes) are rejected.

**Instant-runoff tally** (produces the round winner):

1. Active ballots = submitted ballots with ≥1 non-exhausted choice. Count each ballot's
   highest non-eliminated song as its current first-choice.
2. If a song holds **> 50%** of current first-choices → **winner**.
3. Else eliminate the song(s) with the fewest first-choices and transfer each affected ballot to
   its next non-eliminated choice (ballots with none left become **exhausted** and drop out;
   majority is recomputed against remaining non-exhausted ballots). Repeat from step 2.
4. **Elimination tie:** if several songs tie for fewest, eliminate the one with the fewest
   next-rank mentions; still tied → the earliest-submitted song (deterministic, so the animation
   replays identically after a refresh).
5. **Final tie** (last songs equal, no majority reachable): **co-winners** — each submitter scores.
6. Zero ballots / zero songs → no point awarded; round still advances.

The winning song's **submitter(s) score +1**. Each IRV round is recorded as a step so the
presenter can animate eliminations and ballot transfers suspensefully.

**Win condition:** first player to reach **N** (host-set, default 5). Checked at `Scoreboard`;
the crossing round completes, then `GameOver`. Ties at/over N in the same round → shared win.

## Content & assets

- **Prompt bank:** a built-in curated list (~40 scenario prompts, e.g. _"Best song for a road
  trip at 2am"_), shuffled per game, no repeats until exhausted. (Host-typed custom prompts
  deferred.)
- **Mock catalog:** ~30 fake tracks (varied fake titles/artists/durations, placeholder thumb)
  for `MockMusicProvider`.
- Logo + sounds start as template placeholders; wire real ones via `assets/Assets.ts` later
  (keep score + winner sounds; add a per-track "reveal" whoosh and an elimination "thunk").

## Visual (Late-Night Jukebox)

Dark stage, warm neon; a big equalizer / vinyl motif on the mystery tile. Metadata fades in with
a soft blur→sharp. IRV tally = horizontal bars that shrink and hand off ballots on elimination.
Presenter 1920×1080; phone 1080×1920. Respect reduced-motion (cut fades/anim to instant).

## v1 cut-lines

**In:** join + host target-score; built-in prompt bank; phone search (YouTube Data API, mock in
dev) → pick → start-time scrubber → submit; presenter jukebox (mystery tile → 5s metadata fade,
30s cap, host Skip, shuffled order, submitter hidden); rank-top-3 phone ballot (no self-vote);
IRV tally with elimination animation; submitter reveal at tally; scoreboard + first-to-N; GameOver
with per-prompt YouTube **links**; `PlayerAvatar` everywhere; save/restore across refresh (songs

- scores + ballots persist; search caches + player objects do not); reduced-motion.

**Deferred (later):** real per-prompt **YouTube playlists via Google OAuth** (v1 shows links
instead); server-side key proxy; host-typed custom prompts; Apple Music/Spotify providers; audio
crossfade; per-round "closest guess who-submitted-what" bonus; richer playback controls
(scrub/replay); teams; profanity/content moderation on search.
