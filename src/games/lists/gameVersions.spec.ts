import GAME_VERSIONS, { versionForGame } from "./gameVersions";
import debugGames from "./gamesListDebug";
import { parseVersion } from "libs/config/GameVersion";

// ==========================================================================================
// The lobby names a game's version before it has loaded the game that owns it, so the map
// here is the one place where a registry name and a version have to line up. Nothing else in
// the app would notice them drifting - the card would just quietly stop showing a version.
// ==========================================================================================
describe("the lobby's game-version map", () => {
  it("has an entry for every game in the registry", () => {
    const missing = debugGames.filter((g) => !versionForGame(g.name)).map((g) => g.name);
    expect(missing).toEqual([]);
  });

  it("has no entry for a game that is not in the registry", () => {
    // A stale key is how a renamed game ends up showing the old game's version.
    const names = new Set(debugGames.map((g) => g.name));
    const orphans = Object.keys(GAME_VERSIONS).filter((k) => !names.has(k));
    expect(orphans).toEqual([]);
  });

  it("holds well-formed version numbers", () => {
    const malformed = Object.entries(GAME_VERSIONS)
      .filter(([, version]) => parseVersion(version) === undefined)
      .map(([name, version]) => `${name}: "${version}"`);
    expect(malformed).toEqual([]);
  });

  it("returns undefined for an unknown game rather than throwing", () => {
    // The lobby renders no version in that case; a card is not worth a crash.
    expect(versionForGame("NoSuchGame")).toBeUndefined();
  });
});
