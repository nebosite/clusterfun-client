// Asset manifest.  Import every image/sound here and reference them through
// this object so webpack bundles them and games never hard-code asset paths.
import logo from "./images/Logo.png";
import ding from "./sounds/ding.wav";
import hello from "./sounds/hello.mp3";
import score from "./sounds/score.wav";

const CollageBoardAssets = {
  images: {
    logo,
  },
  sounds: {
    ding, // played when a player claims a zone
    hello, // played when a player joins
    score, // played when a photo lands on the collage
  },
};

export default CollageBoardAssets;
