import Logger from "js-logger";
import { IStorageAccessor, ClientStorage, TabStorage } from "./StorageHelper";

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
// The reconnect token lives apart from the rest, in SESSION storage.
//
// Name and avatar are long-term memory and belong in localStorage - you want
// them back next week.  The token is the opposite: it says WHICH SEAT this
// client holds, and localStorage is shared by every tab, so two clients opened
// on one PC would present the same token and each be mistaken for the other.
// sessionStorage is per-tab, so every tab is its own player.
//
// The cost is that closing the tab loses the token, and a reconnect after that
// falls back to matching on name.  That is the right trade: quitting and
// rejoining - the case that matters - happens in the same tab.
export const PLAYER_TOKEN_KEY = "clusterfun_player_token";

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

// A token is minted once per browser and then kept.  Random and meaningless:
// it identifies the seat you are holding, nothing about you.
function mintToken(): string {
  const globalCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e12).toString(36)}`;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export class PlayerIdentityStore {
  private accessor: IStorageAccessor;
  private tokenStore: IStorageAccessor;
  private tokenKey: string;
  private sessionToken = "";
  // If localStorage throws (private browsing, quota, a locked-down browser) we
  // keep the identity for this page load rather than losing the lobby.
  private fallback: PlayerIdentity | null = null;

  // `accessor` holds the long-term identity (localStorage by default);
  // `tokenStore` holds the per-tab reconnect token (sessionStorage).
  //
  // `tokenScope` separates tokens WITHIN a tab.  Normally there is one client
  // per tab and it is empty - but the Test Lobby runs four clients on a single
  // page, and without a scope they would all present the same token and be
  // taken for the same returning player.
  constructor(accessor?: IStorageAccessor, tokenStore?: IStorageAccessor, tokenScope = "") {
    this.accessor = accessor ?? new ClientStorage();
    this.tokenStore = tokenStore ?? new TabStorage();
    this.tokenKey = tokenScope ? `${PLAYER_TOKEN_KEY}:${tokenScope}` : PLAYER_TOKEN_KEY;
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
  // token - the private id this browser reconnects with, minted on first use
  // and kept from then on.  Deliberately NOT cleared with the room code: it
  // has to outlive a game for reconnecting to work at all.
  // -------------------------------------------------------------------
  token(): string {
    try {
      const existing = this.tokenStore.getItem(this.tokenKey);
      if (existing) return existing;
      const minted = mintToken();
      this.tokenStore.setItem(this.tokenKey, minted);
      return minted;
    } catch {
      // Storage unavailable: hold one for this page load, so reconnecting
      // still works until the tab goes away
      if (!this.sessionToken) this.sessionToken = mintToken();
      return this.sessionToken;
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
    try {
      this.tokenStore.removeItem(this.tokenKey);
    } catch {
      /* as above */
    }
    this.sessionToken = "";
    this.fallback = null;
  }
}
