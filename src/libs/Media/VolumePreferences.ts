import Logger from "js-logger";

// ==========================================================================================
// VolumePreferences - the host's sound-effect and music levels, remembered.
//
// Worth persisting because refreshing the presenter is a normal thing to do in ClusterFun -
// a game resumes from its checkpoint - and having the room's volume jump back to default
// every time somebody reloads would make the sliders feel broken.
//
// localStorage rather than the game model on purpose: this is a property of the machine the
// shared screen is running on, not of the game, and it must not end up in a checkpoint.
// ==========================================================================================

export const VOLUME_PREFS_KEY = "clusterfun_volumes";

export interface VolumeLevels {
  effects: number;
  music: number;
}

export const DEFAULT_VOLUMES: VolumeLevels = { effects: 1, music: 0.3 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class VolumePreferences {
  private readonly storage: Storage | undefined;

  // Injectable so tests do not depend on a real localStorage, and so a browser with
  // storage switched off degrades to defaults instead of throwing.
  constructor(storage?: Storage) {
    this.storage =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : (undefined as any));
  }

  load(): VolumeLevels {
    try {
      const raw = this.storage?.getItem(VOLUME_PREFS_KEY);
      if (!raw) return { ...DEFAULT_VOLUMES };
      const parsed = JSON.parse(raw);
      return {
        effects: readLevel(parsed?.effects, DEFAULT_VOLUMES.effects),
        music: readLevel(parsed?.music, DEFAULT_VOLUMES.music),
      };
    } catch (err) {
      Logger.warn("VolumePreferences: could not read saved volumes - using defaults", err);
      return { ...DEFAULT_VOLUMES };
    }
  }

  save(levels: VolumeLevels): void {
    try {
      this.storage?.setItem(
        VOLUME_PREFS_KEY,
        JSON.stringify({ effects: clamp01(levels.effects), music: clamp01(levels.music) }),
      );
    } catch (err) {
      // A full or disabled storage must not break the slider the user is dragging.
      Logger.warn("VolumePreferences: could not save volumes", err);
    }
  }
}

// A saved value that is missing, not a number, or NaN falls back to the default rather than
// silencing the room.
function readLevel(value: any, fallback: number): number {
  return typeof value === "number" && isFinite(value) ? clamp01(value) : fallback;
}
