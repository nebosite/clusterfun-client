// A dumb 10x21 board renderer shared by the presenter (mini boards) and the
// phone (the player's own board).  Pure presentation - all state comes in as
// props; parents are the observers.  Draws the original eitrix Grid background
// stretched behind the blocks (no grid lines) with a translucent dark overlay
// for readability.
import React from "react";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  EittrisPiece,
  EMPTY_CELL,
  hardDrop,
  PIECE_COLORS,
  pieceCells,
} from "../models/eittrisLogic";

const FALLBACK_COLOR = "#101a2c"; // shown when no background image is supplied
const SPECIAL_ICON_COUNT = 16; // icons in assets/images/specials.png
const SPECIAL_BLOCK_COLOR = "#4a4a4a"; // blocks hosting a powerup

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
  transparency?: boolean; // Transparency: settled blocks are invisible
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

    // SeeShadows: a faint outline of where the piece would come to rest
    const shadow = new Set<number>();
    if (piece && this.props.showShadow) {
      const landed = hardDrop(grid, piece).piece;
      for (const c of pieceCells(landed)) {
        if (c.y >= 0 && c.y < BOARD_HEIGHT && c.x >= 0 && c.x < BOARD_WIDTH) {
          const index = c.y * BOARD_WIDTH + c.x;
          if (!overlay.has(index)) shadow.add(index);
        }
      }
    }

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
        // Transparency hides the settled stack completely - only the falling
        // piece remains visible
        const hidden = isSettled && this.props.transparency;
        const shrivelled = isSettled && this.props.freezeDried;
        const shrink = shrivelled ? 0.4 : 1;
        const jitter = shrivelled ? freezeJitter(index, cellPx) : null;
        cells.push(
          <div
            key={index}
            style={{
              width: cellPx * shrink,
              height: cellPx * shrink,
              margin: jitter ? `${jitter.y}px 0 0 ${jitter.x}px` : undefined,
              // A block carrying a powerup is recolored dark gray so the
              // icon reads and the prize is obvious
              backgroundColor: hidden
                ? "transparent"
                : filled
                  ? special !== undefined
                    ? SPECIAL_BLOCK_COLOR
                    : PIECE_COLORS[type]
                  : "transparent",
              // the landing ghost sits under everything else
              border:
                !filled && shadow.has(index)
                  ? `${Math.max(1, Math.round(cellPx * 0.08))}px solid ${PIECE_COLORS[piece!.type]}66`
                  : undefined,
              boxShadow: filled && !hidden ? blockShadow : undefined,
              borderRadius: filled ? Math.max(1, Math.round(cellPx * 0.1)) : undefined,
              // The icon rides on top of the block it marks
              backgroundImage:
                special !== undefined && this.props.specialsUrl
                  ? `url(${this.props.specialsUrl})`
                  : undefined,
              backgroundSize:
                special !== undefined ? `${SPECIAL_ICON_COUNT * 100}% 100%` : undefined,
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
