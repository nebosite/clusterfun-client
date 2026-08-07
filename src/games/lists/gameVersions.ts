import { CollageBoardVersion } from "games/CollageBoard/models/GameSettings";
import { EittrisVersion } from "games/Eittris/models/GameSettings";
import { FaceOffVersion } from "games/FaceOff/models/GameSettings";
import { PassTheAuxVersion } from "games/PassTheAux/models/GameSettings";
import { LexibleVersion } from "games/Lexible/models/GameSettings";
import { OneOhOneVersion } from "games/OneOhOne/models/GameSettings";
import { PartyPixVersion } from "games/PartyPix/models/GameSettings";
import { RetroSpectroVersion } from "games/RetroSpectro/models/GameSettings";
import { StressatoVersion } from "games/stressgame/models/GameSettings";
import { TemplateVersion } from "games/TemplateGame/models/GameSettings";

// -------------------------------------------------------------------
// Each game's version, reachable from the LOBBY - which has to name a version before it has
// loaded the game that owns it.
//
// This does NOT break code-splitting. Every `GameSettings.ts` imports from `libs` and nothing
// else, so pulling one in costs the version data and no part of the game itself; the
// `importThunk` in the registry is still the only thing that fetches a game's bundle.
//
// It is also not a second copy of the numbers. Each entry points at the constant the game
// derives from its own change history, so a version still cannot be bumped without saying
// what changed - see libs/config/GameVersion.ts.
//
// Keyed by the registry's `name`, NOT `displayName`: the server manifest can rewrite a
// display name in production.
// -------------------------------------------------------------------
const GAME_VERSIONS: Record<string, string> = {
  Eittris: EittrisVersion,
  OneOhOne: OneOhOneVersion,
  PartyPix: PartyPixVersion,
  Lexible: LexibleVersion,
  RetroSpectro: RetroSpectroVersion,
  PassTheAux: PassTheAuxVersion,
  FaceOff: FaceOffVersion,
  CollageBoard: CollageBoardVersion,
  Stressato: StressatoVersion,
  Template: TemplateVersion,
};

/**
 * The version for a registry game name, or undefined if nothing is registered for it.
 * Undefined is a normal answer - the lobby simply shows no version rather than a wrong one.
 */
export function versionForGame(gameName: string): string | undefined {
  return GAME_VERSIONS[gameName];
}

export default GAME_VERSIONS;
