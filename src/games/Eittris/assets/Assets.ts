// Asset manifest.  Sounds and board backgrounds are the original eitrix WAVs /
// Grid art (F:\Git\eitrix\Content); the logo is still the template placeholder.
import logo from "./images/Logo.png";
import specials from "./images/specials.png";
import brick from "./images/brick.png";
import dmitri from "./images/dmitri.png";
import grid00 from "./images/Grid00.png";
import grid01 from "./images/Grid01.png";
import grid02 from "./images/Grid02.png";
import grid03 from "./images/Grid03.png";
import grid04 from "./images/Grid04.png";
import grid05 from "./images/Grid05.png";
import grid06 from "./images/Grid06.png";
import hello from "./sounds/hello.mp3";
import speedup from "./sounds/Speedup.m4a";
import repel from "./sounds/Attack02.m4a";
import wall from "./sounds/Attack04.m4a";
import smack from "./sounds/Smack00.m4a";
import shackle from "./sounds/Smack03a.m4a";
import tower from "./sounds/Smack07_Slam.m4a";
import bridge from "./sounds/Smack01.m4a";
import slowdown from "./sounds/Slowdown.m4a";
import shadows from "./sounds/Trans01.m4a";
import evil from "./sounds/Attack11_Trombone.m4a";
import ivan from "./sounds/Attack13_CrazyLaugh.m4a";
import freeze from "./sounds/Attack07.m4a";
import vanish from "./sounds/Attack09.m4a";
import psycho from "./sounds/Attack10_Yell.m4a";
import cured from "./sounds/Trans03_Chimes.m4a";
import jumble from "./sounds/Dot02.m4a";
import quake from "./sounds/Quake.m4a";
import swap from "./sounds/Dot.m4a";
import dot from "./sounds/Dot.m4a";
import clear1 from "./sounds/Clear1Line.m4a";
import clear2 from "./sounds/Clear2Lines.m4a";
import clear3 from "./sounds/Clear3Lines.m4a";
import clear4 from "./sounds/Clear4Lines.m4a";
import bump from "./sounds/Bump.m4a";
import crowdAww from "./sounds/CrowdAww.m4a";
import cheer from "./sounds/Cheer.m4a";
import gameStart from "./sounds/GameStart.m4a";

const EittrisAssets = {
  images: {
    logo,
    specials, // 16-icon strip lifted from the original atlas (SpecialType order)
    // The original's white brick shape (atlas sprite 0).  Tinted and faded for
    // the SeeShadows landing ghost and the Transparency brick outlines.
    brick,
    // The host screen's resident composer, bottom-left of the setup page
    dmitri,
    // The board backgrounds the original randomizes over (index = backgroundIndex)
    backgrounds: [grid00, grid01, grid02, grid03, grid04, grid05, grid06],
  },
  sounds: {
    speedup, // a Speedup landed on someone
    repel, // an antidote shield turned an attack away
    wall, // TheWall burying a board
    smack, // a shape-painting attack landing
    shackle, // the Shackle ring clamping down
    tower, // TowerOfEit slamming into place
    bridge, // a Bridge roofing a stack
    slowdown, // SlowDown easing your own gravity
    shadows, // SeeShadows switching the landing ghost on
    evil, // EvilPieces landing on someone
    ivan, // CrazyIvan flipping the controls
    freeze, // FreezeDried shrivelling a stack
    vanish, // Transparency hiding a stack
    psycho, // Psycho scrambling the colors
    cured, // an affliction let go - timed out, or an antidote washed it off
    jumble, // Jumble shaking a stack apart
    quake, // the ground moving under an earthquake
    swap, // SwitchScreens trading boards
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
