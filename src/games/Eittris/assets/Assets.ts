// Asset manifest.  Sounds and board backgrounds are the original eitrix WAVs /
// Grid art (F:\Git\eitrix\Content); the logo is still the template placeholder.
import logo from "./images/Logo.png";
import specials from "./images/specials.png";
import grid00 from "./images/Grid00.png";
import grid01 from "./images/Grid01.png";
import grid02 from "./images/Grid02.png";
import grid03 from "./images/Grid03.png";
import grid04 from "./images/Grid04.png";
import grid05 from "./images/Grid05.png";
import grid06 from "./images/Grid06.png";
import hello from "./sounds/hello.mp3";
import speedup from "./sounds/Speedup.wav";
import repel from "./sounds/Attack02.wav";
import dot from "./sounds/Dot.wav";
import clear1 from "./sounds/Clear1Line.wav";
import clear2 from "./sounds/Clear2Lines.wav";
import clear3 from "./sounds/Clear3Lines.wav";
import clear4 from "./sounds/Clear4Lines.wav";
import bump from "./sounds/Bump.wav";
import crowdAww from "./sounds/CrowdAww.wav";
import cheer from "./sounds/Cheer.wav";
import gameStart from "./sounds/GameStart.wav";

const EittrisAssets = {
  images: {
    logo,
    specials, // 16-icon strip lifted from the original atlas (SpecialType order)
    // The board backgrounds the original randomizes over (index = backgroundIndex)
    backgrounds: [grid00, grid01, grid02, grid03, grid04, grid05, grid06],
  },
  sounds: {
    speedup, // a Speedup landed on someone
    repel, // an antidote shield turned an attack away
    hello, // a player joined (template placeholder - no eitrix equivalent wired)
    dot, // a piece locked in place
    clear1, // 1 row cleared
    clear2, // 2 rows cleared
    clear3, // 3 rows cleared
    clear4, // 4 rows cleared
    bump, // slam / hard-drop landing
    crowdAww, // a board topped out (player death)
    cheer, // winner announced
    gameStart, // the round kicked off
  },
};

export default EittrisAssets;
