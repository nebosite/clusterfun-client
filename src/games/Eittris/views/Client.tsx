// The phone view for EITtris: the player's own board, driven entirely by
// gestures (free 2D drag, flicks, tap-to-rotate), plus the target list with
// live 1-bit thumbnails of the other boards.
// The board state is a mirror of presenter pushes - NO game rules here.
import React from "react";
import { observer, inject } from "mobx-react";
import { EittrisClientModel, EittrisClientState } from "../models/ClientModel";
import styles from "./Client.module.css";
import classNames from "classnames";
import {
  UIProperties,
  GeneralGameState,
  SafeBrowser,
  GeneralClientGameState,
  UINormalizer,
  ErrorBoundary,
  PlayerAvatar,
  DevOnly,
} from "libs";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  classifyTap,
  SpecialType,
  SPECIAL_ICON_COUNT,
  AFFLICTION_TIMERS,
  AFFLICTION_DURATION_MS,
  ANTIDOTE_DURATION_MS,
  decodeGrid,
  decodePsychoOverlay,
  decodeThumbnail,
  IMPLEMENTED_SPECIALS,
  PIECE_COLORS,
  pieceCells,
  pieceColorIndex,
  spawnPiece,
  SPECIAL_NAMES,
} from "../models/eittrisLogic";
import {
  DRAG_ACTIVATION_PX,
  FLICK_MAX_DURATION_MS,
  FLICK_MIN_DISTANCE_PX,
  FLICK_REARM_MOVES,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_DURATION_MS,
} from "../models/GameSettings";
import EittrisAssets from "../assets/Assets";
import BoardGrid from "./BoardGrid";
import { GameInputController } from "libs";
import { GLOBALS } from "../../../Globals";
import { EITTRIS_BINDINGS, EITTRIS_KEY_HINTS, EittrisAction } from "../models/eittrisInput";

// Board cell size in the phone's 1080x1920 virtual space.  Chosen with the
// status strip's height so the grid's bottom edge lands exactly 15px above
// the bottom of the visible area (21 * 64 + 8px border + 553px above = 1905).
const CELL_PX = 64;
// In dev the special picker takes the title's place in the top bar
const IS_DEV = process.env.REACT_APP_DEVMODE === "development";
// A real keyboard is worth binding; a phone's on-screen one is not.  Coarse
// pointer + no hover is the standard "this is a touch device" signal.
const IS_DESKTOP =
  typeof window !== "undefined" &&
  !GLOBALS.IsMobile &&
  !window.matchMedia?.("(pointer: coarse)")?.matches;

// One line of plain English for a special that just fired
export function describeSpecialEvent(
  event: {
    type: number;
    attackerName: string;
    victimName: string;
    victimId: string;
    attackerId: string;
    repelled: boolean;
  },
  myId: string,
): string {
  const name = SPECIAL_NAMES[event.type] ?? "Special";
  const attacker = event.attackerId === myId ? "You" : event.attackerName;
  const victim = event.victimId === myId ? "you" : event.victimName;
  if (event.repelled) return `${attacker} sent ${name} at ${victim} - SHIELDED!`;
  return `${attacker} hit ${victim} with ${name}!`;
}
const THUMB_CELL_PX = 3; // target-list thumbnail cell size

// -------------------------------------------------------------------
// GestureTracker - classifies pointer input over the board area:
//   free 2D drag -> dragTo(column, row): the piece follows the finger
//                   horizontally AND downward at once (never up)
//   pointer-up after a drag -> release (locks only if the piece is resting)
//   fast flick   -> slamLeft/slamRight/hardDrop/rotate by direction
//   tap          -> rotate (anywhere on the grid - it always acts on the
//                   falling piece, so you never have to hit the piece itself)
//   double tap   -> drop the piece, exactly as a downward flick would
// Mouse and touch both arrive as pointer events.
// -------------------------------------------------------------------
class GestureTracker {
  // The pointer that owns the gesture in flight.  null means "no gesture" -
  // a NEW gesture can only start from a fresh pointer-down, so nothing can
  // ever carry over from the previous press.
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private startPieceX = 5;
  private startPieceY = 0;
  private startPieceSeq = 0;
  // Set when the piece this gesture was steering gets placed.  A stale
  // gesture sends nothing more - the finger must lift and press again, so
  // input can never leak onto the next piece.
  private stale = false;
  private dragSent = false;
  private lastSentColumn: number | null = null;
  private lastSentRow: number | null = null;
  private cellWidthPx = CELL_PX;
  private cellHeightPx = CELL_PX;
  // When the last tap landed, so the next one can be read as a double tap
  private lastTapTime: number | null = null;
  // Pointer-move events seen on the board since the last flick.  Flicks stay
  // disarmed until this reaches FLICK_REARM_MOVES, which kills the phantom
  // repeat you get when a flick's pointer-up lands off-screen.
  private movesSinceFlick = Number.MAX_SAFE_INTEGER;

