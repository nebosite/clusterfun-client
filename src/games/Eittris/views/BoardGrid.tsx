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
  PIECE_COLORS,
  pieceCells,
} from "../models/eittrisLogic";

const FALLBACK_COLOR = "#101a2c"; // shown when no background image is supplied

interface BoardGridProps {
  grid: number[][];
  piece: EittrisPiece | null;
  cellPx: number;
  backgroundUrl?: string;
  dimmed?: boolean;
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

    // Chunky beveled brick: lit top/left edge, shaded bottom/right edge, a
    // soft inner glow, and a dark seam so blocks read individually.  Bevel
    // thickness scales with the cell so presenter minis look the same.
    const bevel = Math.max(2, Math.round(cellPx * 0.17));
    const inner = Math.max(1, Math.round(cellPx * 0.06));
    const blockShadow = [
      `inset ${bevel}px ${bevel}px 0 rgba(255, 255, 255, 0.45)`,
      `inset -${bevel}px -${bevel}px 0 rgba(0, 0, 0, 0.45)`,
      `inset 0 0 ${bevel * 2}px rgba(255, 255, 255, 0.25)`,
      `0 0 0 ${inner}px rgba(0, 0, 0, 0.55)`,
    ].join(", ");

    const cells: React.ReactNode[] = [];
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const index = y * BOARD_WIDTH + x;
        const type = overlay.has(index) ? overlay.get(index)! : (grid[y]?.[x] ?? EMPTY_CELL);
        const filled = type !== EMPTY_CELL;
        cells.push(
          <div
            key={index}
            style={{
              width: cellPx,
              height: cellPx,
              backgroundColor: filled ? PIECE_COLORS[type] : "transparent",
              boxShadow: filled ? blockShadow : undefined,
              borderRadius: filled ? Math.max(1, Math.round(cellPx * 0.1)) : undefined,
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
