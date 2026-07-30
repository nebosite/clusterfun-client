import React from "react";
import BoardGrid from "./BoardGrid";
import EittrisAssets from "../assets/Assets";
import {
  EittrisBoard,
  IMPLEMENTED_SPECIALS,
  SpecialType,
  collapseRows,
  effectiveIntervalMs,
  gravityStep,
  hardDrop,
  isOffensive,
  lockAndClear,
  makeBoard,
  nextAiMove,
  planPlacement,
  paintStencilRow,
  pieceCells,
  spawnNextFromQueue,
  stencilShapeFor,
  stencilCellFor,
  collides,
  jumbleOnce,
} from "../models/eittrisLogic";

// ==========================================================================================
// RobotDemo - a robot playing EITtris on the gathering screen, so the big screen shows the
// game rather than an empty waiting room while people are still finding the room code.
//
// Entirely self-contained and entirely cosmetic: its own board, its own clock, no messages,
// no presenter state.  Nothing here can affect a real game, which is the point - it runs
// while the host is still deciding the settings.
// ==========================================================================================

const AI_MOVE_MS = 90; // brisk, but you can still see it think
const ATTACK_EVERY_MS = 7000; // a powerup lands on the poor thing now and then
const RESTART_PAUSE_MS = 1400; // a beat on the wreckage before starting over

interface RobotDemoProps {
  cellPx: number;
}

interface RobotDemoState {
  board: EittrisBoard;
  lastHit: SpecialType | null;
}

export class RobotDemo extends React.Component<RobotDemoProps, RobotDemoState> {
  private frame?: number;
  private lastFrameMs = 0;
  private moveTimer = 0;
  private attackTimer = 0;
  private deadFor = 0;
  private random = () => Math.random();

  constructor(props: RobotDemoProps) {
    super(props);
    this.state = { board: this.freshBoard(), lastHit: null };
  }

  private freshBoard(): EittrisBoard {
    const board = makeBoard("demo", this.random);
    board.aiControlled = true;
    return board;
  }

  componentDidMount() {
    this.lastFrameMs = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  componentWillUnmount() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }

  private tick = () => {
    const now = performance.now();
    const dt = Math.min(100, now - this.lastFrameMs); // a backgrounded tab must not fast-forward
    this.lastFrameMs = now;
    const board = this.state.board;

    if (!board.alive) {
      this.deadFor += dt;
      if (this.deadFor >= RESTART_PAUSE_MS) {
        this.deadFor = 0;
        this.attackTimer = 0;
        this.setState({ board: this.freshBoard(), lastHit: null });
      }
      this.frame = requestAnimationFrame(this.tick);
      return;
    }

    this.stepGravity(board, dt);
    this.stepRobot(board, dt);
    this.stepAttack(board, dt);
    this.forceUpdate();
    this.frame = requestAnimationFrame(this.tick);
  };

  // Gravity, locking and clearing - the same rules the real game uses, minus
  // everything to do with other players.
  private stepGravity(board: EittrisBoard, dt: number) {
    if (!board.piece) {
      board.spawnDelayMs -= dt;
      if (board.spawnDelayMs <= 0) this.spawn(board);
      return;
    }
    board.intervalMs = gravityStep(board.intervalMs, dt / 1000);
    board.dropTimerMs += dt;
    const interval = effectiveIntervalMs(board.intervalMs, board.speedupStacks, 0);
    if (board.dropTimerMs < interval) return;
    board.dropTimerMs = 0;
    const moved = { ...board.piece, y: board.piece.y + 1 };
    if (collides(board.grid, pieceCells(moved))) this.lock(board);
    else board.piece = moved;
  }

  private lock(board: EittrisBoard) {
    const result = lockAndClear(board.grid, board.piece!);
    board.grid = result.grid;
    board.rows += result.cleared;
    board.score += result.scoreGained;
    board.piece = null;
    board.spawnDelayMs = 120;
  }

