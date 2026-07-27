# 101

A turn-taking racing game: each round every piece secretly picks a number from 1–10.
Unique picks move forward by the pick; pieces that picked the same number get knocked
back by how many picked it. Land exactly on 101 to win — but overshoot past 111 and
you're sent back to the start.

- Up to 16 pieces; every human controls the same number of pieces (host-selected).
- The host can add bots with three attitudes: Aggressive, Moderate, Cautious.

See [DESIGN.md](DESIGN.md) for the full rules, decisions, and message API.
All rule logic lives in [models/oneOhOneLogic.ts](models/oneOhOneLogic.ts) (pure,
unit tested) — tune mechanics there.

**Status:** playable mechanics build; visuals are intentionally plain, awaiting a
skin treatment.
