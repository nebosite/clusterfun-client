import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { EittrisPiece } from "./eittrisLogic";

// ==========================================================================================
// The wire API between phones and the presenter for EITtris.  See DESIGN.md for
// the message table.  Payloads stay tiny (~250 bytes) - the grid rides as a
// 210-char string ('.' empty, digit 0-6 = piece type).
// ==========================================================================================

// ------------------------------------------------------------------------------------------
// One player's compact board state - the payload of both the onboard response
// and the per-player board-update push
// ------------------------------------------------------------------------------------------
export interface EittrisBoardSnapshot {
  grid: string; // 210-char encoded settled grid
  piece: EittrisPiece | null; // the falling piece (null once dead)
  next: number[]; // the next 2 piece types
  score: number;
  rows: number;
  alive: boolean;
  intervalMs: number;
  backgroundIndex: number; // which Grid background this board draws
  targetId: string | null; // who this player is currently targeting
  pieceSeq: number; // bumped on each spawn; phones use it to end a stale gesture
  // Specials sitting on this board's settled blocks: cell index + type
  specials: { i: number; t: number }[];
  antidotes: number; // banked antidote charges
  speedupStacks: number; // Speedup afflictions currently on this board
  slowdownStacks: number; // SlowDown self-buffs (not curable)
  seeShadows: boolean; // draw the landing ghost
  evilPieces: boolean; // drawing from the evil piece table
  crazyIvan: boolean; // controls are mirrored
  freezeDried: boolean; // settled blocks render tiny and jittered
  transparency: boolean; // settled blocks are invisible
  shieldMs: number; // remaining antidote shield (0 = inactive)
  forcedSpecial: number | null; // dev selector echo
  aiControlled: boolean; // dev: the computer is playing this board
}

// ------------------------------------------------------------------------------------------
// Onboard Client - full own-board rebuild on join/rejoin/invalidate (req/resp)
// ------------------------------------------------------------------------------------------
export interface EittrisOnboardClientMessage {
  gameState: string;
  board: EittrisBoardSnapshot | null; // null while gathering (no board yet)
  // Dev preferences live on the player, so they are reported even before a
  // board exists (i.e. while waiting for the game to start)
  aiControlled: boolean;
  forcedSpecial: number | null;
  winnerName: string | null;
  youWon: boolean;
}

export const EittrisOnboardClientEndpoint: MessageEndpoint<unknown, EittrisOnboardClientMessage> = {
  route: "/games/eittris/lifecycle/onboard-client",
  suggestedRetryIntervalMs: 10000,
  suggestedTotalLifetimeMs: 60000,
};

// ------------------------------------------------------------------------------------------
// Command - a phone gesture translated to a discrete action (fire-and-forget).
//   dragTo    - free 2D drag: step toward `column` and down toward `row` (never
//               up, never locks).  Sent while the finger moves.
//   release   - pointer-up after a drag: lock ONLY if the piece is resting,
//               otherwise just resume normal gravity
//   hardDrop  - slam to the floor, lock, and fast-drop the NEXT piece too
//   slamLeft / slamRight / rotate - flick gestures
//   pickTarget - target another player's board (uses `targetId`)
// ------------------------------------------------------------------------------------------
export type EittrisCommandKind =
  | "dragTo"
  | "release"
  | "hardDrop"
  | "slamLeft"
  | "slamRight"
  | "rotate"
  | "pickTarget"
  | "useAntidote" // fire a stored antidote (cure + shield)
  | "setForcedSpecial" // DEV ONLY: pin which special spawns
  | "setAiControlled"; // DEV ONLY: let the computer play this board

export interface EittrisCommandMessage {
  command: EittrisCommandKind;
  column?: number; // dragTo: target column for the piece origin
  row?: number; // dragTo: target row for the piece origin
  targetId?: string; // pickTarget: the player to target
  specialType?: number | null; // setForcedSpecial: SpecialType, or null for normal play
  aiControlled?: boolean; // setAiControlled
}

export const EittrisCommandEndpoint: MessageEndpoint<EittrisCommandMessage, void> = {
  route: "/games/eittris/actions/command",
};

// ------------------------------------------------------------------------------------------
// Board Update - presenter -> ONE client (rides sendToEveryone with a
// per-player payload generator, so each phone only ever receives its own
// board).  Pushed only when that board actually changed this tick.
// ------------------------------------------------------------------------------------------
export const EittrisBoardUpdateEndpoint: MessageEndpoint<EittrisBoardSnapshot, void> = {
  route: "/games/eittris/lifecycle/board-update",
};

// ------------------------------------------------------------------------------------------
// Thumbnails - presenter -> everyone, one SHARED payload every ~1s (only when
// something changed): a 1-bit snapshot of every board for the phone target list.
// ------------------------------------------------------------------------------------------
export interface EittrisThumbnailEntry {
  playerId: string;
  name: string;
  avatarId: number;
  avatarColor: number;
  alive: boolean;
  thumb: string; // 36-char base64 of 210 packed bits (see eittrisLogic)
}

export interface EittrisThumbnailsMessage {
  players: EittrisThumbnailEntry[];
}

export const EittrisThumbnailsEndpoint: MessageEndpoint<EittrisThumbnailsMessage, void> = {
  route: "/games/eittris/lifecycle/thumbnails",
};

// ------------------------------------------------------------------------------------------
// Special Event - presenter -> everyone whenever a special fires, so phones
// can flash what just happened (who hit whom, and whether a shield ate it).
// ------------------------------------------------------------------------------------------
export interface EittrisSpecialEventMessage {
  type: number; // SpecialType
  attackerId: string;
  attackerName: string;
  victimId: string;
  victimName: string;
  repelled: boolean; // the victim's antidote shield turned it away
}

export const EittrisSpecialEventEndpoint: MessageEndpoint<EittrisSpecialEventMessage, void> = {
  route: "/games/eittris/gameplay/special-event",
};