  constructor(private model: EittrisClientModel) {}

  down(e: React.PointerEvent, boardRect: DOMRect | null) {
    // No piece on the board (the post-lock spawn gap): accept nothing at
    // all until the next piece appears
    if (!this.model.piece) return;
    // A second finger during a gesture is ignored.  A press from the SAME
    // pointer (a mouse always reuses id 1) means the previous gesture is
    // definitively over, so start fresh rather than resuming a stale one.
    if (this.pointerId !== null && this.pointerId !== e.pointerId) return;
    this.pointerId = e.pointerId;
    this.stale = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = performance.now();
    this.startPieceX = this.model.piece?.x ?? 5;
    this.startPieceY = this.model.piece?.y ?? 0;
    this.startPieceSeq = this.model.pieceSeq;
    this.dragSent = false;
    this.lastSentColumn = null;
    this.lastSentRow = null;
    // Quantize by the on-screen board size (UINormalizer scales the layout)
    this.cellWidthPx = (boardRect?.width ?? BOARD_WIDTH * CELL_PX) / BOARD_WIDTH;
    this.cellHeightPx = (boardRect?.height ?? BOARD_HEIGHT * CELL_PX) / BOARD_HEIGHT;
  }

  // End the gesture.  Until the next pointer-down, every event is ignored.
  private end() {
    this.pointerId = null;
    this.stale = false;
    this.dragSent = false;
    this.lastSentColumn = null;
    this.lastSentRow = null;
  }

  // The piece we were steering is gone (locked by gravity, a release, or a
  // slam) - ignore the rest of this gesture until the finger lifts
  private checkStale(): boolean {
    if (this.stale) return true;
    // No piece at all (spawn gap), or a different piece than we started on
    if (!this.model.piece || this.model.pieceSeq !== this.startPieceSeq) {
      this.stale = true;
      return true;
    }
    return false;
  }

  move(e: React.PointerEvent) {
    // Count every move over the board, even ones outside a gesture - this is
    // what re-arms flicking
    if (this.movesSinceFlick < FLICK_REARM_MOVES) this.movesSinceFlick++;
    if (this.pointerId !== e.pointerId) return;
    // With a mouse, pointermove keeps firing after the button is released.
    // If we ever miss a pointerup (lost capture, released off-element), this
    // catches it so the gesture can't run on into the next piece.
    if (e.buttons === 0) {
      this.end();
      return;
    }
    if (this.checkStale()) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.dragSent && Math.hypot(dx, dy) < DRAG_ACTIVATION_PX) return;

