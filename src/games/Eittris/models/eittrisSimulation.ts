import Logger from "js-logger";
import {
  AFFLICTION_TIMERS,
  ANTIDOTE_CHANCE,
  ANTIDOTE_MAX,
  ANTIDOTE_DURATION_MS,
  BOARD_WIDTH,
  BRIDGE_COLUMN_MS,
  CLEAR_EAT_MS,
  EittrisBoard,
  EittrisPiece,
  EittrisSettings,
  JUMBLE_NUDGES,
  JUMBLE_NUDGE_MS,
  JUMBLE_TINKLE_EVERY,
  PSYCHO_COLOR_COUNT,
  SPECIAL_INTERVAL_MS,
  SPEED_MULTIPLIERS,
  STENCIL_ROW_MS,
  SWAP_COLUMN_MS,
  SpecialType,
  afflictionMsLeft,
  cureAfflictions,
  clearFallMs,
  collapseRows,
  collectAndShiftMarkers,
  collides,
  effectiveIntervalMs,
  emptyPsychoOverlay,
  gravityStep,
  hasAfflictions,
  isOffensive,
  jumbleOnce,
  liftPieceClear,
  lockAndClear,
  lockOnly,
  makeBridgePlan,
  maxRowDrop,
  nextAiMove,
  paintBridgeColumn,
  paintStencilRow,
  pickSpecialCell,
  pieceCells,
  planPlacement,
  pruneOrphanedSpecials,
  refillNextQueue,
  rollAllowedSpecial,
  spawnNextFromQueue,
  stampPsychoTrail,
  startAffliction,
  stencilCellFor,
  stencilShapeFor,
  swapColumn,
  tickAfflictions,
  tryMove,
  tryRotateCW,
  xorPsychoOverlay,
} from "./eittrisLogic";
import { AI_FAST_MULTIPLIER, AI_MOVE_INTERVAL_MS, SPAWN_DELAY_MS } from "./GameSettings";

// ==========================================================================================
// The EITtris board simulation, with no framework attached to it.
//
// This used to live on the presenter, which ran every board for everybody.  That made a
// player's own inputs take a round trip - phone to host and back - before their piece
// moved, which on anything but a perfect network is far too slow to play.  So the same
// simulation now runs in two places:
//
//   - each phone runs its OWN board, at full speed, with no network in the loop
//   - the presenter runs the ROBOT boards, which have no phone to run them
//
// Both get identical behaviour because both run this code.  Everything the simulation
// wants from the world outside one board - randomness, the host's settings, the other
// boards, and somewhere to send events - arrives through SimulationContext, so this file
// knows nothing about MobX, sessions or messages.
// ==========================================================================================

/** Everything the simulation wants to tell the world about.  All of it is optional noise
 *  as far as the rules are concerned: a board simulates correctly with no listener at all. */
export interface SimulationEvents {
  /** This board looks different now.  Drives redraws and, on a phone, reports upstream. */
  changed(board: EittrisBoard): void;
  /** A piece settled.  `bumped` means it was slammed rather than let down by gravity. */
  locked(board: EittrisBoard, bumped: boolean): void;
  rowsCleared(board: EittrisBoard, count: number): void;
  /** The cleared rows have just left the grid, before the stack falls.  Whoever is drawing
   *  this board animates the fall against the collapsed grid, so this is the moment it has
   *  to be looking at the new one. */
  clearCollapsed(board: EittrisBoard): void;
  /** A powerup was picked up off a cleared row (or awarded for four rows). */
  specialCollected(board: EittrisBoard, type: SpecialType): void;
  /** An OFFENSIVE powerup wants to go at this board's target.  Who applies it, and how it
   *  gets there, differs between the host and a phone - which is exactly why it is a
   *  callback rather than something this file decides. */
  fireSpecial(board: EittrisBoard, type: SpecialType): void;
  /** A defensive powerup the collector kept for themselves, worth announcing to the room. */
  selfSpecial(board: EittrisBoard, type: SpecialType): void;
  afflictionEnded(board: EittrisBoard, types: SpecialType[]): void;
  antidoteUsed(board: EittrisBoard): void;
  jumbleNudge(board: EittrisBoard): void;
  /** Topped out.  The host decides what that means for the game; the board is already dead. */
  died(board: EittrisBoard): void;
  /** A good moment to save state, if whoever owns this board saves state. */
  persist(): void;
}

