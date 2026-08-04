import { observer } from "mobx-react";
import React from "react";
import { LetterGridModel } from "../models/LetterGridModel";
import { applyHomeConnections } from "../models/teamAreas";
import LetterBlock from "./LetterBlock";
import styles from "./InstructionDemo.module.css";

// ==========================================================================================
// InstructionDemo — a 6x6 board that plays the rule it is explaining, on a loop.
//
// It replaced a set of still pictures.  Three of Lexible's rules are about MOVEMENT - letters
// picked up in a chain, a tile changing hands, a bridge growing across the board - and a still
// frame has to be decoded before it means anything, while the same thing animated is
// understood without reading the caption at all.
//
// It drives the REAL LetterGridModel through the REAL LetterBlock, so the demo tiles are the
// game's tiles: the same colours, the same score ramp, the same team outline, and the same
// capture firework.  Nothing here is a drawing of the game; if the board changes this changes
// with it, and if it looks wrong here it looks wrong in play too.
//
// Purely presentational - no session, no messages, no game state.  Used by the presenter and
// by the phones.
// ==========================================================================================

/** One frame of the loop: what the named cells look like, and how long to hold it. */
interface DemoFrame {
  /** "x,y" -> team + score. Any claimed cell NOT listed goes back to neutral. */
  cells?: Record<string, { team: string; score: number }>;
  /** "x,y" cells drawn as part of the word currently being spelled. */
  selected?: string[];
  /** "x,y" cells just taken off the other team - these throw the firework. */
  stolen?: string[];
  /** Stamp WIN! across the board while this frame is held. */
  win?: boolean;
  holdMs: number;
}

const SIZE = 6;

/** The letters never change; only ownership and selection do. */
const LETTERS = ["BRIDGE", "OTANLS", "ACSEIT", "TRIPED", "SEALOR", "TENDIM"];

/** Where each team starts, mirroring the real board: column 0, A on odd rows, B on even. */
const HOME: Record<string, { team: string; score: number }> = {
  "0,0": { team: "B", score: 4 },
  "0,1": { team: "A", score: 4 },
  "0,2": { team: "B", score: 4 },
  "0,3": { team: "A", score: 4 },
  "0,4": { team: "B", score: 4 },
  "0,5": { team: "A", score: 4 },
};

const claim = (cells: string[], team: string, score: number) =>
  Object.fromEntries(cells.map((c) => [c, { team, score }]));

// ==========================================================================================
// The three steps tell ONE STORY on ONE BOARD, in order:
//
//   1. Team A spells TRIP out of its own home tile and claims it.
//   2. Team B takes all of it back with STRIP - the same word, one letter longer, with the S
//      prepended from B's home tile directly below the T.
//   3. Team B extends that to TRIPLED, which reaches the far column, and wins.
//
// Carrying the state forward is what makes the rules land.  Step 2 is not an abstract example
// of capturing, it is the word you just watched being taken; step 3's bridge is built out of
// the tiles you watched change hands.  The letters are laid out so all of this is a legal path
// on a real board - TRIP along row 3, S at (0,4) directly under the T, and L/E/D reachable
// from the P.
// ==========================================================================================

/** TRIP: A's home tile at (0,3), then east along row 3. */
const TRIP = ["0,3", "1,3", "2,3", "3,3"];
/** STRIP: B's home tile at (0,4), then up onto the T and east over A's word. */
const STRIP = ["0,4", ...TRIP];
/** TRIPLED: down to the L at (3,4), diagonally back up to the E, then the D on the far edge. */
const TRIPLED = [...TRIP, "3,4", "4,3", "5,3"];

// -------------------------------------------------------------------
// Step 1 — words start from your own territory.
//
// The chain grows one letter at a time out of an A home tile, then lands as claimed
// territory.  The pause on the finished word is what makes the claim read as a consequence
// rather than a cut.
// -------------------------------------------------------------------
const A_TRIP = claim(TRIP, "A", 4);
const STEP1: DemoFrame[] = [
  { holdMs: 800 },
  { selected: TRIP.slice(0, 1), holdMs: 340 },
  { selected: TRIP.slice(0, 2), holdMs: 340 },
  { selected: TRIP.slice(0, 3), holdMs: 340 },
  { selected: TRIP, holdMs: 800 },
  { selected: [], cells: A_TRIP, holdMs: 1800 },
];

// -------------------------------------------------------------------
// Step 2 — a longer word takes it straight back.
//
// Opens on exactly where step 1 left off: TRIP, team A, score 4.  B prepends one letter from
// its own home square and the whole word changes hands, because 5 beats 4.  Four tiles come
// off the other team, so four fireworks - the S was already B's and gets none.
// -------------------------------------------------------------------
const STEP2: DemoFrame[] = [
  { cells: A_TRIP, holdMs: 1100 },
  { cells: A_TRIP, selected: STRIP.slice(0, 1), holdMs: 380 },
  { cells: A_TRIP, selected: STRIP.slice(0, 2), holdMs: 380 },
  { cells: A_TRIP, selected: STRIP.slice(0, 3), holdMs: 340 },
  { cells: A_TRIP, selected: STRIP.slice(0, 4), holdMs: 340 },
  { cells: A_TRIP, selected: STRIP, holdMs: 800 },
  { selected: [], cells: claim(STRIP, "B", 5), stolen: TRIP, holdMs: 2200 },
];