    // Free 2D target: columns follow the finger both ways, rows only downward
    const targetColumn = this.startPieceX + Math.round(dx / this.cellWidthPx);
    const targetRow = this.startPieceY + Math.max(0, Math.floor(dy / this.cellHeightPx));
    if (targetColumn !== this.lastSentColumn || targetRow !== this.lastSentRow) {
      this.lastSentColumn = targetColumn;
      this.lastSentRow = targetRow;
      this.dragSent = true;
      this.model.dragTo(targetColumn, targetRow);
    }
  }

  up(e: React.PointerEvent) {
    if (this.pointerId !== e.pointerId) return;
    const wasStale = this.checkStale();
    const dragSent = this.dragSent;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const duration = performance.now() - this.startTime;
    const distance = Math.hypot(dx, dy);
    // Close the gesture FIRST - whatever we send below is the last thing this
    // press can do
    this.end();

    // The piece was placed mid-gesture: swallow the flick/tap/release so it
    // can't act on the piece that just spawned
    if (wasStale) return;

    // A fast far swipe is a flick - it replaces the release
    if (duration < FLICK_MAX_DURATION_MS && distance > FLICK_MIN_DISTANCE_PX) {
      // Disarmed until the board has seen a few moves since the last flick,
      // so a flick that ended off-screen can't fire a second time
      if (this.movesSinceFlick < FLICK_REARM_MOVES) return;
      this.movesSinceFlick = 0;
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx < 0) this.model.slamLeft();
        else this.model.slamRight();
      } else if (dy > 0) {
        this.model.hardDrop();
      } else {
        this.model.rotate();
      }
      return;
    }

    // A quick touch that barely moved is a tap.  It works anywhere on the
    // grid and always acts on the falling piece; a second one close behind it
    // is a double tap, which drops.
    if (duration < TAP_MAX_DURATION_MS && distance < TAP_MAX_DISTANCE_PX) {
      const now = performance.now();
      const sinceLastTap = this.lastTapTime === null ? null : now - this.lastTapTime;
      const action = classifyTap(!!this.model.piece, sinceLastTap);
      if (action === "drop") {
        // Consumed - a third tap starts a fresh pair rather than dropping again
        this.lastTapTime = null;
        this.model.doubleTapDrop();
      } else if (action === "rotate") {
        this.lastTapTime = now;
        this.model.rotate();
      }
      return;
    }
    // Anything that was not a tap breaks up a would-be double tap
    this.lastTapTime = null;

    // Otherwise end the drag: lock if resting, else resume gravity
    if (dragSent) this.model.release();
  }

  cancel() {
    this.end();
  }
}

