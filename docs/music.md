# Background music

Music is **not in git**. Tracks live in a Cloudflare R2 bucket and are fetched at runtime, so
adding or replacing music needs no code change, no rebuild and no deploy.

Only the EITtris presenter (the shared screen) plays music today. Phones stay silent.

## Where things are

| Thing          | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Bucket         | `clusterfun-music` (Cloudflare R2, public-read)                    |
| Custom domain  | `https://music.clusterfun.tv`                                      |
| Manifest       | `https://music.clusterfun.tv/music.json` — the one mutable file    |
| Tracks         | `https://music.clusterfun.tv/tracks/<name>.<hash>.m4a` — immutable |
| Client env var | `REACT_APP_MUSIC_BASE_URL` (in `.env.dev` and `.env.local`)        |
| Browser cache  | Cache API, `clusterfun-music-v1`                                   |

Leave `REACT_APP_MUSIC_BASE_URL` **unset** for a build that should have no music. The code
treats an unset base URL as "music is off": it never calls the network, logs nothing, and the
game is exactly as it was.

> **Which builds get it.** Create React App auto-loads `.env.local` on top of everything, in
> production builds as well as dev. So the variable being in `.env.local` means `npm run build`
> — and therefore the deploy — bakes the URL in, even though `.env.production` never mentions
> it. That is intended: the Pi will start playing music the moment the bucket exists, with no
> rebuild. It also means turning music off locally takes commenting it out in **both**
> `.env.dev` and `.env.local`; `.env.dev` alone is not enough.

## One-time bucket setup

1. Create an R2 bucket named `clusterfun-music`, **public read**. Public-read is a
   bucket-level property, so music gets a bucket of its own — do not put anything private in
   it later.
2. Put a custom domain in front of it: `music.clusterfun.tv`. The default `pub-*.r2.dev`
   domain is rate-limited by Cloudflare and is not for production traffic.
3. Configure CORS to allow `GET` and `HEAD` from:
   - `https://clusterfun.tv`
   - `http://localhost:3000` (Test Lobby)
   - `http://localhost:8080` (locally served build)
   - whatever LAN address you reach the presenter by, e.g. `http://192.168.86.34:8080`

   CORS is **required**, not optional: the player fetches these files with `fetch()` so it can
   cache the bytes, and `fetch` is CORS-governed even though a plain `<audio src>` would not
   be. A missing CORS rule looks exactly like a missing file.

4. Cache headers:
   - tracks: `Cache-Control: public, max-age=31536000, immutable`
   - `music.json`: `Cache-Control: no-cache`

   The track URLs carry a content hash, so caching them forever is safe. `music.json` is the
   only mutable object and must be re-validated, or a replaced track never reaches anybody.

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

## Naming: the content hash

Every track filename carries the first 6 hex characters of its SHA-256. That is what lets the
files be cached forever and replaced safely.

```bash
# bash
shasum -a 256 track01.m4a | cut -c1-6
```

```powershell
# PowerShell
(Get-FileHash track01.m4a -Algorithm SHA256).Hash.Substring(0,6).ToLower()
```

So `eittris-main.m4a` with hash `a91f3c…` is uploaded as `tracks/eittris-main.a91f3c.m4a`.

## `music.json`

Hand-written, uploaded to the bucket root, served `no-cache`.

```json
{
  "schema": 1,
  "version": "2026-07-30",
  "tracks": [
    {
      "id": "eittris-main",
      "file": "tracks/eittris-main.a91f3c.m4a",
      "title": "Falling Blocks",
      "seconds": 184,
      "bytes": 2950000
    },
    {
      "id": "eittris-fast",
      "file": "tracks/eittris-fast.7d0e12.m4a",
      "title": "Speedrun",
      "seconds": 151,
      "bytes": 2410000
    }
  ]
}
```

- `schema` — always `1` today. The loader ignores a manifest whose schema it does not know
  rather than guessing.
- `version` — any string; an ISO date is fine. It is logged when the manifest loads, purely so
  "which music is this presenter running?" can be answered from the browser console.
- `id` — stable across replacements. It is the cache key, so **do not** change it when you
  swap the audio; change the filename instead.
- `seconds` / `bytes` — informational, for the console log. Nothing depends on them.

A track the presenter cannot parse, a 404, a CORS rejection or a broken manifest all end the
same way: one warning in the console and a game with no music. Music never breaks a game.

## Adding a track

1. Encode it with the commands above.
2. Compute the hash and rename to `<name>.<hash>.m4a`.
3. Upload to `tracks/` with `Cache-Control: public, max-age=31536000, immutable`.
4. Add an entry to `music.json` and upload it with `Cache-Control: no-cache`.

Any presenter started after that picks it up. Presenters already running do not.

## Replacing a track

Tracks are immutable, so a replacement is a **new file with a new name** — never an overwrite.

1. Encode the new audio, hash it, upload as `tracks/<name>.<newhash>.m4a`.
2. Edit that track's `file` in `music.json` to point at the new name. **Keep the same `id`.**
3. Upload `music.json`.
4. **Do not delete the old file yet.** A presenter that is mid-game is playing from bytes it
   already holds and will never ask for it again, but a presenter that loaded the old manifest
   seconds before you swapped it still might. A day is plenty, and old tracks are cheap to
   keep.

What happens next, and why nothing breaks:

- A **running game does not change**. Its manifest was fetched once at startup and it is
  playing from an object URL minted from bytes already in memory. Nothing re-reads anything.
- The **next presenter to start** fetches the fresh `music.json` (it is `no-cache`) and gets
  the new file. Its URL is one the browser has never seen, so it downloads it.
- The old track's cached bytes are **swept** on that next load: anything in the cache that is
  not in the current manifest is deleted, so superseded tracks do not accumulate.

## Troubleshooting

| Symptom                                    | Likely cause                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Silent, no console warning at all          | `REACT_APP_MUSIC_BASE_URL` was unset in that build. Grep the bundle for it. |
| `MusicLibrary: could not load manifest`    | 404, DNS, or the bucket is not public. `curl -I .../music.json`.            |
| Manifest loads but tracks never play       | CORS. The manifest fetch and the track fetch are both CORS-governed.        |
| Plays on Chrome, silent on Safari          | Format. Confirm the file is AAC in `.m4a`, not Opus.                        |
| Music does not start until the second game | Autoplay blocking. It should start on the start-game click; see below.      |

Browsers refuse to play audio without a user gesture, so playback starts on the **start-game
click** and never before. If it is blocked anyway the player logs a warning and retries on the
next click or keypress, so the worst case is late music, not none.

Useful checks:

```bash
curl -I https://music.clusterfun.tv/music.json   # expect 200 + no-cache
curl -I https://music.clusterfun.tv/tracks/eittris-main.a91f3c.m4a  # expect 200 + immutable
```

In DevTools: **Application → Cache Storage → clusterfun-music-v1** lists the cached tracks.
Delete that cache to force a re-download. On a reload, `music.json` should be re-requested and
the track should **not** be.