/** A listener that ignores everything, so a caller can take only the parts it cares about. */
export const NO_EVENTS: SimulationEvents = {
  changed: () => {},
  locked: () => {},
  rowsCleared: () => {},
  clearCollapsed: () => {},
  specialCollected: () => {},
  fireSpecial: () => {},
  selfSpecial: () => {},
  afflictionEnded: () => {},
  antidoteUsed: () => {},
  jumbleNudge: () => {},
  died: () => {},
  persist: () => {},
};

export interface SimulationContext {
  settings: EittrisSettings;
  /** 0..1 */
  random(): number;
  /** Every board this simulator can see.  The host sees them all; a phone sees only its
   *  own, which is all SwitchScreens needs to know it has nobody to trade with. */
  boards(): EittrisBoard[];
  /** Dev "go fast": the robot thinks ten times as often so a whole game plays out quickly. */
  devFast: boolean;
  events: SimulationEvents;
}

// ------------------------------------------------------------------------------------------
// One board, one slice of time.  Everything that happens on its own - gravity, incoming
// attacks painting themselves in, timers running down, the robot thinking - happens here.
// ------------------------------------------------------------------------------------------
export function stepBoard(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  if (!board.alive) return;

  tickSpecials(board, dtMs, ctx);
  tickStencil(board, dtMs, ctx);
  tickBridge(board, dtMs, ctx);
  tickJumble(board, dtMs, ctx);
  tickSwap(board, dtMs, ctx);
  tickAi(board, dtMs, ctx);
  tickPsycho(board, ctx);
  tickAfflictionTimers(board, dtMs, ctx);

  // Everything above may have moved the grid out from under a powerup: a row collapsed, an
  // attack painted over the stack, a jumble shook it apart, a screen was swapped.  A powerup
  // belongs to a block, so any marker left without one is dropped here rather than floating
  // in mid-air forever.
  if (board.specials.length > 0) {
    const anchored = pruneOrphanedSpecials(board.grid, board.specials);
    if (anchored.length !== board.specials.length) {
      board.specials = anchored;
      ctx.events.changed(board);
    }
  }

  // A clear is playing out: nothing falls and nothing spawns until the rows have been eaten
  // and the stack has landed.
  if (board.clearing) {
    tickClearing(board, dtMs, ctx);
    return;
  }

  // The board is in the post-lock gap: nothing falls, and no command can touch anything,
  // until the next piece appears.
  if (!board.piece) {
    board.spawnDelayMs -= dtMs;
    // No piece and no remaining delay means the gap is over.  Testing for "> 0" here would
    // leave a board with a delay of exactly zero sitting empty forever - which is reachable
    // whenever a long frame eats the whole gap.
    if (board.spawnDelayMs <= 0) {
      board.spawnDelayMs = 0;
      spawnNextPiece(board, ctx);
    }
    return;
  }

  board.intervalMs = gravityStep(
    board.intervalMs,
    dtMs / 1000,
    SPEED_MULTIPLIERS[ctx.settings.speed] ?? 1,
  );
  board.dropTimerMs += dtMs;
  for (;;) {
    // Afflictions (Speedup) squeeze the natural curve without changing it
    const interval = effectiveIntervalMs(
      board.intervalMs,
      board.speedupStacks,
      board.slowdownStacks,
    );
    if (board.dropTimerMs < interval || !board.alive || !board.piece) break;
    board.dropTimerMs -= interval;
    const moved = tryMove(board.grid, board.piece, 0, 1);
    if (moved) {
      board.piece = moved;
    } else {
      // No lock delay: a gravity step that collides locks immediately
      lockCurrentPiece(board, false, ctx);
    }
    ctx.events.changed(board);
  }
}

