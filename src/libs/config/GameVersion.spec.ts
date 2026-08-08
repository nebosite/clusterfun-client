import { compareVersions, currentVersion, parseVersion } from "./GameVersion";
import { EITTRIS_VERSION_HISTORY } from "../../games/Eittris/models/GameSettings";
import { LEXIBLE_VERSION_HISTORY } from "../../games/Lexible/models/GameSettings";
import { ONE_OH_ONE_VERSION_HISTORY } from "../../games/OneOhOne/models/GameSettings";
import { PARTY_PIX_VERSION_HISTORY } from "../../games/PartyPix/models/GameSettings";
import { RETROSPECTRO_VERSION_HISTORY } from "../../games/RetroSpectro/models/GameSettings";
import { TEMPLATE_VERSION_HISTORY } from "../../games/TemplateGame/models/GameSettings";
import { STRESSATO_VERSION_HISTORY } from "../../games/stressgame/models/GameSettings";
import { PASS_THE_AUX_VERSION_HISTORY } from "../../games/PassTheAux/models/GameSettings";
import { FACE_OFF_VERSION_HISTORY } from "../../games/FaceOff/models/GameSettings";
import { COLLAGE_BOARD_VERSION_HISTORY } from "../../games/CollageBoard/models/GameSettings";
import { BIDBOTS_VERSION_HISTORY } from "../../games/BidBots/models/GameSettings";

// ==========================================================================================
// A game's version IS the newest entry of its change history, so the two cannot drift and a
// version cannot be bumped silently.  These check that rule holds for every game at once -
// which is the only way it stays true, since each game maintains its own list.
// ==========================================================================================

const HISTORIES = {
  Eittris: EITTRIS_VERSION_HISTORY,
  Lexible: LEXIBLE_VERSION_HISTORY,
  "101": ONE_OH_ONE_VERSION_HISTORY,
  PartyPix: PARTY_PIX_VERSION_HISTORY,
  RetroSpectro: RETROSPECTRO_VERSION_HISTORY,
  PassTheAux: PASS_THE_AUX_VERSION_HISTORY,
  FaceOff: FACE_OFF_VERSION_HISTORY,
  CollageBoard: COLLAGE_BOARD_VERSION_HISTORY,
  BidBots: BIDBOTS_VERSION_HISTORY,
  Template: TEMPLATE_VERSION_HISTORY,
  Stressato: STRESSATO_VERSION_HISTORY,
};

describe("parsing and comparing versions", () => {
  it("reads major.minor.patch", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion(" 0.1.0 ")).toEqual([0, 1, 0]);
  });

  it("rejects anything that is not three numbers", () => {
    // "0.0.0.0" was a real value in the tree, and it sorts as nonsense.
    expect(parseVersion("0.0.0.0")).toBeUndefined();
    expect(parseVersion("1.2")).toBeUndefined();
    expect(parseVersion("v1.2.3")).toBeUndefined();
    expect(parseVersion("")).toBeUndefined();
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
  });
});

describe("currentVersion", () => {
  it("is the newest entry", () => {
    expect(
      currentVersion([
        { version: "0.2.0", changes: ["b"] },
        { version: "0.1.0", changes: ["a"] },
      ]),
    ).toBe("0.2.0");
  });

  it("refuses an empty history rather than showing a blank version", () => {
    expect(() => currentVersion([])).toThrow();
  });
});

describe("every game's version history", () => {
  for (const [game, history] of Object.entries(HISTORIES)) {
    describe(game, () => {
      it("has at least one entry, so it has a version at all", () => {
        expect(history.length).toBeGreaterThan(0);
      });

      it("uses well-formed version numbers", () => {
        for (const entry of history) {
          expect(parseVersion(entry.version)).toBeDefined();
        }
      });

      it("lists the newest first, which is what the tag shows", () => {
        for (let i = 1; i < history.length; i++) {
          expect(compareVersions(history[i - 1].version, history[i].version)).toBeGreaterThan(0);
        }
      });

      it("never repeats a version", () => {
        const seen = history.map((e) => e.version);
        expect(new Set(seen).size).toBe(seen.length);
      });

      it("says what changed in every entry", () => {
        // A version with an empty change list is the thing this whole structure exists to
        // prevent: a number that moved and nobody can say why.
        for (const entry of history) {
          expect(entry.changes.length).toBeGreaterThan(0);
          for (const change of entry.changes) expect(change.trim().length).toBeGreaterThan(0);
        }
      });
    });
  }

  it("gives every game a real released version, on top of the platform's own", () => {
    // This used to assert every game was EXACTLY 0.1.0, which was true on the day the scheme
    // landed and became a tripwire the moment a game shipped a change - PartyPix bumping to
    // 0.2.0 failed it. The rule that actually matters is that a game has been released at
    // all: 0.0.x means a version nobody has stood behind.
    for (const [game, history] of Object.entries(HISTORIES)) {
      const version = currentVersion(history);
      expect([game, compareVersions(version, "0.1.0") >= 0]).toEqual([game, true]);
    }
  });
});
