# Background music

Music is **not in git**, and it is **not on a third-party service**. Tracks sit in
`clusterfun-server/hosted_content/music`, ship with the deploy, and are served by the relay at
`/music`. Adding a song is one step: put the file in the folder.

Only the EITtris presenter (the shared screen) plays music today. Phones stay silent.

## Where things are

| Thing          | Value                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| Folder         | `clusterfun-server/hosted_content/music` (`CLUSTERFUN_MUSIC_PATH` overrides) |
| On the Pi      | `~/deploy/hosted_content/music`, put there by the deploy                     |
| Served at      | `/music` — same origin as the app, so there is no CORS to set up             |
| Manifest       | `/music/music.json` — **generated** from the folder, not a file              |
| Client env var | `REACT_APP_MUSIC_BASE_URL=/music` (in `.env.dev` and `.env.local`)           |
| Browser cache  | Cache API, `clusterfun-music-v1`                                             |

**The audio is gitignored, the folder is not.** `conan.json` copies `hosted_content` into every
deploy, so the folder has to exist in a fresh clone — that is what `hosted_content/music/.gitkeep`
is for. The music itself is large and is not source, so it stays out of git and travels with the
deploy instead.

> **Deploys carry the music.** Roughly 40MB of songs is 40MB in every deploy tarball. That is
> the trade for having no second place to manage and no separate upload step. If deploys ever
> get too slow, point `CLUSTERFUN_MUSIC_PATH` at a folder outside the deploy on the Pi and copy
> music there by hand instead — nothing else changes.

Leave `REACT_APP_MUSIC_BASE_URL` **unset** for a build that should have no music. The code
treats an unset base URL as "music is off": it never calls the network, logs nothing, and the
game is exactly as it was.

> **Which builds get it.** Create React App auto-loads `.env.local` on top of everything, in
> production builds as well as dev. So the variable being in `.env.local` means `npm run build`
> — and therefore the deploy — bakes it in, even though `.env.production` never mentions it.
> That is intended. It also means turning music off locally takes commenting it out in **both**
> `.env.dev` and `.env.local`; `.env.dev` alone is not enough.

## Adding music

Put an audio file in `clusterfun-server/hosted_content/music`. That is the whole procedure.

```bash
cp "Bill G Force.m4a" clusterfun-server/hosted_content/music/
```

The manifest at `/music/music.json` is generated from whatever is in the folder each time it is
requested, so there is nothing to edit and nothing that can drift out of step with the files.
The next presenter to start picks the new song up; no restart, no rebuild. Deploy when you want
it on the Pi.

- **Filenames are titles.** `CHIPPY Volume 1.m4a` shows up as "CHIPPY Volume 1" on the host
  screen. Spaces and punctuation are fine — the URL is encoded for you.
- **Recognised extensions:** `.m4a`, `.mp3`, `.ogg`, `.oga`, `.opus`, `.wav`, `.aac`. Anything
  else in the folder is ignored, so a stray `.txt` or cover image does no harm.
- **Replacing a song** means overwriting the file. The server hashes contents, and the hash
  rides in the track URL as `?v=`, so a changed file is a new URL and every browser picks it up.
  A game already playing is unaffected — it holds the bytes it started with.
- **Removing a song** means deleting the file. Its cached bytes are swept from browsers on the
  next manifest load.

Cache headers are the server's job: `music.json` is `no-cache`, everything else is
`immutable, max-age=1y`. That pairing is unit-tested in `clusterfun-server`.

### Locally

`npm run startdev` reads `env.dev`, which points `CLUSTERFUN_MUSIC_PATH` at the repo folder, so
music works out of the box. In the **Test Lobby** (`npm start`, port 3000) the music path is
relative and goes through CRA's dev proxy to the relay on 8080 — so start the relay too if you
want to hear anything. With no relay running the fetch fails, one warning is logged, and the
game is silent.

## Encoding a track

AAC-LC in an `.m4a` container. It plays natively in every browser on every OS, including
Safari — which matters because presenters run on Macs. Opus is ~25-30% smaller but its
container support on Safari is version-dependent, and the failure mode is a silent presenter
on one platform while everything else works. Not worth a few megabytes.

