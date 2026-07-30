import Logger from "js-logger";
import { ActionRepeater } from "./ActionRepeater";
import { AXIS_DEADZONE, InputBindings, actionForCode, AxisDirection } from "./InputActions";

// ==========================================================================================
// GameInputController - keyboard and controller input for any ClusterFun game.
//
// Attach it with a binding table and a callback; it calls back with action names.  It handles
// the awkward parts once, so no game has to:
//
//   - Keyboard, matched on physical key (code), with our own hold-to-repeat rather than the
//     browser's - the browser's rate is a user OS setting, which is no basis for game feel.
//   - Controllers, which the web only exposes by POLLING (there are no button events), so a
//     frame loop turns the polled state into presses and releases.
//   - Losing focus mid-press. Alt-tab while holding "left" and the keyup never arrives, so
//     the piece would slide forever; blur releases everything.
//   - Typing. While a text field has focus, keys belong to the text field.
//
// Controllers work on phones too (Bluetooth pads report through the same API), which is why
// gamepad polling is not gated on being a PC.
// ==========================================================================================

export interface GameInputOptions {
  // Called for every press and every repeat
  onAction: (action: string) => void;
  // Called when a held action is let go, for games that care
  onRelease?: (action: string) => void;
  // Turn keyboard handling off (a game that is touch-only)
  keyboard?: boolean;
  // Turn controller polling off
  gamepad?: boolean;
  // Notified when a controller appears or goes away, so the UI can mention it
  onGamepadChange?: (connected: boolean) => void;
}

export class GameInputController {
  private bindings: InputBindings;
  private options: GameInputOptions;
  private repeater: ActionRepeater;
  private attached = false;
  private frame?: number;
  private lastFrameMs = 0;
  // Which pad buttons/axes were down last poll, so we can spot the edges
  private padDown = new Set<string>();
  private gamepadSeen = false;

  constructor(bindings: InputBindings, options: GameInputOptions) {
    this.bindings = bindings;
    this.options = options;
    this.repeater = new ActionRepeater(bindings.repeat);
  }

  get hasGamepad() {
    return this.gamepadSeen;
  }

  isHeld(action: string) {
    return this.repeater.isHeld(action);
  }

  // -------------------------------------------------------------------
  // attach / detach
  // -------------------------------------------------------------------
  attach() {
    if (this.attached) return;
    this.attached = true;
    if (this.options.keyboard !== false) {
      window.addEventListener("keydown", this.onKeyDown);
      window.addEventListener("keyup", this.onKeyUp);
    }
    window.addEventListener("blur", this.releaseEverything);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.lastFrameMs = this.now();
    this.frame = requestAnimationFrame(this.onFrame);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseEverything);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.repeater.releaseAll();
    this.padDown.clear();
  }

  private now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  // -------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const action = actionForCode(this.bindings, e.code);
    if (!action) return;
    // We own the arrow keys and space while playing; letting them through
    // scrolls the page under the player mid-game.
    e.preventDefault();
    // Ignore the OS auto-repeat - ActionRepeater decides the cadence
    if (e.repeat) return;
    if (this.repeater.press(action)) this.fire(action);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const action = actionForCode(this.bindings, e.code);
    if (!action) return;
    this.release(action);
  };

  private onVisibilityChange = () => {
    if (document.visibilityState !== "visible") this.releaseEverything();
  };

  // A tab switch or a focus loss eats the keyup, which would leave an action
  // held down forever.
  private releaseEverything = () => {
    for (const action of this.repeater.heldActions) this.options.onRelease?.(action);
    this.repeater.releaseAll();
    this.padDown.clear();
  };

  private fire(action: string) {
    try {
      this.options.onAction(action);
    } catch (err) {
      Logger.warn(`Input action '${action}' threw: ${err}`);
    }
  }

  private release(action: string) {
    if (!this.repeater.isHeld(action)) return;
    this.repeater.release(action);
    this.options.onRelease?.(action);
  }

  // -------------------------------------------------------------------
  // The frame loop: drives repeats, and polls controllers (the Gamepad API
  // has no events for button presses - polling is the only way).
  // -------------------------------------------------------------------
  private onFrame = () => {
    if (!this.attached) return;
    const now = this.now();
    const dt = now - this.lastFrameMs;
    this.lastFrameMs = now;

    if (this.options.gamepad !== false) this.pollGamepads();
    for (const action of this.repeater.tick(dt)) this.fire(action);

    this.frame = requestAnimationFrame(this.onFrame);
  };

  private pollGamepads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected = Array.from(pads).some((p) => !!p?.connected);
    if (connected !== this.gamepadSeen) {
      this.gamepadSeen = connected;
      this.options.onGamepadChange?.(connected);
    }
    if (!connected) return;

    const nowDown = new Set<string>();
    for (const pad of pads) {
      if (!pad?.connected) continue;
      for (const binding of this.bindings.pad) {
        for (const button of binding.buttons ?? []) {
          if (pad.buttons[button]?.pressed) nowDown.add(`${binding.action}|b${button}`);
        }
        for (const axis of binding.axes ?? []) {
          if (axisPushed(pad.axes[axis.index], axis.direction)) {
            nowDown.add(`${binding.action}|a${axis.index}${axis.direction}`);
          }
        }
      }
    }

    // Edges: a source that just went down presses its action; a source that
    // came up releases it, but only once no other source still holds it.
    for (const source of nowDown) {
      if (this.padDown.has(source)) continue;
      const action = source.split("|")[0];
      if (this.repeater.press(action)) this.fire(action);
    }
    for (const source of this.padDown) {
      if (nowDown.has(source)) continue;
      const action = source.split("|")[0];
      const stillHeld = Array.from(nowDown).some((s) => s.startsWith(`${action}|`));
      if (!stillHeld) this.release(action);
    }
    this.padDown = nowDown;
  }
}

// A stick counts as pressed once it is pushed past the deadzone the right way
export function axisPushed(value: number | undefined, direction: AxisDirection): boolean {
  if (value === undefined) return false;
  return direction < 0 ? value <= -AXIS_DEADZONE : value >= AXIS_DEADZONE;
}

// While the player is typing (a name, a chat line), keys belong to the field
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}
