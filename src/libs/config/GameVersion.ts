// ==========================================================================================
// Per-game versions.
//
// ClusterFun's own version (package.json, shown in the lobby) says which build of the
// PLATFORM is running.  It says nothing about the games, which change on their own schedules -
// so a player reporting "Lexible did X" and a developer asking "which version?" had no shared
// answer.  Each game now carries its own, on top of the platform's.
//
// A version is not a bare string here: it is the newest entry of a CHANGE HISTORY.  Deriving
// the number from the history is the whole point - the two cannot drift, and there is no way
// to bump a version without saying what changed, which is exactly the discipline a changelog
// exists to enforce.  The presenter shows the list when the version is clicked.
// ==========================================================================================

export interface GameVersionEntry {
  /** Semver-ish `major.minor.patch`. */
  version: string;
  /** What changed in this version, in the words a player would use. Newest entry first. */
  changes: string[];
}

/** A game's version: the newest entry in its history. Never call this with an empty list. */
export function currentVersion(history: GameVersionEntry[]): string {
  if (!history.length) throw new Error("A game's version history cannot be empty");
  return history[0].version;
}

/** `1.2.3` -> `[1, 2, 3]`; anything else -> undefined. */
export function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative if a is older than b, positive if newer, 0 if the same. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0, 0];
  const right = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