// -------------------------------------------------------------------
// Step 3 — the bridge, and the win.
//
// Opens on step 2's result and stretches it into TRIPLED, which puts team B on the far
// column.  Nothing is stolen here - the extra letters are unclaimed ground - so the moment is
// carried by the outline closing across the whole row and then the WIN! stamp.
// -------------------------------------------------------------------
const B_STRIP = claim(STRIP, "B", 5);
const B_TRIPLED = { ...claim(["0,4"], "B", 5), ...claim(TRIPLED, "B", 7) };
const STEP3: DemoFrame[] = [
  { cells: B_STRIP, holdMs: 1000 },
  { cells: B_STRIP, selected: TRIPLED.slice(0, 4), holdMs: 420 },
  { cells: B_STRIP, selected: TRIPLED.slice(0, 5), holdMs: 380 },
  { cells: B_STRIP, selected: TRIPLED.slice(0, 6), holdMs: 380 },
  { cells: B_STRIP, selected: TRIPLED, holdMs: 900 },
  { selected: [], cells: B_TRIPLED, holdMs: 1200 },
  { cells: B_TRIPLED, win: true, holdMs: 2000 },
];

const SCRIPTS: Record<number, DemoFrame[]> = { 1: STEP1, 2: STEP2, 3: STEP3 };

const noop = () => {};

/** A fresh 6x6 board with the home column seeded, in the wire format populate() expects. */
function buildGrid(): LetterGridModel {
  let deck = "";
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const home = HOME[`${x},${y}`];
      deck += LETTERS[y][x] + (home ? home.team : "_") + String(home ? home.score : 0);
    }
  }
  const grid = new LetterGridModel(SIZE, SIZE);
  grid.populate(deck);
  grid.processBlocks((b) => (b.onSelectedChanged = noop)); // demo tile: swallow the callback
  applyHomeConnections(grid);
  return grid;
}

export function applyFrame(grid: LetterGridModel, frame: DemoFrame) {
  grid.processBlocks((b) => {
    const key = `${b.coordinates.x},${b.coordinates.y}`;
    // Every frame states the whole board, so looping back to frame 0 cleans up after the
    // last one without needing an explicit reset step that could be forgotten.
    const spec = frame.cells?.[key] ?? HOME[key];
    b.setScore(spec ? spec.score : 0, spec ? spec.team : "_");
    b.selectForPlayer("demo", (frame.selected ?? []).includes(key));
  });
  // The outline is the game's own, recomputed from the board - so what the demo shows about
  // "tiles connect only if they share a side" is the rule itself, not a picture of it.
  applyHomeConnections(grid);
  for (const key of frame.stolen ?? []) {
    const [x, y] = key.split(",").map(Number);
    grid.rows[y][x].capture();
  }
}

export const InstructionDemo = observer(function InstructionDemo(props: {
  step: 1 | 2 | 3;
  size?: number;
}) {
  const size = props.size ?? 44;
  const grid = React.useMemo(() => buildGrid(), []);
  const script = SCRIPTS[props.step] ?? STEP1;
  const [showWin, setShowWin] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let at = 0;

    const step = () => {
      if (cancelled) return;
      const frame = script[at % script.length];
      applyFrame(grid, frame);
      setShowWin(!!frame.win);
      at++;
      timer = setTimeout(step, frame.holdMs);
    };
    step();

    // Turning the page while a demo is mid-loop must stop it, or the timers pile up one per
    // visit and the board starts flickering between two scripts.
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [grid, script]);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", position: "relative" }}>
      {grid.rows.map((row, y) => (
        <div key={y} style={{ display: "flex" }}>
          {row.map((block) => (
            <LetterBlock
              key={block.__blockid}
              context={block}
              onClick={noop}
              size={size}
              showBadge
            />
          ))}
        </div>
      ))}
      {showWin ? (
        // Sized off the tiles so the stamp is the same shape on a phone and on a wall.
        <div
          className={styles.winStamp}
          style={{ fontSize: `${size * 0.9}px`, padding: `${size * 0.18}px 0` }}
        >
          WIN!
        </div>
      ) : null}
    </div>
  );
});

/** Exposed for tests: the scripts, so a rule cannot silently drift out of its own demo. */
export const DEMO_SCRIPTS = SCRIPTS;
export const DEMO_HOME = HOME;
export const DEMO_SIZE = SIZE;
export { buildGrid as buildDemoGrid };
