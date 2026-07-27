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
} from "libs";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  decodeGrid,
  decodeThumbnail,
  PIECE_COLORS,
  pieceCells,
  spawnPiece,
} from "../models/eittrisLogic";
import {
  DRAG_ACTIVATION_PX,
  FLICK_MAX_DURATION_MS,
  FLICK_MIN_DISTANCE_PX,
  TAP_MAX_DISTANCE_PX,
  TAP_MAX_DURATION_MS,
} from "../models/GameSettings";
import EittrisAssets from "../assets/Assets";
import BoardGrid from "./BoardGrid";

const CELL_PX = 66; // board cell size in the phone's 1080x1920 virtual space
const THUMB_CELL_PX = 3; // target-list thumbnail cell size

// -------------------------------------------------------------------
// GestureTracker - classifies pointer input over the board area:
//   free 2D drag -> dragTo(column, row): the piece follows the finger
//                   horizontally AND downward at once (never up)
//   pointer-up after a drag -> release (locks only if the piece is resting)
//   fast flick   -> slamLeft/slamRight/hardDrop/rotate by direction
//   tap          -> rotate
// Mouse and touch both arrive as pointer events.
// -------------------------------------------------------------------
class GestureTracker {
  private active = false;
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

  constructor(private model: EittrisClientModel) {}

  down(e: React.PointerEvent, boardRect: DOMRect | null) {
    this.active = true;
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

  // The piece we were steering is gone (locked by gravity, a release, or a
  // slam) - ignore the rest of this gesture until the finger lifts
  private checkStale(): boolean {
    if (this.stale) return true;
    if (this.model.pieceSeq !== this.startPieceSeq) {
      this.stale = true;
      return true;
    }
    return false;
  }

  move(e: React.PointerEvent) {
    if (!this.active || this.checkStale()) return;
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
    if (!this.active) return;
    this.active = false;
    // The piece was placed mid-gesture: swallow the flick/tap/release so it
    // can't act on the piece that just spawned
    if (this.checkStale()) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const duration = performance.now() - this.startTime;
    const distance = Math.hypot(dx, dy);

    // A fast far swipe is a flick - it replaces the release
    if (duration < FLICK_MAX_DURATION_MS && distance > FLICK_MIN_DISTANCE_PX) {
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

    // A quick touch that barely moved is a tap - rotate
    if (duration < TAP_MAX_DURATION_MS && distance < TAP_MAX_DISTANCE_PX) {
      this.model.rotate();
      return;
    }

    // Otherwise end the drag: lock if resting, else resume gravity
    if (this.dragSent) this.model.release();
  }

  cancel() {
    this.active = false;
  }
}

// A tiny preview of one upcoming piece type
class PiecePreview extends React.Component<{ type: number }> {
  render() {
    const { type } = this.props;
    const cells = pieceCells(spawnPiece(type, 0)).map((c) => ({ x: c.x - 5, y: c.y }));
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const size = 24;
    const filled = new Set(cells.map((c) => `${c.x - minX},${c.y - minY}`));

    const boxes: React.ReactNode[] = [];
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        boxes.push(
          <div
            key={`${x},${y}`}
            style={{
              width: size,
              height: size,
              backgroundColor: filled.has(`${x},${y}`) ? PIECE_COLORS[type] : "transparent",
            }}
          />,
        );
      }
    }
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(4, ${size}px)` }}>{boxes}</div>
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
class TargetList extends React.Component<{ appModel?: EittrisClientModel }> {
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
                <PlayerAvatar avatarId={p.avatarId} size={30} />
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

@inject("appModel")
@observer
class PlayingBoard extends React.Component<{ appModel?: EittrisClientModel }> {
  boardRef = React.createRef<HTMLDivElement>();
  tracker: GestureTracker;

  constructor(props: Readonly<{ appModel?: EittrisClientModel }>) {
    super(props);
    this.tracker = new GestureTracker(props.appModel!);
  }

  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const grid = decodeGrid(appModel.gridString);
    const dead = !appModel.alive;
    const backgrounds = EittrisAssets.images.backgrounds;
    const backgroundUrl = backgrounds[appModel.backgroundIndex % backgrounds.length];

    return (
      <div>
        <div className={styles.statusRow}>
          <span className={styles.score}>{appModel.score} pts</span>
          <span>{appModel.rows} rows</span>
          <span className={styles.nextLabel}>Next:</span>
          {appModel.nextTypes.map((type, i) => (
            <PiecePreview type={type} key={i} />
          ))}
        </div>
        <div className={styles.boardRow}>
          <div
            ref={this.boardRef}
            className={styles.boardArea}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              this.tracker.down(e, this.boardRef.current?.getBoundingClientRect() ?? null);
            }}
            onPointerMove={(e) => this.tracker.move(e)}
            onPointerUp={(e) => this.tracker.up(e)}
            onPointerCancel={() => this.tracker.cancel()}
          >
            <BoardGrid
              grid={grid}
              piece={appModel.piece}
              cellPx={CELL_PX}
              backgroundUrl={backgroundUrl}
              dimmed={dead}
            />
            {dead ? <div className={styles.toppedOut}>TOPPED OUT</div> : null}
          </div>
          <TargetList />
        </div>
        {!dead ? (
          <div className={styles.hintRow}>
            drag = move (down too) · tap/flick ↑ rotate · flick ⇄ slam · flick ↓ drop
          </div>
        ) : (
          <div className={styles.hintRow}>Waiting for the round to end...</div>
        )}
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
              <span className={classNames(styles.gametitle)}>EITtris</span>
              <span>
                <PlayerAvatar avatarId={appModel?.avatarId ?? 0} size={40} /> {appModel?.playerName}
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
