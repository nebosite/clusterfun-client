import React from "react";
import { render } from "@testing-library/react";
import BoardGrid from "./BoardGrid";
import { BOARD_HEIGHT, BOARD_WIDTH, emptyGrid } from "../models/eittrisLogic";

// The board renderer is where several afflictions actually live - what they do
// IS how they look - so the rules worth pinning are the visual ones.

function gridWithBlocks(): number[][] {
  const grid = emptyGrid();
  for (let x = 0; x < BOARD_WIDTH; x++) grid[BOARD_HEIGHT - 1][x] = 1;
  return grid;
}

// Every cell of the board, in order
function cells(container: HTMLElement): HTMLElement[] {
  const grid = Array.from(container.querySelectorAll("div")).find(
    (d) => d.children.length === BOARD_WIDTH * BOARD_HEIGHT,
  );
  return Array.from(grid!.children) as HTMLElement[];
}

const settledCells = (container: HTMLElement) =>
  cells(container).slice((BOARD_HEIGHT - 1) * BOARD_WIDTH);

describe("BoardGrid - Transparency", () => {
  it("draws settled blocks as an outline with nothing inside", () => {
    const { container } = render(
      <BoardGrid grid={gridWithBlocks()} piece={null} cellPx={20} transparency />,
    );
    for (const cell of settledCells(container)) {
      // A border...
      expect(cell.style.border).toMatch(/solid/);
      // ...and a middle you can see straight through
      expect(cell.style.backgroundColor).toBe("transparent");
      // no ghost brick filling it in
      expect(cell.style.backgroundImage === "" || cell.style.backgroundImage === "undefined").toBe(
        true,
      );
    }
  });

  it("leaves the falling piece alone - only the settled stack goes", () => {
    const piece = { type: 0, rot: 0, x: 5, y: 3, evil: false };
    const { container } = render(
      <BoardGrid grid={gridWithBlocks()} piece={piece} cellPx={20} transparency />,
    );
    // A T with its box at 5,3 puts its bump at (6,3) and its flat row across (5..7,4)
    const pieceCell = cells(container)[3 * BOARD_WIDTH + 6];
    expect(pieceCell.style.backgroundColor).not.toBe("transparent");
    expect(pieceCell.style.border).toBe("");
  });

  it("draws normal blocks solid when the affliction is off", () => {
    const { container } = render(<BoardGrid grid={gridWithBlocks()} piece={null} cellPx={20} />);
    for (const cell of settledCells(container)) {
      expect(cell.style.backgroundColor).not.toBe("transparent");
      expect(cell.style.border).toBe("");
    }
  });
});

describe("BoardGrid - the row-clear animation", () => {
  it("draws the whole row until the eating starts", () => {
    const { container } = render(
      <BoardGrid
        grid={gridWithBlocks()}
        piece={null}
        cellPx={20}
        clearing={{ rows: [BOARD_HEIGHT - 1], elapsedMs: 0, eatMs: 300, fallMs: 150 }}
      />,
    );
    const filled = settledCells(container).filter(
      (c) => c.style.backgroundColor !== "transparent" && c.style.backgroundColor !== "",
    );
    expect(filled.length).toBe(BOARD_WIDTH);
  });

  it("does not offset anything while the rows are still being eaten", () => {
    const { container } = render(
      <BoardGrid
        grid={gridWithBlocks()}
        piece={null}
        cellPx={20}
        clearing={{ rows: [BOARD_HEIGHT - 1], elapsedMs: 0, eatMs: 300, fallMs: 150 }}
      />,
    );
    expect(cells(container).some((c) => c.style.transform)).toBe(false);
  });
});

describe("BoardGrid - an earthquake's stack coming down", () => {
  // The grid is already collapsed by the time this is drawn; the fall is entirely a matter
  // of where each block is DRAWN on the way to where it already is.
  const drops = () => {
    const d: number[] = new Array(BOARD_WIDTH * BOARD_HEIGHT).fill(0);
    d[(BOARD_HEIGHT - 1) * BOARD_WIDTH] = 3; // the bottom-left block fell three rows
    d[(BOARD_HEIGHT - 1) * BOARD_WIDTH + 1] = 1;
    return d;
  };

  it("lifts each block back by its own drop", () => {
    const { container } = render(
      <BoardGrid
        grid={gridWithBlocks()}
        piece={null}
        cellPx={20}
        quakeFall={{ drops: drops(), elapsedMs: 0, fallMs: 400 }}
      />,
    );
    const bottom = cells(container).slice((BOARD_HEIGHT - 1) * BOARD_WIDTH);
    // Three rows up, one row up, and everything else where it belongs
    expect(bottom[0].style.transform).toBe("translateY(-60px)");
    expect(bottom[1].style.transform).toBe("translateY(-20px)");
    expect(bottom[2].style.transform).toBe("");
  });

  it("draws every block in place once the fall is over", () => {
    const { container } = render(
      <BoardGrid grid={gridWithBlocks()} piece={null} cellPx={20} quakeFall={null} />,
    );
    for (const cell of cells(container)) expect(cell.style.transform).toBe("");
  });
});
