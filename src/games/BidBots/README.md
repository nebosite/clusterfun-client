# BidBots

A frantic **Dutch-auction auto-battler** for ClusterFun. Battle bots are auctioned one at a
time on the big screen, their price falling every second. Players snipe them onto their squad
from a limited bank, then every bot everyone bought is dumped into one arena to fight
last-team-standing. First player to 3 round-wins is champion.

See [DESIGN.md](DESIGN.md) for the full spec and cut-lines.

## How to play

1. **Join** — open the room URL on your phone, pick an avatar, enter the room code.
2. **Auction** — bots are auctioned one at a time. The price starts at **$1000** and falls
   **$100/sec**. Tap **BUY** to grab the bot at the price showing right now. You have a
   **$1000 budget each round** (unspent money banks for later rounds), so weigh grabbing a bot
   early against waiting for a cheaper price — and against whoever else wants it.
   - Two players tap at nearly the same time? The presenter freezes the price for a suspense
     beat and the **earliest tap** wins it.
   - If nobody buys a bot before the price bottoms out, it gets **SCRAPPED**.
3. **Battle** — all the bots everyone bought brawl in one arena until one player's bots are the
   last standing. Watch the big screen; your phone shows your bots' health bars.
4. **Win** — the owner of the last bot alive wins the round. First to **3 wins** is champion.

## Dev

`npm start` → Test Lobby → pick **BidBots**. Everything plays on desktop (no camera needed).
Tests: `npm test` (pure rules in `models/bidBotsLogic.spec.ts`, presenter in
`models/PresenterModel.spec.ts`).
