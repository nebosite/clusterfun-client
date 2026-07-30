// A dumb 10x21 board renderer shared by the presenter (mini boards) and the
// phone (the player's own board).  Pure presentation - all state comes in as
// props; parents are the observers.  Draws the original eitrix Grid background
// stretched behind the blocks (no grid lines) with a translucent dark overlay
// for readability.
import React from "react";
import EittrisAssets from "../assets/Assets";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  SPECIAL_ICON_COUNT,
  cellsLeftInEatenRow,
  fallProgress,
  finalRowDrops,
  EittrisPiece,
  EMPTY_CELL,
  landingCells,
  PIECE_COLORS,
  psychoPalette,
  pieceCells,
} from "../models/eittrisLogic";

const FALLBACK_COLOR = "#101a2c"; // shown when no background image is supplied
const SPECIAL_BLOCK_COLOR = "#4a4a4a"; // blocks hosting a powerup
const SHADOW_ALPHA = 0.25; // the original draws its landing ghost at 20%
const PSYCHO_TRAIL_ALPHA = 0.4; // and its psycho background at 40%

// A stable per-cell offset for FreezeDried, so blocks jitter but do not
// dance around every frame (the original picks it once per block)
function freezeJitter(index: number, cellPx: number): { x: number; y: number } {
  const h = Math.sin(index * 12.9898) * 43758.5453;
  const g = Math.sin(index * 78.233) * 12345.6789;
  const frac = (v: number) => v - Math.floor(v);
  return {
    x: Math.round((0.1 + frac(h) * 0.4) * cellPx),
    y: Math.round((0.1 + frac(g) * 0.4) * cellPx),
  };
}

interface BoardGridProps {
  grid: number[][];
  piece: EittrisPiece | null;
  cellPx: number;
  backgroundUrl?: string;
  dimmed?: boolean;
  // Specials sitting on settled blocks: cell index + SpecialType
  specials?: { i: number; t: number }[];
  specialsUrl?: string; // the 16-icon strip
  showShadow?: boolean; // SeeShadows: outline where the piece will land
  freezeDried?: boolean; // FreezeDried: settled blocks render tiny and jittered
  transparency?: boolean; // Transparency: settled blocks are ghosted outlines
  psychoSeed?: number; // Psycho: non-zero means the colors are lying
  psychoOverlay?: number[][] | null; // Psycho: per-cell palette indices
  // A row clear playing out: which rows are going, and how long each phase
  // lasts.  The component runs its own clock from the moment it first sees a
  // given clear, so the animation is smooth without streaming frames.
  clearing?: { rows: number[]; elapsedMs: number; eatMs: number; fallMs: number } | null;
}

interface BoardGridState {
  clearElapsedMs: number;
}

export class BoardGrid extends React.Component<BoardGridProps, BoardGridState> {
  state: BoardGridState = { clearElapsedMs: 0 };
  private clearFrame?: number;
  private clearStartedAt = 0;
  private animatingRows = "";

  componentDidUpdate() {
    this.syncClearAnimation();
  }
  componentDidMount() {
    this.syncClearAnimation();
  }
  componentWillUnmount() {
    if (this.clearFrame !== undefined) cancelAnimationFrame(this.clearFrame);
  }

  // Start a local clock the first time we see a particular clear, and stop it
  // when the clear is over.  Keyed on the rows so a second clear right after
  // the first is not mistaken for the same one still running.
  private syncClearAnimation() {
    const clearing = this.props.clearing;
    const key = clearing ? clearing.rows.join(",") : "";
    if (key === this.animatingRows) return;
    this.animatingRows = key;
    if (this.clearFrame !== undefined) cancelAnimationFrame(this.clearFrame);
    this.clearFrame = undefined;
    if (!clearing) {
      if (this.state.clearElapsedMs !== 0) this.setState({ clearElapsedMs: 0 });
      return;
    }
    // Start from wherever the host says it already is, so a late-arriving
    // update does not restart the animation from zero.
    this.clearStartedAt = performance.now() - clearing.elapsedMs;
    const step = () => {
      const elapsed = performance.now() - this.clearStartedAt;
      this.setState({ clearElapsedMs: elapsed });
      const total = clearing.eatMs + clearing.fallMs;
      if (elapsed < total && this.animatingRows === key) {
        this.clearFrame = requestAnimationFrame(step);
      }
    };
    this.clearFrame = requestAnimationFrame(step);
  }

  render() {
    const { grid, piece, cellPx, backgroundUrl, dimmed } = this.props;

    const overlay = new Map<number, number>();
    if (piece) {
      for (const c of pieceCells(piece)) {
        if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
          overlay.set(c.y * BOARD_WIDTH + c.x, piece.type);
        }
      }
    }

    // SeeShadows: where the piece would land.  Drawn as a ghost brick INSIDE
    // the cell - never as a border, which would grow the cell and push the
    // whole grid off its own footprint.
    const shadow = this.props.showShadow ? landingCells(grid, piece) : new Set<number>();

    // Psycho: a palette of 32 random colors both ends derive from the seed,
    // plus the per-cell indices carrying the falling piece's trails.
    const psychoOn = (this.props.psychoSeed ?? 0) > 0;
    const palette = psychoOn ? psychoPalette(this.props.psychoSeed!) : null;
    const trails = psychoOn ? (this.props.psychoOverlay ?? null) : null;

    // Chunky beveled brick: lit top/left edge, shaded bottom/right edge, a
    // soft inner glow, and a dark seam so blocks read individually.  Bevel
    // thickness scales with the cell so presenter minis look the same.
    const bevel = Math.max(1, Math.round(cellPx * 0.085));
    const inner = Math.max(1, Math.round(cellPx * 0.06));
    const blockShadow = [
      `inset ${bevel}px ${bevel}px 0 rgba(255, 255, 255, 0.22)`,
      `inset -${bevel}px -${bevel}px 0 rgba(0, 0, 0, 0.22)`,
      `inset 0 0 ${bevel * 2}px rgba(255, 255, 255, 0.12)`,
      `0 0 0 ${inner}px rgba(0, 0, 0, 0.55)`,
    ].join(", ");

