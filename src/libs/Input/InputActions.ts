// ==========================================================================================
// Game input, described as data.
//
// A game names the ACTIONS it understands ("moveLeft", "rotateCW", ...) and hands over a
// binding table saying which keys and which controller buttons mean each one.  Nothing here
// knows anything about any particular game, so the same machinery serves all of them - and a
// game that wants different bindings changes a table rather than event handlers.
//
// Two deliberate choices:
//   - Keys are matched on KeyboardEvent.code, not `key`.  code is the physical key, so WASD
//     still works on AZERTY and a numpad 4 is distinguishable from a 4 on the top row.
//   - Repeat is per-action.  Holding "left" should walk a piece across the board; holding
//     "rotate" should not spin it like a top.
// ==========================================================================================

export interface KeyBinding {
  action: string;
  // KeyboardEvent.code values, e.g. "ArrowLeft", "KeyA", "Numpad4"
  codes: string[];
}

// Directions a stick axis can be pushed to count as a press
export type AxisDirection = -1 | 1;

export interface PadBinding {
  action: string;
  // Standard Gamepad API button indices (see PAD_BUTTON below)
  buttons?: number[];
  // A stick pushed past the deadzone counts as a button press
  axes?: { index: number; direction: AxisDirection }[];
}

export interface InputBindings {
  keys: KeyBinding[];
  pad: PadBinding[];
  // Actions that fire again while held, and how fast.  Anything not listed
  // fires exactly once per press.
  repeat?: RepeatSettings;
}

export interface RepeatSettings {
  actions: string[];
  // Hold this long before the first repeat (tetris players call it DAS)
  delayMs: number;
  // ...then fire this often
  intervalMs: number;
}

// The standard gamepad layout, named.  Index numbers are meaningless on sight
// and every binding table would otherwise be a wall of magic numbers.
export const PAD_BUTTON = {
  A: 0, // Cross
  B: 1, // Circle
  X: 2, // Square
  Y: 3, // Triangle
  LeftShoulder: 4,
  RightShoulder: 5,
  LeftTrigger: 6,
  RightTrigger: 7,
  Back: 8,
  Start: 9,
  LeftStick: 10,
  RightStick: 11,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
} as const;

export const PAD_AXIS = { LeftX: 0, LeftY: 1, RightX: 2, RightY: 3 } as const;

// How far a stick must be pushed to read as a press.  Loose sticks drift, and a
// drifting stick that counts as "left" makes a game unplayable.
export const AXIS_DEADZONE = 0.5;

// -------------------------------------------------------------------
// Which action, if any, a physical key means.  First match wins, so a code
// bound twice by mistake behaves predictably instead of firing both.
// -------------------------------------------------------------------
export function actionForCode(bindings: InputBindings, code: string): string | null {
  for (const binding of bindings.keys) {
    if (binding.codes.includes(code)) return binding.action;
  }
  return null;
}

// Every key bound to an action, for showing the player their controls
export function codesForAction(bindings: InputBindings, action: string): string[] {
  return bindings.keys.filter((b) => b.action === action).flatMap((b) => b.codes);
}

export function repeatsWhileHeld(bindings: InputBindings, action: string): boolean {
  return !!bindings.repeat?.actions.includes(action);
}

// -------------------------------------------------------------------
// Turn a KeyboardEvent.code into something worth showing a player.
// "ArrowLeft" -> "←", "KeyA" -> "A", "Numpad4" -> "Num 4".
// -------------------------------------------------------------------
const ARROW_GLYPHS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

export function describeCode(code: string): string {
  if (ARROW_GLYPHS[code]) return ARROW_GLYPHS[code];
  if (code.startsWith("Numpad")) return `Num ${code.slice("Numpad".length)}`;
  if (code.startsWith("Key")) return code.slice("Key".length);
  if (code.startsWith("Digit")) return code.slice("Digit".length);
  if (code === "Space") return "Space";
  return code;
}
