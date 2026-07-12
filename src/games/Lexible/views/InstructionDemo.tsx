import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import LetterBlock from "./LetterBlock";

// -------------------------------------------------------------------
// InstructionDemo
//
// Small, non-interactive LetterBlock grids that illustrate the three rules
// of play, built from throwaway LetterBlockModels so the instructions render
// in the Cozy tile style (replacing the old off-brand instructionN.png
// diagrams). Purely presentational — no game logic or state.
// -------------------------------------------------------------------

interface BlockSpec {
  team?: string;
  score?: number;
  selected?: boolean;
}

// Build a demo tile. Claimed tiles need a score (that's what marks them owned);
// selected tiles get the gold "being spelled" treatment.
function mk(letter: string, spec: BlockSpec = {}): LetterBlockModel {
  const block = new LetterBlockModel(letter);
  block.onSelectedChanged = () => {}; // demo tile: swallow the select callback
  if (spec.team && spec.score) block.setScore(spec.score, spec.team);
  if (spec.selected) block.selectForPlayer("demo", true);
  return block;
}

// Step 1 — spell a contiguous word: the middle row "CAT" is a gold path.
const STEP1: LetterBlockModel[][] = [
  [mk("R"), mk("O"), mk("B")],
  [mk("C", { selected: true }), mk("A", { selected: true }), mk("T", { selected: true })],
  [mk("M"), mk("E"), mk("D")],
];

// Step 2 — a longer word (TREAT, 5) claims a shorter scored enemy tile (E = 3).
const STEP2: LetterBlockModel[] = [
  mk("T", { selected: true }),
  mk("R", { selected: true }),
  mk("E", { team: "B", score: 3, selected: true }),
  mk("A", { selected: true }),
  mk("T", { selected: true }),
];

// Step 3 — a Team A (coral) bridge connecting left to right = a win.
const STEP3: LetterBlockModel[] = ["B", "R", "I", "D", "G", "E"].map((l) =>
  mk(l, { team: "A", score: 6 }),
);

const noop = () => {};

function DemoRow(props: { blocks: LetterBlockModel[]; size: number; showBadge?: boolean }) {
  return (
    <div style={{ display: "flex" }}>
      {props.blocks.map((b) => (
        <LetterBlock
          key={b.__blockid}
          context={b}
          onClick={noop}
          size={props.size}
          showBadge={props.showBadge}
        />
      ))}
    </div>
  );
}

export function InstructionDemo(props: { step: 1 | 2 | 3; size?: number }) {
  const size = props.size ?? 54;
  if (props.step === 1) {
    return (
      <div style={{ display: "inline-flex", flexDirection: "column" }}>
        {STEP1.map((row, i) => (
          <DemoRow key={i} blocks={row} size={size} />
        ))}
      </div>
    );
  }
  if (props.step === 2) {
    return <DemoRow blocks={STEP2} size={size} showBadge />;
  }
  return <DemoRow blocks={STEP3} size={size} />;
}
