import Logger from "js-logger";
import { IStorageAccessor, ClientStorage } from "./StorageHelper";

// ==========================================================================================
// PlayerIdentityStore - who you are, remembered between visits.
//
// Everything else the lobby keeps lives in sessionStorage, which is correct for it: a saved
// game should not outlive the browser session, or you would resume a game from last week.
// But your NAME and AVATAR should - retyping them every time you open the lobby is the
// single most annoying thing about joining a party game.  So this is deliberately
// localStorage, separate from the session state.
//
// The room code is remembered too, because reconnecting after a phone locks up is common -
// but only until the host says the game is over, at which point it is stale and misleading
// (see forgetRoom).
// ==========================================================================================

export const PLAYER_IDENTITY_KEY = "clusterfun_player_identity";

export interface PlayerIdentity {
  playerName: string;
  avatarId: number;
  avatarColor: number;
  roomId: string;
}

export const BLANK_IDENTITY: PlayerIdentity = {
  playerName: "",
  avatarId: 0,
  avatarColor: 0,
  roomId: "",
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export class PlayerIdentityStore {
  private accessor: IStorageAccessor;
  // If localStorage throws (private browsing, quota, a locked-down browser) we
  // keep the identity for this page load rather than losing the lobby.
  private fallback: PlayerIdentity | null = null;

  constructor(accessor?: IStorageAccessor) {
    this.accessor = accessor ?? new ClientStorage();
  }

  // -------------------------------------------------------------------
  // load - always returns something usable.  Anything unreadable or
  // malformed reads as a blank identity rather than throwing into startup.
  // -------------------------------------------------------------------
  load(): PlayerIdentity {
    if (this.fallback) return { ...this.fallback };
    try {
      const raw = this.accessor.getItem(PLAYER_IDENTITY_KEY);
      if (!raw) return { ...BLANK_IDENTITY };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { ...BLANK_IDENTITY };
      return {
        playerName: asString(parsed.playerName, 16),
        avatarId: asNumber(parsed.avatarId),
        avatarColor: asNumber(parsed.avatarColor),
        // Room codes are 4 chars of A-Z0-9.  Strip BEFORE truncating, or a
        // stored code with punctuation in it silently loses a character.
        roomId: asString(parsed.roomId, 32)
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 4),
      };
    } catch (err) {
      Logger.warn(`Could not read the remembered player identity: ${err}`);
      return { ...BLANK_IDENTITY };
    }
  }

  // -------------------------------------------------------------------
  // save - merge over whatever is already remembered
  // -------------------------------------------------------------------
  save(changes: Partial<PlayerIdentity>) {
    const merged = { ...this.load(), ...changes };
    try {
      this.accessor.setItem(PLAYER_IDENTITY_KEY, JSON.stringify(merged));
      this.fallback = null;
    } catch (err) {
      Logger.warn(`Could not remember the player identity: ${err}`);
      this.fallback = merged;
    }
  }

  // -------------------------------------------------------------------
  // forgetRoom - the game is over, so the code is stale.  Name and avatar
  // stay: those are the whole point of remembering anything.
  // -------------------------------------------------------------------
  forgetRoom() {
    this.save({ roomId: "" });
  }

  // Wipe everything (a "not you?" style reset)
  forgetAll() {
    try {
      this.accessor.removeItem(PLAYER_IDENTITY_KEY);
    } catch {
      /* nothing we can do, and nothing worth failing over */
    }
    this.fallback = null;
  }
}