```bash
# Preferred, if your ffmpeg has libfdk_aac (true VBR, better quality per bit)
ffmpeg -i master.wav \
  -af "loudnorm=I=-20:TP=-1.5:LRA=11" \
  -c:a libfdk_aac -vbr 4 -ar 44100 -ac 2 \
  -movflags +faststart \
  track01.m4a

# Portable fallback - ffmpeg's built-in AAC encoder, available everywhere
ffmpeg -i master.wav \
  -af "loudnorm=I=-20:TP=-1.5:LRA=11" \
  -c:a aac -b:a 128k -ar 44100 -ac 2 \
  -movflags +faststart \
  track01.m4a
```

- `loudnorm=I=-20` normalizes to −20 LUFS. Game sound effects are mastered far louder; without
  this, music either buries them or every track needs its own hand-tuned volume. Normalizing
  at encode time means the single volume constant in the code works for every track.
- `TP=-1.5` leaves true-peak headroom so lossy encoding does not clip.
- `-movflags +faststart` puts the moov atom first so playback can start before the download
  finishes.
- Stereo at 44.1 kHz. Do not downmix to mono — it is background music.

Expect roughly 2-3 MB for a 3-minute track. Trim silence off the head and tail of anything
meant to loop: `<audio loop>` has an audible seam and leading silence makes it worse.

## The generated manifest

`GET /music/music.json` is built by `MusicCatalog` in `clusterfun-server`, from the folder:

```json
{
  "schema": 1,
  "version": "7-77ea5feb",
  "tracks": [
    {
      "id": "bill-g-force",
      "file": "Bill G Force.m4a",
      "title": "Bill G Force",
      "hash": "cca32bdbab9c",
      "bytes": 6017717
    }
  ]
}
```

- `id` — a URL-safe slug of the filename. Stable as long as the file keeps its name.
- `hash` — the first 12 hex of the file's SHA-256, computed once and remembered against the
  file's size and mtime. The client puts it in the track URL as `?v=`, which is what lets the
  audio be cached forever and still be replaceable.
- `version` — derived from all the hashes, so it changes when — and only when — the music does.
  Logged by the client, so "which music is this presenter running?" has an answer.
- `bytes` — informational.

A missing folder is not an error: the manifest comes back with no tracks, and a game with no
tracks is simply a quiet game. Music never breaks a game.

## Volume, and skipping a song

The host screen has a bar along the bottom, in every game state:

- **Sound FX** — master volume for every game sound, applied live through a single Web Audio
  gain node, so it moves sounds that are already ringing out.
- **Music** — the background track's volume, live.
- **Next song ⏭** — straight to the next song in the list, no fade.

Both levels are remembered in `localStorage` (`clusterfun_volumes`), because reloading the
presenter is normal in ClusterFun — the game resumes from its checkpoint, and the room's volume
should come back with it. They are a property of the machine the shared screen runs on, so they
deliberately never go into a game checkpoint.

A song is chosen at random when a game starts and repeats until the game ends.

## Troubleshooting

| Symptom                                    | Likely cause                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Silent, no console warning at all          | `REACT_APP_MUSIC_BASE_URL` was unset in that build. Grep the bundle for it.                      |
| `MusicLibrary: could not load manifest`    | The relay is not answering `/music/music.json` at all. Curl it.                                  |
| Silent in the Test Lobby only              | The relay on 8080 is not running, so CRA has nothing to proxy `/music` to.                       |
| Plays on Chrome, silent on Safari          | Format. Confirm the file is AAC in `.m4a`, not Opus.                                             |
| Music does not start until the second game | Autoplay blocking. It starts on the start-game click; see below.                                 |
| A song in the folder never appears         | Unrecognised extension, or the server is pointed at another folder - its startup log says which. |
| A replaced song never appears              | The manifest got cached. Confirm the server sent `no-cache` for `music.json`.                    |

Browsers refuse to play audio without a user gesture, so playback starts on the **start-game
click** and never before. If it is blocked anyway the player logs a warning and retries on the
next click or keypress, so the worst case is late music, not none.

Useful checks:

```bash
curl -s http://localhost:8080/music/music.json            # what the server thinks it has
curl -I http://localhost:8080/music/music.json            # expect 200 + no-cache
curl -I "http://localhost:8080/music/Bill%20G%20Force.m4a"  # expect 200 + immutable
```

In DevTools: **Application → Cache Storage → clusterfun-music-v1** lists the cached tracks.
Delete that cache to force a re-download. On a reload, `music.json` should be re-requested and
the track should **not** be.