// ------------------------------------------------------------------------------------------
// The row-clear animation.  Rows are eaten away first; when that finishes the grid really
// does collapse, the stack falls, and only then does the normal spawn gap begin.
// ------------------------------------------------------------------------------------------
function tickClearing(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  const clearing = board.clearing!;
  const before = clearing.elapsedMs;
  clearing.elapsedMs += dtMs;

  // The moment the eating finishes, take the rows out for real - BEFORE the fall animation
  // starts, so what is on screen is animating a grid the rows have already left.
  if (before < clearing.eatMs && clearing.elapsedMs >= clearing.eatMs) {
    // Collapse what is there NOW, not a snapshot taken at lock time - an attack may have
    // landed on this board while the rows were vanishing.
    board.grid = collapseRows(board.grid, clearing.rows);
    ctx.events.clearCollapsed(board);
  }

  const total = clearing.eatMs + clearing.fallMs;
  if (clearing.elapsedMs >= total) {
    board.clearing = null;
    // Carry any overshoot into the spawn gap rather than throwing it away, so a long frame
    // does not quietly add latency before the next piece.
    board.spawnDelayMs = SPAWN_DELAY_MS - (clearing.elapsedMs - total);
  }
  ctx.events.changed(board);
}

// Every affliction wears off on its own.  The board is only reported when the DISPLAYED
// second changes, so a countdown bar stays current without a report on every frame.
function tickAfflictionTimers(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  const secondsBefore = AFFLICTION_TIMERS.map((spec) =>
    Math.ceil(afflictionMsLeft(board, spec.type) / 1000),
  );
  const ended = tickAfflictions(board, dtMs, ctx.random);
  const changed = AFFLICTION_TIMERS.some(
    (spec, i) => Math.ceil(afflictionMsLeft(board, spec.type) / 1000) !== secondsBefore[i],
  );
  if (ended.length > 0 || changed) ctx.events.changed(board);
  if (ended.length > 0) ctx.events.afflictionEnded(board, ended);
}

// The falling piece smears its colour into the overlay as it travels, so an afflicted board
// fills up with translucent trails of wherever the pieces have been.
function tickPsycho(board: EittrisBoard, ctx: SimulationContext) {
  if (board.psychoSeed <= 0 || !board.psychoOverlay || !board.piece) return;
  board.psychoOverlay = stampPsychoTrail(board.psychoOverlay, board.piece);
  ctx.events.changed(board);
}

// Age the markers, run down an antidote shield, and tag a fresh settled block every so
// often.  With a dev-forced type the tag appears as soon as there is a block to put it on.
function tickSpecials(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  if (board.shieldMs > 0) {
    board.shieldMs = Math.max(0, board.shieldMs - dtMs);
    if (board.shieldMs === 0) ctx.events.changed(board);
  }

  // Several specials may sit on a board at once.  pickSpecialCell keeps them apart, so a
  // single piece can never set off two at the same time; if there is nowhere legal left,
  // none appears.
  board.specialTimerMs -= dtMs;
  if (board.specialTimerMs > 0) return;

  const index = pickSpecialCell(board.grid, board.specials, ctx.random);
  if (index === null) {
    // Nothing settled to tag yet - try again next tick (a forced special should land the
    // instant the player has a block)
    board.specialTimerMs = board.forcedSpecial === null ? SPECIAL_INTERVAL_MS : 0;
    return;
  }
  const type =
    board.forcedSpecial ??
    rollAllowedSpecial(ctx.random, ANTIDOTE_CHANCE, ctx.settings.allowedSpecials);
  board.specials.push({ index, type });
  board.specialTimerMs = SPECIAL_INTERVAL_MS;
  ctx.events.changed(board);
  ctx.events.persist();
}

// Paint an incoming attack into the board one row at a time, from the bottom up.
function tickStencil(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  const pending = board.pendingStencil;
  if (!pending) return;

  pending.timerMs -= dtMs;
  if (pending.timerMs > 0) return;
  pending.timerMs = STENCIL_ROW_MS;

  board.grid = paintStencilRow(
    board.grid,
    pending.shape,
    pending.row,
    pending.reverse,
    pending.blockCell,
  );
  pending.row++;
  if (pending.row >= pending.shape.length) board.pendingStencil = null;

  // Being buried can leave the falling piece inside solid blocks
  if (board.piece) {
    const lifted = liftPieceClear(board.grid, board.piece);
    if (lifted) board.piece = lifted;
    else killBoard(board, ctx); // buried with nowhere to go
  }
  ctx.events.changed(board);
  ctx.events.persist();
}