    // ---- Row clear ----------------------------------------------------
    // Phase 1: the cleared rows are eaten away, left to right, while the grid
    // still holds them.  Phase 2: they are gone, and every row that dropped
    // into the gap is drawn back where it started, easing down under gravity.
    const clearing = this.props.clearing;
    const clearElapsed = this.state.clearElapsedMs;
    const eating = !!clearing && clearElapsed < clearing.eatMs;
    const clearedRowSet = new Set(clearing?.rows ?? []);
    const cellsLeft = clearing ? cellsLeftInEatenRow(clearElapsed, clearing.eatMs) : BOARD_WIDTH;
    // Indexed by FINAL row - the position we are actually drawing
    const dropAmounts = clearing && !eating ? finalRowDrops(clearing.rows) : [];
    const fallLeft = clearing
      ? 1 - fallProgress(clearElapsed - clearing.eatMs, clearing.fallMs)
      : 0;

    // Marked blocks pulse (the original cycles rainbow) and wear their icon
    const specialAt = new Map<number, number>();
    for (const m of this.props.specials ?? []) specialAt.set(m.i, m.t);

    const cells: React.ReactNode[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const index = y * BOARD_WIDTH + x;
        const type = overlay.has(index) ? overlay.get(index)! : (grid[y]?.[x] ?? EMPTY_CELL);
        let filled = type !== EMPTY_CELL;
        // A row being eaten empties from the left as the animation runs
        if (eating && clearedRowSet.has(y) && x >= cellsLeft) filled = false;
        // ...and once the rows are gone, whatever dropped into the gap is
        // lifted back to where it started and eased down.
        const drop = dropAmounts[y] ?? 0;
        const fallOffsetPx = drop > 0 ? -fallLeft * drop * cellPx : 0;
        const special = specialAt.get(index);
        // FreezeDried shrivels SETTLED blocks only - the falling piece stays
        // readable, which is what makes it so disorienting
        const isSettled = filled && !overlay.has(index);
        // Transparency reduces the settled stack to bare outlines - you can
        // still find the surface, but nothing about it is easy to read
        const ghosted = isSettled && this.props.transparency;
        const shrivelled = isSettled && this.props.freezeDried;
        const shrink = shrivelled ? 0.4 : 1;
        const jitter = shrivelled ? freezeJitter(index, cellPx) : null;

        // Psycho paints empty cells with whatever the overlay says, so the
        // background flickers between scrambles and the piece leaves a trail
        const trailColor =
          !filled && trails && palette ? palette[trails[y][x] % palette.length] : undefined;

        const blockColor =
          special !== undefined
            ? SPECIAL_BLOCK_COLOR
            : palette
              ? palette[type % palette.length]
              : PIECE_COLORS[type];

        // The white brick sprite stands in for both ghosts, and both are
        // drawn faintly.  A psycho trail underneath keeps its own alpha.
        const isLandingGhost = !filled && shadow.has(index);
        const ghostSprite = ghosted || isLandingGhost;
        const alpha = ghostSprite
          ? SHADOW_ALPHA
          : !filled && trailColor
            ? PSYCHO_TRAIL_ALPHA
            : undefined;

        cells.push(
          <div
            key={index}
            style={{
              width: cellPx * shrink,
              height: cellPx * shrink,
              boxSizing: "border-box",
              transform: fallOffsetPx ? `translateY(${fallOffsetPx}px)` : undefined,
              margin: jitter ? `${jitter.y}px 0 0 ${jitter.x}px` : undefined,
              // A block carrying a powerup is recolored dark gray so the
              // icon reads and the prize is obvious
              backgroundColor: ghosted
                ? "transparent"
                : filled
                  ? blockColor
                  : (trailColor ?? "transparent"),
              opacity: alpha,
              boxShadow: filled && !ghosted ? blockShadow : undefined,
              borderRadius: filled ? Math.max(1, Math.round(cellPx * 0.1)) : undefined,
              // Three things ride the same brick sprite: the landing ghost,
              // the Transparency outline, and (on top of a block) its icon.
              backgroundImage:
                special !== undefined && this.props.specialsUrl
                  ? `url(${this.props.specialsUrl})`
                  : ghostSprite
                    ? `url(${EittrisAssets.images.brick})`
                    : undefined,
              backgroundSize:
                special !== undefined ? `${SPECIAL_ICON_COUNT * 100}% 100%` : "100% 100%",
              backgroundPosition:
                special !== undefined
                  ? `${(special / (SPECIAL_ICON_COUNT - 1)) * 100}% 0%`
                  : undefined,
              backgroundRepeat: "no-repeat",
              animation:
                special !== undefined ? "eittrisSpecialPulse 1s ease-in-out infinite" : undefined,
            }}
          />,
        );
      }
    }

    return (
      <div
        style={{
          position: "relative",
          width: BOARD_WIDTH * cellPx,
          height: BOARD_HEIGHT * cellPx,
          backgroundColor: FALLBACK_COLOR,
          backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
          backgroundSize: "100% 100%",
          opacity: dimmed ? 0.35 : 1,
          touchAction: "none",
          userSelect: "none",
        }}
      >
        {/* subtle darkening so the colored blocks read against busy art */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.3)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${BOARD_WIDTH}, ${cellPx}px)`,
          }}
        >
          {cells}
        </div>
      </div>
    );
  }
}

export default BoardGrid;
