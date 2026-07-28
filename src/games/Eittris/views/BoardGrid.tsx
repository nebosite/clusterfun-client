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
  EittrisPiece,
  EMPTY_CELL,
  landingCells,
  PIECE_COLORS,
  psychoPalette,
  pieceCells,
} from "../models/eittrisLogic";

const FALLBACK_COLOR = "#101a2c"; // shown when no background image is supplied
const SPECIAL_ICON_COUNT = 16; // icons in assets/images/specials.png
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
}

export class BoardGrid extends React.Component<BoardGridProps> {
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

    // Marked blocks pulse (the original cycles rainbow) and wear their icon
    const specialAt = new Map<number, number>();
    for (const m of this.props.specials ?? []) specialAt.set(m.i, m.t);

    const cells: React.ReactNode[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const index = y * BOARD_WIDTH + x;
        const type = overlay.has(index) ? overlay.get(index)! : (grid[y]?.[x] ?? EMPTY_CELL);
        const filled = type !== EMPTY_CELL;
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
