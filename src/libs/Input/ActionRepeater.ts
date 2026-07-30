import { RepeatSettings } from "./InputActions";

// ==========================================================================================
// ActionRepeater - the "hold left to walk across the board" logic, on its own.
//
// No timers and no clock of its own: the caller says how much time has passed.  That is what
// makes the feel testable - a spec can hold a key for exactly 500ms without waiting half a
// second, and the repeat cadence is pinned rather than eyeballed.
//
// Each held action waits `delayMs` and then fires every `intervalMs`.  Actions the game did
// not ask to repeat are held without ever firing again, so a rotate is one rotate however
// long you lean on the key.
// ==========================================================================================
export class ActionRepeater {
  private held = new Map<string, number>(); // action -> ms held
  private settings?: RepeatSettings;

  constructor(settings?: RepeatSettings) {
    this.settings = settings;
  }

  get heldActions(): string[] {
    return Array.from(this.held.keys());
  }

  isHeld(action: string) {
    return this.held.has(action);
  }

  // A fresh press.  Returns true if this press should fire now - which it
  // always should; repeats come later.  A press of an already-held action is
  // ignored, so the browser's own key auto-repeat cannot double up with ours.
  press(action: string): boolean {
    if (this.held.has(action)) return false;
    this.held.set(action, 0);
    return true;
  }

  release(action: string) {
    this.held.delete(action);
  }

  releaseAll() {
    this.held.clear();
  }

  // -------------------------------------------------------------------
  // tick - advance time and return the actions that should fire again now.
  // May return the same action more than once if a long frame covered
  // several intervals, so a stutter does not silently swallow movement.
  // -------------------------------------------------------------------
  tick(dtMs: number): string[] {
    const fired: string[] = [];
    if (!this.settings || dtMs <= 0) {
      // Still age the held timers, so a paused frame does not bank repeats
      for (const [action, elapsed] of this.held) this.held.set(action, elapsed + Math.max(0, dtMs));
      return fired;
    }
    const { actions, delayMs, intervalMs } = this.settings;
    for (const [action, before] of this.held) {
      const after = before + dtMs;
      this.held.set(action, after);
      if (!actions.includes(action)) continue;

      // How many repeat boundaries were crossed between `before` and `after`
      const countAt = (elapsed: number) =>
        elapsed < delayMs ? 0 : Math.floor((elapsed - delayMs) / Math.max(1, intervalMs)) + 1;
      const repeats = countAt(after) - countAt(before);
      for (let i = 0; i < repeats; i++) fired.push(action);
    }
    return fired;
  }
}
