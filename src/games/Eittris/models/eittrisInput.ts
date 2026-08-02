import { InputBindings, PAD_AXIS, PAD_BUTTON } from "libs";

// ==========================================================================================
// EITtris keyboard and controller bindings.
//
// Nine actions, bound to four keyboard clusters plus a controller, so several people can sit
// at one PC and each use the cluster nearest their hands.
//
// Bindings follow the usual tetris conventions wherever there is one, because muscle memory
// is the whole point: arrows move, Down soft-drops one row, Up rotates, Space hard-drops, and
// Z/X are counter-clockwise/clockwise.  Each cluster gets its own four directions on the same
// pattern, so W/I/Num-8-equivalent rotate exactly as Up does.
// ==========================================================================================

export const EittrisAction = {
  MoveLeft: "moveLeft",
  MoveRight: "moveRight",
  MoveDown: "moveDown", // one row
  Drop: "drop", // all the way, and stick
  RotateLeft: "rotateLeft", // counter-clockwise
  RotateRight: "rotateRight", // clockwise
  NextTarget: "nextTarget",
  PrevTarget: "prevTarget",
  UseAntidote: "useAntidote",
} as const;

export type EittrisActionName = (typeof EittrisAction)[keyof typeof EittrisAction];

// Hold-to-repeat, tuned to the usual tetris feel: a beat before it starts
// walking, then brisk.  Only the three movement actions repeat - a held rotate
// that spun the piece continuously would be unplayable, and a repeating hard
// drop would eat the next piece.
export const EITTRIS_REPEAT = {
  actions: [EittrisAction.MoveLeft, EittrisAction.MoveRight, EittrisAction.MoveDown] as string[],
  delayMs: 170,
  intervalMs: 50,
};

export const EITTRIS_BINDINGS: InputBindings = {
  keys: [
    // The four clusters.  Left/right/down/rotate-clockwise each, so whichever
    // cluster is under your hands behaves the same way.
    {
      action: EittrisAction.MoveLeft,
      codes: ["ArrowLeft", "KeyA", "KeyJ", "Numpad4"],
    },
    {
      action: EittrisAction.MoveRight,
      codes: ["ArrowRight", "KeyD", "KeyL", "Numpad6"],
    },
    {
      action: EittrisAction.MoveDown,
      codes: ["ArrowDown", "KeyS", "KeyK", "Numpad5"],
    },
    {
      // Up rotates, as it has in tetris since the beginning
      action: EittrisAction.RotateRight,
      codes: ["ArrowUp", "KeyW", "KeyI", "Numpad3", "KeyX"],
    },
    // The guideline's counter-clockwise key, plus a numpad seat
    { action: EittrisAction.RotateLeft, codes: ["KeyZ", "ControlLeft", "Numpad7"] },
    // Space hard-drops. Nothing else does, because it ends your turn.
    { action: EittrisAction.Drop, codes: ["Space", "Numpad8"] },
    // Targeting and the antidote are EITtris's own, so they get their own keys
    { action: EittrisAction.PrevTarget, codes: ["KeyQ", "BracketLeft", "PageUp"] },
    { action: EittrisAction.NextTarget, codes: ["KeyE", "BracketRight", "PageDown"] },
    { action: EittrisAction.UseAntidote, codes: ["KeyF", "Enter", "NumpadEnter", "Numpad0"] },
  ],
  pad: [
    // Traditional pad tetris: d-pad or left stick moves, A/B rotate,
    // up hard-drops.
    {
      action: EittrisAction.MoveLeft,
      buttons: [PAD_BUTTON.DPadLeft],
      axes: [{ index: PAD_AXIS.LeftX, direction: -1 }],
    },
    {
      action: EittrisAction.MoveRight,
      buttons: [PAD_BUTTON.DPadRight],
      axes: [{ index: PAD_AXIS.LeftX, direction: 1 }],
    },
    {
      action: EittrisAction.MoveDown,
      buttons: [PAD_BUTTON.DPadDown],
      axes: [{ index: PAD_AXIS.LeftY, direction: 1 }],
    },
    {
      action: EittrisAction.Drop,
      buttons: [PAD_BUTTON.DPadUp, PAD_BUTTON.Y],
      axes: [{ index: PAD_AXIS.LeftY, direction: -1 }],
    },
    { action: EittrisAction.RotateRight, buttons: [PAD_BUTTON.A] },
    { action: EittrisAction.RotateLeft, buttons: [PAD_BUTTON.B] },
    { action: EittrisAction.PrevTarget, buttons: [PAD_BUTTON.LeftShoulder] },
    { action: EittrisAction.NextTarget, buttons: [PAD_BUTTON.RightShoulder] },
    { action: EittrisAction.UseAntidote, buttons: [PAD_BUTTON.X] },
  ],
  repeat: EITTRIS_REPEAT,
};

// ==========================================================================================
// The controls, in plain English, for the waiting screen.
//
// Three ways to play and nobody is told about two of them: a phone is all gestures, a PC is
// all keys, and a pad plugged into either works too.  Rather than a line of hints squeezed
// under the board mid-game - where it is both too small to read and too late to be useful -
// this is the list a player can open while waiting for the host to start.
//
// It lives beside the bindings so the two are edited together.  A mapping described here and
// not bound above is a lie a player finds out about the hard way.
// ==========================================================================================

export interface ControlGuideEntry {
  /** What you do */
  label: string;
  /** What it does */
  detail: string;
}

export interface ControlGuideSection {
  id: "touch" | "keyboard" | "pad";
  /** Chip text */
  title: string;
  /** One line, shown under the title when the section is open */
  summary: string;
  entries: ControlGuideEntry[];
}

export const EITTRIS_CONTROL_GUIDE: ControlGuideSection[] = [
  {
    id: "touch",
    title: "Touch",
    summary: "Everything happens on the board itself - there are no buttons to hunt for.",
    entries: [
      { label: "Drag", detail: "The piece follows your finger sideways and downward" },
      { label: "Tap", detail: "Rotate the piece - anywhere on the board, not just on it" },
      { label: "Flick down", detail: "Hard drop: straight down and stuck" },
      { label: "Flick left / right", detail: "Slam the piece to that wall" },
      { label: "Lift your finger", detail: "Place the piece if it is resting, else keep falling" },
      { label: "Tap a player", detail: "Aim your next attack at them" },
    ],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    // One key per action rather than all four seats: the full table needs more lines than a
    // phone has, and the summary is what tells a player the other seats exist at all.
    summary: "Arrows, WASD, IJKL or the numpad - four seats, so a room can share one PC.",
    entries: [
      { label: "← →", detail: "Move left and right" },
      { label: "↓", detail: "Down one row" },
      { label: "↑ or X", detail: "Rotate clockwise" },
      { label: "Z", detail: "Rotate counter-clockwise" },
      { label: "Space", detail: "Hard drop" },
      { label: "Q / E", detail: "Aim at the previous or next player" },
      { label: "F", detail: "Use an antidote" },
    ],
  },
  {
    id: "pad",
    title: "Controller",
    summary: "Any game pad the browser can see, on a PC or a phone.",
    entries: [
      { label: "D-pad / left stick", detail: "Move left, right and down" },
      { label: "A / B", detail: "Rotate clockwise / counter-clockwise" },
      { label: "Up / Y", detail: "Hard drop" },
      { label: "LB / RB", detail: "Aim at the previous or next player" },
      { label: "X", detail: "Use an antidote" },
    ],
  },
];
