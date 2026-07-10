# PartyPix — Design Spec (MVP)

> This is the designer's source-of-truth spec the implementation follows. See
> [CLAUDE.md](CLAUDE.md) for how the code maps to it and which cut-lines were taken.

A communal party-photography game for ClusterFun. The presenter runs a live slideshow on the
big TV; players roam the party snapping photos of guests on their phones, upload the best, and
vote on what's on screen. Good photographers earn more credits and keep shooting.

## Core loop

`Join → snap a photo → confirm → upload (spend 1 credit) → it enters the slideshow → others
upvote/downvote/flag → upvotes refund credits → shoot more.` Continuous / arcade, never
turn-based. Everyone uploads and votes whenever they like; join at any moment.

## Economy (concrete)

- Start credits: **3**. Upload cost: **1**. Can't upload at 0.
- Earn: a bonus credit as your cumulative upvotes (`totalUp`) cross **2, 5, and 20** upvotes (three
  bonus credits total; none after 20).
- Credits (and "next credit in N upvotes") are shown **on every phone tab**, including while voting.
- Downvotes: tally + weighting only. They **do not** reduce credits or `totalUp`.
- Flags: a **single flag pulls a photo out of rotation** into the presenter's flagged holding area
  (remembered, not deleted). The host reviews flagged photos (with who flagged each) and either
  **OK**s it (returns to rotation; now needs **3** flags to be pulled again) or **Bans** it
  (permanently removed; its content hash blocks re-uploading the same image). Removal never
  penalizes the author's earned credits.
- Anti-abuse: one up/down per player per photo (mutually exclusive, changeable); **can't vote your
  own photo**; one flag per player; each voter advances an author toward a credit at most once;
  credit **soft cap 9**.

## State machine

- Presenter: `Gathering` (no photos → join screen) → `Slideshow` on first upload → back to
  `Gathering` if all photos removed. (`WrapUp`/best-of is deferred.)
- Client: joins → `Playing`, a single active state with two freely-switched views: **Capture**
  (↔ Review after camera) and **Vote** (now-showing strip). "Out of credits" is the Capture view
  with the action disabled + earn-more panel.

## Slideshow

- Rotation: **6s** per photo. Photo is letterboxed on the dark stage — never cropped/stretched.
- New upload appears immediately (instant gratification) with a brief "NEW PHOTO by X" banner.
- 0 photos → join screen. Deleting the on-screen photo advances immediately.

## Visual (Neon Arcade)

Dark `#08080d` / raised `#0d0d14`, neon accents used sparingly. **Cyan** = identity + credits +
room code; **Lime** = go / upload / upvote; **Magenta** = downvote; **Yellow** = flag / warnings.
`PARTYPIX` wordmark in Bungee; Space Grotesk for UI; Space Mono for codes/counts.

## Transport

Phones downscale photos client-side to a full JPEG (long edge ≤ 1200, q≈0.7) plus a small thumb
(≤ 256), sent as base64 through the relay. The presenter holds all photos in memory; only the
small thumb is pushed to phones for the now-showing strip. Photos are **not** serialized to the
checkpoint (localStorage quota).

## MVP cut-lines

**In:** join + roster count; camera via file input; review/confirm; slideshow (letterbox, 6s,
new-photo banner); presenter chrome (wordmark, join code, author, up/down tally, photo counter,
credit-earned toast); phone vote strip (now-showing thumb, up/down/flag, one-vote, no self-vote);
the economy above; Neon Arcade styling; reduced-motion.
**Deferred:** QR code, host start-gate + best-of montage, mini-leaderboard, animated
transitions, strict round-robin-by-author ordering (MVP shows newest-on-upload then simple
rotation), captions/comments, export, richer moderation, most-upvoted weighting, cross-restart
persistence of photos.