  private spawn(board: EittrisBoard) {
    const spawned = spawnNextFromQueue(board.nextQueue, this.random, board.evilPieces);
    board.nextQueue = spawned.queue;
    board.spawnDelayMs = 0;
    board.dropTimerMs = 0;
    if (collides(board.grid, pieceCells(spawned.piece))) board.alive = false;
    else board.piece = spawned.piece;
  }

  private stepRobot(board: EittrisBoard, dt: number) {
    if (!board.piece) return;
    this.moveTimer -= dt;
    if (this.moveTimer > 0) return;
    this.moveTimer = AI_MOVE_MS;
    // Same two-step brain the real bot uses: plan a landing spot, then take
    // one move toward it.  A null plan means nothing fits - just let it fall.
    const plan = planPlacement(board.grid, board.piece);
    if (!plan) return;
    const move = nextAiMove(board.piece, plan);
    if (move === "rotate") {
      const rotated = { ...board.piece, rot: (board.piece.rot + 1) % 4 };
      if (!collides(board.grid, pieceCells(rotated))) board.piece = rotated;
    } else if (move === "left" || move === "right") {
      const dx = move === "left" ? -1 : 1;
      const shifted = { ...board.piece, x: board.piece.x + dx };
      if (!collides(board.grid, pieceCells(shifted))) board.piece = shifted;
    } else {
      // Lined up: drop it and get on with the next one
      board.piece = hardDrop(board.grid, board.piece).piece;
      this.lock(board);
    }
  }

  // Every so often something lands on it, so the demo shows what powerups
  // actually look like rather than a tidy game of solitaire.
  private stepAttack(board: EittrisBoard, dt: number) {
    this.attackTimer += dt;
    if (this.attackTimer < ATTACK_EVERY_MS) return;
    this.attackTimer = 0;

    const pool = IMPLEMENTED_SPECIALS.filter(
      (type) => isOffensive(type) && type !== SpecialType.SwitchScreens,
    );
    const type = pool[Math.floor(this.random() * pool.length)];
    this.setState({ lastHit: type });

    switch (type) {
      case SpecialType.Speedup:
        board.speedupStacks++;
        break;
      case SpecialType.Jumble:
        for (let i = 0; i < 120; i++) board.grid = jumbleOnce(board.grid, this.random);
        break;
      case SpecialType.Psycho:
        board.psychoSeed = 1 + Math.floor(this.random() * 9999);
        break;
      case SpecialType.Transparency:
        board.transparency = true;
        break;
      case SpecialType.FreezeDried:
        board.freezeDried = true;
        break;
      case SpecialType.EvilPieces:
        board.evilPieces = true;
        break;
      case SpecialType.CrazyIvan:
        board.crazyIvan = true;
        break;
      default: {
        // The shape-painting attacks: drop the whole stencil in at once
        // rather than animating it, which keeps this loop simple.
        const shape = stencilShapeFor(type, this.random);
        if (!shape) break;
        const cell = stencilCellFor(type);
        let grid = board.grid;
        for (let row = 0; row < shape.length; row++) {
          grid = paintStencilRow(grid, shape, row, this.random() < 0.5, cell);
        }
        board.grid = collapseRows(grid, []);
        break;
      }
    }
  }

  render() {
    const { cellPx } = this.props;
    const { board, lastHit } = this.state;
    const backgrounds = EittrisAssets.images.backgrounds;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <BoardGrid
          grid={board.grid}
          piece={board.piece}
          cellPx={cellPx}
          backgroundUrl={backgrounds[board.backgroundIndex % backgrounds.length]}
          dimmed={!board.alive}
          specials={board.specials.map((m) => ({ i: m.index, t: m.type }))}
          specialsUrl={EittrisAssets.images.specials}
          freezeDried={board.freezeDried}
          transparency={board.transparency}
          psychoSeed={board.psychoSeed}
        />
        <span style={{ fontSize: "45%", opacity: 0.75 }}>
          {board.alive ? `Robot demo · ${board.rows} rows` : "Robot topped out..."}
          {lastHit !== null && board.alive ? ` · hit by ${SpecialType[lastHit]}` : ""}
        </span>
      </div>
    );
  }
}

export default RobotDemo;
