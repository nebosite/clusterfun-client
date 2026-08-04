import logo from "./images/Lexible.png";
import ding from "./sounds/ding.m4a";
import hello from "./sounds/hello.mp3";
import response from "./sounds/response.mp3";

// The three instructions*.png diagrams are gone: the instructions now animate a real 6x6
// board (views/InstructionDemo.tsx), and the pictures were 474KB nothing referenced.
const LexibleAssets = {
  images: {
    logo,
  },
  sounds: {
    ding,
    hello,
    response,
  },
};

export default LexibleAssets;