// Roof the victim's stack, one column at a time.
function tickBridge(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  const bridge = board.pendingBridge;
  if (!bridge) return;

  bridge.timerMs -= dtMs;
  if (bridge.timerMs > 0) return;
  bridge.timerMs = BRIDGE_COLUMN_MS;

  board.grid = paintBridgeColumn(board.grid, bridge);
  bridge.column++;
  if (bridge.column >= BOARD_WIDTH) board.pendingBridge = null;

  if (board.piece) {
    const lifted = liftPieceClear(board.grid, board.piece);
    if (lifted) board.piece = lifted;
    else killBoard(board, ctx);
  }
  ctx.events.changed(board);
  ctx.events.persist();
}

// Shake the stack apart a nudge at a time.
function tickJumble(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  if (board.jumbleLeft <= 0) return;
  board.jumbleTimerMs -= dtMs;
  if (board.jumbleTimerMs > 0) return;

  // Catch up if several nudges came due in one tick
  let budget = 12;
  while (board.jumbleLeft > 0 && board.jumbleTimerMs <= 0 && budget-- > 0) {
    board.grid = jumbleOnce(board.grid, ctx.random);
    board.jumbleLeft--;
    board.jumbleTimerMs += JUMBLE_NUDGE_MS;
    // Tinkle every so often rather than on every nudge - two hundred nudges in three
    // seconds would be a buzz, not a shower of blocks.
    if (board.jumbleLeft % JUMBLE_TINKLE_EVERY === 0) ctx.events.jumbleNudge(board);
  }
  ctx.events.changed(board);
  if (board.jumbleLeft <= 0) ctx.events.persist();
}

// Trade one column at a time with the target's board.  Only whoever can see both boards can
// run this, which in practice means the host.
function tickSwap(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  const swap = board.pendingSwap;
  if (!swap) return;
  const other = ctx.boards().find((b) => b.playerId === swap.otherId);
  if (!other || !other.alive) {
    board.pendingSwap = null; // nobody left to trade with
    return;
  }

  swap.timerMs -= dtMs;
  if (swap.timerMs > 0) return;
  swap.timerMs = SWAP_COLUMN_MS;

  const swapped = swapColumn(board.grid, other.grid, swap.column);
  board.grid = swapped.a;
  other.grid = swapped.b;
  swap.column++;
  if (swap.column >= BOARD_WIDTH) board.pendingSwap = null;

  // Either piece can end up buried by what just arrived
  for (const affected of [board, other]) {
    if (!affected.piece) continue;
    const lifted = liftPieceClear(affected.grid, affected.piece);
    if (lifted) affected.piece = lifted;
    else killBoard(affected, ctx);
    ctx.events.changed(affected);
  }
  ctx.events.persist();
}

// The computer player.  It only rotates and steps sideways, lining the piece up so gravity
// drops it where the planner wants.  It also knows to pop an antidote when afflicted.
function tickAi(board: EittrisBoard, dtMs: number, ctx: SimulationContext) {
  if (!board.aiControlled) return;
  board.aiTimerMs -= dtMs;
  if (board.aiTimerMs > 0) return;
  board.aiTimerMs = ctx.devFast ? AI_MOVE_INTERVAL_MS / AI_FAST_MULTIPLIER : AI_MOVE_INTERVAL_MS;

  // Cure first - playing well while afflicted is a losing game
  if (hasAfflictions(board) && board.antidotes > 0) {
    spendAntidote(board, ctx);
    return;
  }

  if (!board.piece) return; // nothing to steer during the spawn gap
  const plan = planPlacement(board.grid, board.piece);
  if (!plan) return;

  const move = nextAiMove(board.piece, plan);
  if (move === null) return; // lined up - let gravity finish

  let moved: EittrisPiece | null = null;
  if (move === "rotate") moved = tryRotateCW(board.grid, board.piece);
  else moved = tryMove(board.grid, board.piece, move === "left" ? -1 : 1, 0);

  if (moved) {
    board.piece = moved;
    ctx.events.changed(board);
  }
}

// ------------------------------------------------------------------------------------------
// Locking, clearing and spawning
// ------------------------------------------------------------------------------------------

