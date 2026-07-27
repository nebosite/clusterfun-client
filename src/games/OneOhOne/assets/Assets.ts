// Asset manifest.  Placeholder art/sounds borrowed from TemplateGame until the
// design pass replaces them.
import logo from "./images/Logo.png";
import ding from "./sounds/ding.wav";
import hello from "./sounds/hello.mp3";
import response from "./sounds/response.mp3";
import score from "./sounds/score.wav";
import winner from "./sounds/winner.wav";
import stepforward from "./sounds/stepforward.wav";
import stepback from "./sounds/stepback.wav";
import crash from "./sounds/crash.wav";

const OneOhOneAssets = {
  images: {
    logo,
  },
  sounds: {
    ding, // countdown warning + bust
    hello, // player joined
    response, // (unused for now)
    score, // round resolved
    winner, // winner announced
    stepforward, // one forward step in the reveal animation
    stepback, // one backward step in the reveal animation
    crash, // collision! played before a piece slides backward
  },
};

export default OneOhOneAssets;
