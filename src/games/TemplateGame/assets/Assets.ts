// Asset manifest.  Import every image/sound here and reference them through
// this object so webpack bundles them and games never hard-code asset paths.
import logo from "./images/Logo.png";
import ding from "./sounds/ding.m4a";
import hello from "./sounds/hello.mp3";
import response from "./sounds/response.mp3";
import score from "./sounds/score.m4a";
import winner from "./sounds/winner.m4a";

const TemplateAssets = {
  images: {
    logo,
  },
  sounds: {
    ding, // short alert - used for the round-countdown warning and color changes
    hello, // played when a player joins
    response, // played when a player sends a message
    score, // played when a player's score increases
    winner, // played when the winner is announced at game over
  },
};

export default TemplateAssets;
