# EITtris

A frenetic vs-Tetris party game ported from the C# MonoGame original ("eitrix").
Every player plays a full Tetris board from their own phone; the shared presenter
screen shows everyone's boards side by side; the last board standing wins.

See [DESIGN.md](DESIGN.md) for the full design, the increment plan, and the
catalog of eitrix powerups slated for later increments.

## How to play (increment 1)

- Join from your phone; the host starts the game when everyone is in.
- Your phone shows YOUR board. All boards run at once on the big screen.
- Touch controls (mouse works the same way):
  - **Drag freely** — the piece follows your finger sideways AND down at once
    (never up; +10 points per row descended). Letting go locks the piece only
    if it is resting on something.
  - **Tap** or **flick up** — rotate clockwise.
  - **Flick left/right** — slam the piece all the way to that side.
  - **Flick down** — hard drop (+10 points per row dropped) — and the NEXT
    piece plummets until it locks, too.
- Below your board: the other players with live mini-thumbnails of their
  boards. Tap one to make them your **target** (the target for powerups in a
  later increment).
- Clearing rows scores rows² × 1000 (1 → 1000 ... 4 → 16000). Gravity speeds up
  continuously. When a fresh piece has no room to spawn, your board is out.
- Last player standing wins.

## Architecture note

Unlike most ClusterFun games, the presenter simulates **every** board (gravity,
collision, locking, clears, scoring). Phones only send small gesture commands
and render their own board from compact board-update pushes. All the rules are
pure functions in `models/eittrisLogic.ts` with Jest specs.
