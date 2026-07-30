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

// What to show a player who has a keyboard.  One representative key per action
// rather than all of them - the full list is noise on a status line.
export const EITTRIS_KEY_HINTS: { action: EittrisActionName; label: string; keys: string }[] = [
  { action: EittrisAction.MoveLeft, label: "Move", keys: "← → / A D / J L" },
  { action: EittrisAction.MoveDown, label: "Down", keys: "↓ / S / K" },
  { action: EittrisAction.RotateRight, label: "Rotate", keys: "↑ / W / X" },
  { action: EittrisAction.RotateLeft, label: "Rotate back", keys: "Z" },
  { action: EittrisAction.Drop, label: "Drop", keys: "Space" },
  { action: EittrisAction.PrevTarget, label: "Target", keys: "Q E" },
  { action: EittrisAction.UseAntidote, label: "Antidote", keys: "F" },
];