/** Lock the falling piece, clear whatever rows that completed, and open the spawn gap. */
export function lockCurrentPiece(board: EittrisBoard, bumped: boolean, ctx: SimulationContext) {
  const result = lockAndClear(board.grid, board.piece!);
  // The grid keeps its cleared rows for now: they are eaten away on screen first, and only
  // then does the stack fall.  `clearing` below drives that.
  board.grid = result.cleared > 0 ? lockOnly(board.grid, board.piece!) : result.grid;
  board.score += result.scoreGained;
  board.rows += result.cleared;

  // Cleared rows hand over any specials sitting on them; markers above ride down with
  // their blocks
  const harvest = collectAndShiftMarkers(board.specials, result.clearedRows);
  board.specials = harvest.markers;
  for (const type of harvest.collected) collectSpecial(board, type, ctx);
  ctx.events.locked(board, bumped);
  if (result.cleared > 0) ctx.events.rowsCleared(board, result.cleared);

  // Clearing four rows wins whatever the host set as the award.  An offensive one flies at
  // your target; a defensive one is yours to keep.
  if (result.cleared >= 4) {
    const award = ctx.settings.fourRowAward;
    if (isOffensive(award)) ctx.events.fireSpecial(board, award);
    else collectSpecial(board, award, ctx);
  }

  // Open the no-piece gap.  The next piece appears later, which gives any in-flight gesture
  // nothing to act on.
  board.piece = null;
  board.dropTimerMs = 0;
  board.pieceSeq++;
  if (result.cleared > 0) {
    board.clearing = {
      rows: result.clearedRows.slice(),
      elapsedMs: 0,
      eatMs: CLEAR_EAT_MS,
      fallMs: clearFallMs(maxRowDrop(result.clearedRows)),
    };
    board.spawnDelayMs = 0;
  } else {
    board.spawnDelayMs = SPAWN_DELAY_MS;
  }

  ctx.events.changed(board);
  ctx.events.persist();
}

/** The gap expired: bring in the next piece.  A spawn that immediately collides is death. */
export function spawnNextPiece(board: EittrisBoard, ctx: SimulationContext) {
  const spawned = spawnNextFromQueue(board.nextQueue, ctx.random, board.evilPieces);
  board.nextQueue = spawned.queue;
  board.dropTimerMs = 0;
  board.pieceSeq++;
  // Psycho flips the whole background to a new scramble of itself with every new piece.
  // The palette is left alone so the trails the last piece drew stay the colour it drew them.
  if (board.psychoSeed > 0 && board.psychoOverlay) {
    const skew = Math.floor(ctx.random() * PSYCHO_COLOR_COUNT);
    board.psychoOverlay = xorPsychoOverlay(board.psychoOverlay, skew);
  }
  if (collides(board.grid, pieceCells(spawned.piece))) {
    killBoard(board, ctx);
  } else {
    board.piece = spawned.piece;
  }

  ctx.events.changed(board);
  ctx.events.persist();
}

/** This board is done.  Whoever owns the game decides what that means for the game. */
export function killBoard(board: EittrisBoard, ctx: SimulationContext) {
  if (!board.alive) return;
  board.piece = null;
  board.alive = false;
  board.pendingStencil = null;
  board.pendingBridge = null;
  board.jumbleLeft = 0;
  board.pendingSwap = null;
  ctx.events.died(board);
  ctx.events.changed(board);
}

// ------------------------------------------------------------------------------------------
// Powerups
// ------------------------------------------------------------------------------------------

/** A marked block was cleared: bank the effect, or send it at somebody. */
export function collectSpecial(board: EittrisBoard, type: SpecialType, ctx: SimulationContext) {
  ctx.events.specialCollected(board, type);

  if (isOffensive(type)) {
    ctx.events.fireSpecial(board, type);
    return;
  }

  // Defensive specials are kept by the collector
  switch (type) {
    case SpecialType.Antidote:
      board.antidotes = Math.min(ANTIDOTE_MAX, board.antidotes + 1);
      ctx.events.changed(board);
      break;
    case SpecialType.SeeShadows:
      // Earned for the rest of the round (the original never removes it)
      board.seeShadows = true;
      ctx.events.changed(board);
      ctx.events.selfSpecial(board, type);
      break;
    case SpecialType.CrystalBall:
      board.crystalBall = true;
      ctx.events.changed(board);
      ctx.events.selfSpecial(board, type);
      break;
    case SpecialType.SlowDown:
      // A gift to yourself: gentler gravity, and no antidote can wash it off
      board.slowdownStacks++;
      ctx.events.changed(board);
      ctx.events.selfSpecial(board, type);
      break;
    default:
      Logger.info(`Collected unimplemented special: ${SpecialType[type]}`);
  }
}

