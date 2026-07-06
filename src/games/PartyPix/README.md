# PartyPix

A communal party-photography game. The presenter runs a live slideshow on the big TV; players
join on their phones, take photos of guests, upload their best (each costs a credit), and vote on
what's on screen. Upvotes earn the photographer more credits.

- **Design spec:** [DESIGN.md](DESIGN.md) (the source of truth for flow, economy, and look).
- **Architecture + how the code maps to the design:** [CLAUDE.md](CLAUDE.md).

Try it in the dev Test Lobby (`npm start` in `clusterfun-client`, then pick **PartyPix**): the
presenter pane shows the slideshow; the phone panes take photos (file picker on desktop) and vote.
