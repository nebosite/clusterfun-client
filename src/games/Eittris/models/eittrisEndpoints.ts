import MessageEndpoint from "libs/messaging/MessageEndpoint";
import { EittrisBoard, EittrisPiece, EittrisSettings } from "./eittrisLogic";

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
  // The 210-char encoded settled grid.  Sent only when it has actually changed - most
  // updates are just the falling piece moving, and the settled stack only changes when
  // a piece locks or an attack lands.  Omitted means "the same as last time", so a
  // phone must keep the last one it was given.
  grid?: string;
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
  crystalBall: boolean; // see three pieces ahead
  evilPieces: boolean; // drawing from the evil piece table
  crazyIvan: boolean; // controls are mirrored
  freezeDried: boolean; // settled blocks render tiny and jittered
  transparency: boolean; // settled blocks are invisible
  // Milliseconds left on each affliction, in AFFLICTION_TIMERS order, so the
  // phone can draw a countdown bar on every status chip.
  afflictionMs: number[];
  // A row clear playing out.  Sent once, with its durations, rather than a
  // frame at a time - each screen animates locally off its own clock.
  clearing: { rows: number[]; elapsedMs: number; eatMs: number; fallMs: number } | null;
  psychoSeed: number; // non-zero = colors are scrambled with this seed
  // Psycho's per-cell palette indices, 210 chars, one per cell.  Only sent
  // while the affliction is on - null otherwise, so it costs nothing normally.
  psychoOverlay: string | null;
  shieldMs: number; // remaining antidote shield (0 = inactive)
  forcedSpecial: number | null; // dev selector echo
  aiControlled: boolean; // dev: the computer is playing this board
}

// ------------------------------------------------------------------------------------------
// Onboard Client - full own-board rebuild on join/rejoin/invalidate (req/resp)
// ------------------------------------------------------------------------------------------
export interface EittrisOnboardClientMessage {
  gameState: string;
  // The full line-up, so a phone that joins or reconnects mid-game can make sense of
  // the indexes in every thumbnail broadcast that follows.
  roster: EittrisRosterEntry[];
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
  | "rotate" // clockwise (a tap, or the CW key/button)
  | "rotateCCW" // counter-clockwise (keyboard/controller only)
  | "moveLeft" // one column, from a key or pad - NOT a slam
  | "moveRight"
  | "moveDown" // one row, the soft drop
  | "pickTarget"
  | "useAntidote" // fire a stored antidote (cure + shield)
  | "setForcedSpecial" // DEV ONLY: pin which special spawns
  | "setAiControlled" // DEV ONLY: let the computer play this board
  | "fireSpecial"; // DEV ONLY: collect the selected special right now

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
// Who is playing.  None of this changes while a game runs, so it is sent when the
// line-up changes and not once a second forever - it was more than half the cost of
// the thumbnail broadcast, which is the heaviest thing EITtris puts on the wire.
export interface EittrisRosterEntry {
  playerId: string;
  name: string;
  avatarId: number;
  avatarColor: number;
}

// What one board looks like now.  `i` indexes the roster.
export interface EittrisThumbnailEntry {
  i: number;
  alive: boolean;
  thumb: string; // 36-char base64 of 210 packed bits (see eittrisLogic)
}

/** Identity and board state merged back together - what a phone actually draws. */
export interface EittrisRosterView extends EittrisRosterEntry {
  alive: boolean;
  thumb: string;
}

export interface EittrisThumbnailsMessage {
  // Present only when the line-up changed; otherwise the phone keeps the one it has.
  roster?: EittrisRosterEntry[];
  // Only the boards that actually changed since the last broadcast.
  boards: EittrisThumbnailEntry[];
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

// ==========================================================================================
// The phone owns its own board
//
// A player's inputs used to travel to the host and back before their piece moved, which is
// unplayable on anything but a perfect network.  Each phone now simulates its own board and
// tells the host what happened, rather than asking the host what happens.
//
// The host is still the one screen everybody watches, so it needs enough to draw every
// board and play the sounds - but it is a viewer of a player's board now, not its author.
// ==========================================================================================

/** Something worth a sound, a flash, or the host's attention, as it happened on a phone. */
export type EittrisReportEvent =
  | { kind: "locked"; bumped: boolean }
  | { kind: "rowsCleared"; count: number }
  | { kind: "collected"; special: number }
  | { kind: "selfSpecial"; special: number }
  /** An offensive powerup this player just set off, aimed at `targetId`. */
  | { kind: "fire"; special: number; targetId: string | null }
  /** An attack that arrived and was applied - or bounced off an antidote shield. */
  | { kind: "hit"; special: number; attackerId: string; repelled: boolean }
  | { kind: "afflictionEnded"; types: number[] }
  | { kind: "antidoteUsed" }
  | { kind: "jumbleNudge" }
  | { kind: "slammed" }
  | { kind: "died" };

/**
 * One phone's account of its own board.  `board` is exactly the snapshot the host used to
 * send the other way, so the host can draw it with the same code it already had.
 *
 * Sent no more often than REPORT_INTERVAL_MS, with everything that happened since the last
 * one batched into `events` - so a burst of activity costs one message, not ten.
 */
export interface EittrisBoardReportMessage {
  board: EittrisBoardSnapshot;
  events: EittrisReportEvent[];
}

export const EittrisBoardReportEndpoint: MessageEndpoint<EittrisBoardReportMessage, void> = {
  route: "/games/eittris/actions/board-report",
};

/**
 * An attack on its way to the player who has to live with it.  The victim applies it the
 * moment it arrives - nothing waits for the host to agree - and says in its next report
 * whether its antidote shield ate it.
 */
export interface EittrisDeliverSpecialMessage {
  special: number;
  attackerId: string;
  attackerName: string;
}

export const EittrisDeliverSpecialEndpoint: MessageEndpoint<EittrisDeliverSpecialMessage, void> = {
  route: "/games/eittris/lifecycle/deliver-special",
};

/**
 * The host telling a phone to start playing its own board: here are the rules, off you go.
 * Sent when a game starts, and again on a restart into the same room.
 */
export interface EittrisStartPlayingMessage {
  settings: EittrisSettings;
  /** Who this phone is aiming at to begin with, if anyone. */
  targetId: string | null;
  /**
   * A board already in progress, handed back.  Absent at the start of a game, when the
   * phone makes its own; present when somebody rejoins and takes their seat back from the
   * robot that was keeping it warm.  Without it the returning player would own a board
   * they had never been given, and nothing would move.
   */
  board?: EittrisBoard;
}

export const EittrisStartPlayingEndpoint: MessageEndpoint<EittrisStartPlayingMessage, void> = {
  route: "/games/eittris/lifecycle/start-playing",
};