/**
 * Land an offensive powerup on a board.  Returns true if an antidote shield turned it away.
 *
 * This is the half of an attack that happens to the VICTIM, so it runs wherever the victim
 * is simulated: on the host for a robot, on the phone for a player.  `attacker` is only
 * needed by SwitchScreens, which touches both boards and so belongs to whoever has both.
 */
export function applyIncomingSpecial(
  victim: EittrisBoard,
  type: SpecialType,
  ctx: SimulationContext,
  attacker?: EittrisBoard,
): boolean {
  if (victim.shieldMs > 0) return true; // repelled

  switch (type) {
    case SpecialType.Speedup:
      victim.speedupStacks++;
      break;
    case SpecialType.SwitchScreens:
      // The attacker owns the swap, since it touches both boards.  With no attacker in
      // reach - a phone that only sees itself - there is nothing to trade with.
      if (attacker) attacker.pendingSwap = { otherId: victim.playerId, column: 0, timerMs: 0 };
      break;
    case SpecialType.Jumble:
      victim.jumbleLeft = JUMBLE_NUDGES;
      victim.jumbleTimerMs = 0;
      break;
    case SpecialType.Psycho:
      victim.psychoSeed = 1 + Math.floor(ctx.random() * 9999);
      victim.psychoOverlay = emptyPsychoOverlay();
      break;
    case SpecialType.Transparency:
      victim.transparency = true;
      break;
    case SpecialType.FreezeDried:
      victim.freezeDried = true;
      break;
    case SpecialType.CrazyIvan:
      victim.crazyIvan = true;
      break;
    case SpecialType.EvilPieces:
      victim.evilPieces = true;
      // Swap the preview for evil pieces at once, without ever emptying it
      victim.nextQueue = refillNextQueue(ctx.random, true);
      break;
    // Bridge lands on top of the stack, so it has its own painter
    case SpecialType.Bridge:
      victim.pendingBridge = makeBridgePlan(victim.grid, ctx.random);
      break;
    // Everything else paints a shape into the bottom of the board
    case SpecialType.TheWall:
    case SpecialType.Escalator:
    case SpecialType.Shackle:
    case SpecialType.TowerOfEit: {
      const shape = stencilShapeFor(type, ctx.random);
      if (!shape) return false;
      victim.pendingStencil = {
        shape,
        row: 0,
        reverse: ctx.random() < 0.5,
        timerMs: 0,
        blockCell: stencilCellFor(type),
      };
      break;
    }
    default:
      Logger.warn(`Unhandled offensive special: ${SpecialType[type]}`);
      return false;
  }
  // Start (or refresh) this affliction's clock.  One-shot attacks that just paint into the
  // board have no clock and are ignored here.
  startAffliction(victim, type);
  ctx.events.changed(victim);
  return false;
}

/** Spend a charge: cures everything on this board and repels incoming attacks for a while.
 *  Named "spend" rather than "use" on purpose - eslint's rules-of-hooks treats any function
 *  called useSomething as a React hook and fails the production build over it. */
export function spendAntidote(board: EittrisBoard, ctx: SimulationContext) {
  if (board.antidotes <= 0) return;
  board.antidotes--;
  // Wash off everything already applied, then shield against new hits.  cureAfflictions
  // refills the preview itself, so an EvilPieces victim is back on normal pieces without
  // the tray ever going empty.
  const ended = cureAfflictions(board, ctx.random);
  board.shieldMs = ANTIDOTE_DURATION_MS;
  ctx.events.antidoteUsed(board);
  if (ended.length > 0) ctx.events.afflictionEnded(board, ended);
  ctx.events.changed(board);
  ctx.events.persist();
}