// A tiny preview of one upcoming piece type
class PiecePreview extends React.Component<{ type: number; evil?: boolean }> {
  render() {
    const { type, evil } = this.props;
    const cells = pieceCells(spawnPiece(type, 0, evil)).map((c) => ({ x: c.x - 5, y: c.y }));
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const maxX = Math.max(...cells.map((c) => c.x));
    const maxY = Math.max(...cells.map((c) => c.y));
    // Only the piece's own footprint, so the tray can center it
    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const size = 24;
    const filled = new Set(cells.map((c) => `${c.x - minX},${c.y - minY}`));
    // While EvilPieces is on, the tray has to show the piece you will actually
    // get - shape AND color come from the evil table, not the normal one
    const color = PIECE_COLORS[pieceColorIndex({ type, rot: 0, x: 0, y: 0, evil })];

    const boxes: React.ReactNode[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        boxes.push(
          <div
            key={`${x},${y}`}
            style={{
              width: size,
              height: size,
              backgroundColor: filled.has(`${x},${y}`) ? color : "transparent",
            }}
          />,
        );
      }
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, ${size}px)` }}>
        {boxes}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// ThumbnailView - renders a 1-bit board snapshot on a tiny canvas
// -------------------------------------------------------------------
class ThumbnailView extends React.Component<{ thumb: string }> {
  canvasRef = React.createRef<HTMLCanvasElement>();

  componentDidMount() {
    this.draw();
  }
  componentDidUpdate() {
    this.draw();
  }

  private draw() {
    const canvas = this.canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#0a1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#9fd6ff";
    const cells = decodeThumbnail(this.props.thumb);
    for (let index = 0; index < cells.length; index++) {
      if (cells[index]) {
        const x = index % BOARD_WIDTH;
        const y = Math.floor(index / BOARD_WIDTH);
        ctx.fillRect(x * THUMB_CELL_PX, y * THUMB_CELL_PX, THUMB_CELL_PX, THUMB_CELL_PX);
      }
    }
  }

  render() {
    return (
      <canvas
        ref={this.canvasRef}
        width={BOARD_WIDTH * THUMB_CELL_PX}
        height={BOARD_HEIGHT * THUMB_CELL_PX}
        className={styles.thumbCanvas}
      />
    );
  }
}

// -------------------------------------------------------------------
// TargetList - the other players with live thumbnails; tap to target
// -------------------------------------------------------------------
@inject("appModel")
@observer
export class TargetList extends React.Component<{ appModel?: EittrisClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return null;
    const others = appModel.roster.filter((p) => p.playerId !== appModel.playerId);
    if (others.length === 0) return null;

    return (
      <div className={styles.targetList}>
        {others.map((p) => {
          const isTarget = p.playerId === appModel.targetId;
          return (
            <div
              key={p.playerId}
              className={classNames(styles.targetEntry, {
                [styles.targetCurrent]: isTarget,
                [styles.targetDead]: !p.alive,
              })}
              onClick={() => {
                if (p.alive) appModel.pickTarget(p.playerId);
              }}
            >
              <ThumbnailView thumb={p.thumb} />
              <div className={styles.targetInfo}>
                <PlayerAvatar avatarId={p.avatarId} colorIndex={p.avatarColor} size={30} />
                <span className={styles.targetName}>{p.name}</span>
                {isTarget ? <span className={styles.targetTag}>TARGET</span> : null}
                {!p.alive ? <span className={styles.targetDeadTag}>OUT</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// AfflictionChip - one status chip.  Anything with a clock on it carries a
// countdown bar along its bottom edge, so you can see how much longer you
// have to live with it (or how much shield is left) without reading numbers.
// The bar eases over 1s because that is how often the presenter re-sends the
// board while a timer is running.
// -------------------------------------------------------------------
interface ChipInfo {
  label: string;
  tone: "bad" | "good";
  iconIndex?: number; // position in the 16-icon specials strip
  msLeft?: number;
  totalMs?: number;
}

class AfflictionChip extends React.Component<ChipInfo> {
  render() {
    const { label, tone, iconIndex, msLeft, totalMs } = this.props;
    const timed = msLeft !== undefined && totalMs !== undefined && totalMs > 0;
    const fraction = timed ? Math.max(0, Math.min(1, msLeft! / totalMs!)) : 0;
    return (
      <span
        className={classNames(styles.afflictionChip, {
          [styles.afflictionBad]: tone === "bad",
          [styles.afflictionGood]: tone === "good",
        })}
      >
        {iconIndex === undefined ? null : (
          <span
            className={styles.specialIcon}
            style={{
              backgroundImage: `url(${EittrisAssets.images.specials})`,
              backgroundPosition: `${(iconIndex / (SPECIAL_ICON_COUNT - 1)) * 100}% 0%`,
            }}
          />
        )}
        {label}
        {timed ? <span className={styles.chipSeconds}>{Math.ceil(msLeft! / 1000)}s</span> : null}
        {timed ? (
          <span className={styles.chipTimerTrack}>
            <span className={styles.chipTimerBar} style={{ width: `${fraction * 100}%` }} />
          </span>
        ) : null}
      </span>
    );
  }
}

@inject("appModel")
@observer
class PlayingBoard extends React.Component<
  { appModel?: EittrisClientModel },
  { hasGamepad: boolean }
> {
  boardRef = React.createRef<HTMLDivElement>();
  tracker: GestureTracker;
  input: GameInputController;

  constructor(props: Readonly<{ appModel?: EittrisClientModel }>) {
    super(props);
    this.state = { hasGamepad: false };
    this.tracker = new GestureTracker(props.appModel!);
    // Keyboard and controller, on top of the touch gestures - a player at a PC
    // should not have to drag a piece around with a mouse.
    this.input = new GameInputController(EITTRIS_BINDINGS, {
      onAction: this.handleInputAction,
      onGamepadChange: (connected) => this.setState({ hasGamepad: connected }),
    });
  }

  componentDidMount() {
    this.input.attach();
  }

  componentWillUnmount() {
    this.input.detach();
  }

  // -------------------------------------------------------------------
  // handleInputAction - one place mapping an abstract action to the model.
  // The presenter refuses everything during the post-lock gap anyway, but
  // there is no point sending into it.
  // -------------------------------------------------------------------
  private handleInputAction = (action: string) => {
    const appModel = this.props.appModel;
    if (!appModel) return;
    // The antidote and target keys work even with no piece on the board;
    // everything else needs one.
    if (action === EittrisAction.UseAntidote) {
      appModel.useAntidote();
      return;
    }
    if (action === EittrisAction.NextTarget) {
      appModel.cycleTarget(1);
      return;
    }
    if (action === EittrisAction.PrevTarget) {
      appModel.cycleTarget(-1);
      return;
    }
    if (!appModel.piece || !appModel.alive) return;
    switch (action) {
      case EittrisAction.MoveLeft:
        appModel.moveLeft();
        break;
      case EittrisAction.MoveRight:
        appModel.moveRight();
        break;
      case EittrisAction.MoveDown:
        appModel.moveDown();
        break;
      case EittrisAction.Drop:
        appModel.hardDrop();
        break;
      case EittrisAction.RotateRight:
        appModel.rotate();
        break;
      case EittrisAction.RotateLeft:
        appModel.rotateLeft();
        break;
    }
  };

  // Everything currently showing in the status strip, in a fixed order so
  // chips do not jump around as they come and go.
  afflictionChips(): ChipInfo[] {
    const appModel = this.props.appModel!;
    const left = (type: SpecialType) => {
      const index = AFFLICTION_TIMERS.findIndex((spec) => spec.type === type);
      return index < 0 ? undefined : appModel.afflictionMs[index];
    };
    const timed = (type: SpecialType) => ({
      msLeft: left(type),
      totalMs: AFFLICTION_DURATION_MS,
    });
    const chips: ChipInfo[] = [];
    if (appModel.speedupStacks > 0) {
      chips.push({
        label: `SPEEDUP x${appModel.speedupStacks}`,
        tone: "bad",
        iconIndex: SpecialType.Speedup,
        ...timed(SpecialType.Speedup),
      });
    }
    if (appModel.psychoSeed > 0) {
      chips.push({
        label: "PSYCHO",
        tone: "bad",
        iconIndex: SpecialType.Psycho,
        ...timed(SpecialType.Psycho),
      });
    }
    if (appModel.transparency) {
      chips.push({
        label: "INVISIBLE",
        tone: "bad",
        iconIndex: SpecialType.Transparency,
        ...timed(SpecialType.Transparency),
      });
    }
    if (appModel.freezeDried) {
      chips.push({
        label: "FREEZE DRIED",
        tone: "bad",
        iconIndex: SpecialType.FreezeDried,
        ...timed(SpecialType.FreezeDried),
      });
    }
    if (appModel.crazyIvan) {
      chips.push({
        label: "REVERSED",
        tone: "bad",
        iconIndex: SpecialType.CrazyIvan,
        ...timed(SpecialType.CrazyIvan),
      });
    }
    if (appModel.evilPieces) {
      chips.push({
        label: "EVIL PIECES",
        tone: "bad",
        iconIndex: SpecialType.EvilPieces,
        ...timed(SpecialType.EvilPieces),
      });
    }
    // Self-buffs: no clock, they are yours for the rest of the round
    if (appModel.slowdownStacks > 0) {
      chips.push({
        label: `SLOWED x${appModel.slowdownStacks}`,
        tone: "good",
        iconIndex: SpecialType.SlowDown,
      });
    }
    if (appModel.seeShadows) {
      chips.push({ label: "SHADOWS", tone: "good", iconIndex: SpecialType.SeeShadows });
    }
    if (appModel.shieldMs > 0) {
      chips.push({
        label: "SHIELDED",
        tone: "good",
        iconIndex: SpecialType.Antidote,
        msLeft: appModel.shieldMs,
        totalMs: ANTIDOTE_DURATION_MS,
      });
    }
    return chips;
  }

  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const grid = decodeGrid(appModel.gridString);
    const psychoOverlay = appModel.psychoOverlay
      ? decodePsychoOverlay(appModel.psychoOverlay)
      : null;
    const dead = !appModel.alive;
    const backgrounds = EittrisAssets.images.backgrounds;
    const backgroundUrl = backgrounds[appModel.backgroundIndex % backgrounds.length];

    return (
      <div>
        <div className={styles.statusRow}>
          <span className={styles.score}>{appModel.score} pts</span>
          <span>{appModel.rows} rows</span>
        </div>
        {/* Fixed-height strip: afflictions + the transient event banner.
            It always occupies the same space so the board never shifts. */}
        <div className={styles.statusArea}>
          <div className={styles.afflictionRow}>
            {this.afflictionChips().map((chip) => (
              <AfflictionChip key={chip.label} {...chip} />
            ))}
          </div>
          <div className={styles.bannerRow}>
            {appModel.lastSpecialEvent ? (
              <span
                className={classNames(styles.specialBanner, {
                  [styles.specialBannerHit]:
                    appModel.lastSpecialEvent.victimId === appModel.playerId &&
                    !appModel.lastSpecialEvent.repelled,
                  [styles.specialBannerRepel]: appModel.lastSpecialEvent.repelled,
                })}
              >
                <span
                  className={styles.specialIcon}
                  style={{
                    backgroundImage: `url(${EittrisAssets.images.specials})`,
                    backgroundPosition: `${(appModel.lastSpecialEvent.type / (SPECIAL_ICON_COUNT - 1)) * 100}% 0%`,
                  }}
                />
                {describeSpecialEvent(appModel.lastSpecialEvent, appModel.playerId)}
              </span>
            ) : null}
          </div>
        </div>
        <div className={styles.powerRow}>
          <button
            className={classNames(styles.antidoteButton, {
              [styles.antidoteReady]: appModel.antidotes > 0,
            })}
            disabled={appModel.antidotes < 1}
            onClick={() => appModel.useAntidote()}
          >
            {/* One icon per charge, rather than a number to read: at a glance
                you can see how many you have without parsing text. */}
            {Array.from({ length: Math.max(0, appModel.antidotes) }, (_, i) => (
              <span
                key={i}
                className={styles.antidoteIcon}
                style={{
                  backgroundImage: `url(${EittrisAssets.images.specials})`,
                  backgroundPosition: `${(SpecialType.Antidote / (SPECIAL_ICON_COUNT - 1)) * 100}% 0%`,
                }}
              />
            ))}
            {appModel.antidotes === 0 ? (
              <span className={styles.antidoteEmpty}>Antidote</span>
            ) : null}
          </button>
          {dead ? <span className={styles.hintRow}>Waiting for the round to end...</span> : null}
          <div className={styles.nextBox}>
            <span className={styles.nextLabel}>Next</span>
            <div className={styles.nextPieces}>
              {appModel.nextTypes.map((type, i) => (
                <PiecePreview type={type} evil={appModel.evilPieces} key={i} />
              ))}
            </div>
          </div>
        </div>
        <div className={styles.boardRow}>
          <div
            ref={this.boardRef}
            className={styles.boardArea}
            onPointerDown={(e) => {
              // Capture keeps move/up coming to this element even if the
              // finger leaves the board - best-effort, never fatal
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              this.tracker.down(e, this.boardRef.current?.getBoundingClientRect() ?? null);
            }}
            onPointerMove={(e) => this.tracker.move(e)}
            onPointerUp={(e) => this.tracker.up(e)}
            onPointerCancel={() => this.tracker.cancel()}
            // If capture is lost mid-gesture (re-render, browser quirk), drop
            // the gesture rather than letting it run on
            onLostPointerCapture={() => this.tracker.cancel()}
          >
            <BoardGrid
              grid={grid}
              piece={appModel.piece}
              cellPx={CELL_PX}
              backgroundUrl={backgroundUrl}
              dimmed={dead}
              specials={appModel.specials.slice()}
              specialsUrl={EittrisAssets.images.specials}
              showShadow={appModel.seeShadows}
              freezeDried={appModel.freezeDried}
              transparency={appModel.transparency}
              psychoSeed={appModel.psychoSeed}
              psychoOverlay={psychoOverlay}
              clearing={appModel.clearing}
            />
            {dead ? <div className={styles.toppedOut}>TOPPED OUT</div> : null}
          </div>
          <TargetList />
        </div>
        {/* Controls, shown only where they apply: a phone with no pad attached
            never sees them, and they cost a line on a PC where they are the
            only way to know the keys exist. */}
        {IS_DESKTOP || this.state.hasGamepad ? (
          <div className={styles.keyHints}>
            {this.state.hasGamepad ? (
              <span className={styles.keyHint}>
                <b>Controller ready</b> d-pad move · A/B rotate · ↑ drop · LB/RB target · X antidote
              </span>
            ) : null}
            {IS_DESKTOP
              ? EITTRIS_KEY_HINTS.map((hint) => (
                  <span className={styles.keyHint} key={hint.action + hint.label}>
                    <b>{hint.label}</b> {hint.keys}
                  </span>
                ))
              : null}
          </div>
        ) : null}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: EittrisClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;

  // -------------------------------------------------------------------
  // Vibrate on state changes so players look at their phones
  // -------------------------------------------------------------------
  alertUser() {
    const { appModel } = this.props;
    if (appModel!.gameState !== this.lastState) {
      SafeBrowser.vibrate([50, 50, 50, 50]);
    }
    this.lastState = appModel!.gameState as string;
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;

    switch (appModel!.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return (
          <div>
            <div className={styles.wait_text}>
              Sit tight, we are waiting for the host to start the game...
            </div>
            <div className={styles.instructions}>
              <div style={{ fontWeight: 700 }}>How to play:</div>
              <p>Use your finger to control and place pieces</p>
            </div>
          </div>
        );
      case EittrisClientState.Playing:
      case EittrisClientState.Dead:
        this.alertUser();
        return <PlayingBoard />;
      case GeneralGameState.GameOver:
        return (
          <div>
            {appModel!.youWon ? (
              <div className={styles.celebration}>
                <div className={styles.celebrationTrophy}>🏆</div>
                <div className={styles.celebrationText}>YOU WIN!</div>
              </div>
            ) : (
              <p>Game over! {appModel!.winnerName ? `Winner: ${appModel!.winnerName}` : ""}</p>
            )}
            <div>
              <button onClick={() => this.props.appModel!.quitApp()}>Quit</button>
            </div>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <p>Could not join the game because: {this.props.appModel!.joinError}</p>;

      default:
        return <div>These are not the droids you are looking for...</div>;
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    return (
      <div>
        <UINormalizer
          uiProperties={this.props.uiProperties}
          virtualHeight={1920}
          virtualWidth={1080}
        >
          <div className={styles.gameclient}>
            <div className={classNames(styles.divRow, styles.topbar)}>
              <DevOnly>
                <select
                  className={styles.devSelect}
                  value={appModel?.forcedSpecial === null ? "" : String(appModel?.forcedSpecial)}
                  onChange={(e) =>
                    appModel?.setForcedSpecial(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">(normal random)</option>
                  {IMPLEMENTED_SPECIALS.map((t) => (
                    <option value={String(t)} key={t}>
                      {SPECIAL_NAMES[t]}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.devButton}
                  disabled={appModel?.forcedSpecial === null}
                  title="Collect the selected special right now"
                  onClick={() => appModel?.fireSelectedSpecial()}
                >
                  Attack
                </button>
                <label className={styles.devCheck}>
                  <input
                    type="checkbox"
                    checked={!!appModel?.aiControlled}
                    onChange={(e) => appModel?.setAiControlled(e.target.checked)}
                  />
                  CPU
                </label>
              </DevOnly>
              {IS_DEV ? null : <span className={classNames(styles.gametitle)}>EITtris</span>}
              <span>
                <PlayerAvatar
                  avatarId={appModel?.avatarId ?? 0}
                  colorIndex={appModel?.avatarColor}
                  size={40}
                />{" "}
                {appModel?.playerName}
              </span>
              <button className={classNames(styles.quitbutton)} onClick={() => appModel?.quitApp()}>
                X
              </button>
            </div>
            <div style={{ margin: "40px" }}>
              <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
            </div>
          </div>
        </UINormalizer>
      </div>
    );
  }
}
