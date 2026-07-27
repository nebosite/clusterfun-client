// Asset manifest.  Import every image/sound here and reference them through
// this object so webpack bundles them and games never hard-code asset paths.
import logo from "./images/Logo.png";
import ding from "./sounds/ding.wav";
import hello from "./sounds/hello.mp3";
import response from "./sounds/response.mp3";
import score from "./sounds/score.wav";
import winner from "./sounds/winner.wav";
// Looping background-music beds, one per presenter phase.  NOTE: these are placeholder
// synth loops (generated with ffmpeg) so the feature is functional and testable offline;
// swap them for real, licensed tracks before shipping.
import bgLobby from "./sounds/bg/lobby.ogg";
import bgSelection from "./sounds/bg/selection.ogg";
import bgVoting from "./sounds/bg/voting.ogg";
import bgTally from "./sounds/bg/tally.ogg";
import bgEndgame from "./sounds/bg/endgame.ogg";

const PassTheAuxAssets = {
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
  // Background-music beds (looped, crossfaded on phase change - see BackgroundMusic.ts).
  music: {
    lobby: bgLobby, // Gathering / lobby
    selection: bgSelection, // PromptReveal + Selecting (song selection)
    voting: bgVoting, // Voting
    tally: bgTally, // Tally + Scoreboard
    endgame: bgEndgame, // GameOver results
  },
};

export default PassTheAuxAssets;
