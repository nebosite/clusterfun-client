// Asset manifest.  Import every image/sound here and reference them through
// this object so webpack bundles them and games never hard-code asset paths.
import logo from "./images/Logo.png";
import ding from "./sounds/ding.m4a";
import hello from "./sounds/hello.mp3";
import response from "./sounds/response.mp3";
import score from "./sounds/score.m4a";
import winner from "./sounds/winner.m4a";

// Placeholder sounds inherited from the template, remapped to BidBots moments.
// Swap in bespoke gavel / clang / KO cues later without touching the view wiring.
const BidBotsAssets = {
  images: {
    logo,
  },
  sounds: {
    ding, // short blip - the price-drop tick and a placed bid
    hello, // played when a player joins
    sold: response, // gavel-ish - a bot is SOLD
    hit: score, // a bot lands a hit in battle
    winner, // played when the champion is crowned at game over
  },
};

export default BidBotsAssets;
