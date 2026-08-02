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
  UseEarthquake: "useEarthquake",
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
    // The guideline's counter-clockwise key, and one within reach of each other seat
    {
      action: EittrisAction.RotateLeft,
      codes: ["KeyZ", "ControlLeft", "ControlRight", "KeyU", "Numpad7"],
    },
    // Space hard-drops, and is the one key three of the four seats share - it is where
    // every player's thumb already is.  The numpad seat gets its own so a fourth player is
    // not fighting for it.
    { action: EittrisAction.Drop, codes: ["Space", "Numpad8"] },
    // Targeting, the antidote and the earthquake are EITtris's own, so every seat gets its
    // own key for each within reach of that cluster - see EITTRIS_CONTROL_GUIDE, which is
    // what a player actually reads.
    {
      action: EittrisAction.PrevTarget,
      codes: ["KeyQ", "BracketLeft", "PageUp", "NumpadSubtract"],
    },
    {
      action: EittrisAction.NextTarget,
      codes: ["KeyE", "BracketRight", "PageDown", "NumpadAdd"],
    },
    {
      action: EittrisAction.UseAntidote,
      codes: ["KeyF", "KeyH", "Enter", "NumpadEnter", "Numpad0"],
    },
    {
      action: EittrisAction.UseEarthquake,
      codes: ["KeyG", "ShiftLeft", "Semicolon", "Delete", "NumpadDecimal"],
    },
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
    { action: EittrisAction.UseEarthquake, buttons: [PAD_BUTTON.RightTrigger] },
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

/** One seat at a shared keyboard.  Same nine actions, different keys. */
export interface ControlGuideLayout {
  id: string;
  /** Chip text */
  title: string;
  entries: ControlGuideEntry[];
}

export interface ControlGuideSection {
  id: "touch" | "keyboard" | "pad";
  /** Chip text */
  title: string;
  /** One line, shown under the title when the section is open */
  summary: string;
  /** Shown when the section has no layouts to choose between */
  entries: ControlGuideEntry[];
  /** Where there are several ways to sit at this thing, one per way */
  layouts?: ControlGuideLayout[];
}

/** The nine actions, in the order a player wants to read them. */
function seat(
  move: string,
  down: string,
  cw: string,
  ccw: string,
  drop: string,
  target: string,
  antidote: string,
  quake: string,
): ControlGuideEntry[] {
  return [
    { label: move, detail: "Move left and right" },
    { label: down, detail: "Down one row" },
    { label: cw, detail: "Rotate clockwise" },
    { label: ccw, detail: "Rotate counter-clockwise" },
    { label: drop, detail: "Hard drop" },
    { label: target, detail: "Aim at the previous or next player" },
    { label: antidote, detail: "Use an antidote" },
    { label: quake, detail: "Set off an earthquake" },
  ];
}

export const EITTRIS_CONTROL_GUIDE: ControlGuideSection[] = [
  {
    id: "touch",
    title: "Touch",
    summary: "Everything happens on the board itself - there are no buttons to hunt for.",
    entries: [
      { label: "Drag", detail: "The piece follows your finger sideways and downward" },
      { label: "Tap right of the piece", detail: "Rotate it clockwise" },
      { label: "Tap left of the piece", detail: "Rotate it back, anticlockwise" },
      { label: "Flick down", detail: "Hard drop: straight down and stuck" },
      { label: "Flick left / right", detail: "Slam the piece to that wall" },
      { label: "Lift your finger", detail: "Place the piece if it is resting, else keep falling" },
      { label: "Tap a player", detail: "Aim your next attack at them" },
      {
        label: "Quake button",
        detail: "Shake the stack down to close its holes - one per 22 rows you clear",
      },
    ],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    // Four seats at one keyboard, and a player only wants the one under their hands.  Only
    // one seat's keys are shown at a time, because the full table is four times longer than
    // a phone screen and three quarters of it belongs to somebody else.
    summary: "Four seats at one keyboard - pick the one under your hands.",
    entries: [],
    layouts: [
      {
        id: "arrows",
        title: "Arrows",
        entries: seat("← →", "↓", "↑", "Right Ctrl", "Space", "PgUp / PgDn", "Enter", "Delete"),
      },
      {
        id: "wasd",
        title: "WASD",
        entries: seat("A D", "S", "W", "Z", "Space", "Q / E", "F", "G"),
      },
      {
        id: "ijkl",
        title: "IJKL",
        entries: seat("J L", "K", "I", "U", "Space", "[ / ]", "H", ";"),
      },
      {
        id: "numpad",
        title: "Numpad",
        entries: seat("4 6", "5", "3", "7", "8", "- / +", "0", "."),
      },
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
      { label: "Right trigger", detail: "Set off an earthquake" },
    ],
  },
];
