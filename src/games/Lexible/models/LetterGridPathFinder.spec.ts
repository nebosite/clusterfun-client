import { expect } from "chai";
import { LetterGridModel } from "./LetterGridModel";
import { LetterGridPathFinder } from "./LetterGridPathFinder";
import { LexibleScoredWordMessage } from "./Messages";

function generateFullyRandomGrid(width: number, height: number, nextRandom: () => number) {
    const LETTERS = "QWERTYUIOPASDFGHJKLZXCVBNM";
    const TEAMS = "_AB"
    const SCORES = "0123456789";
    let letterDeck = "";
    for (let i = 0; i < width * height; i++) {
        letterDeck += LETTERS.charAt(Math.floor(LETTERS.length * nextRandom()));
        letterDeck += TEAMS.charAt(Math.floor(TEAMS.length * nextRandom()));
        letterDeck += SCORES.charAt(Math.floor(SCORES.length * nextRandom()));
    }
    const grid = new LetterGridModel(width, height);
    grid.populate(letterDeck);
    return grid;
}

describe("LetterGridPathFinder tests", () => {
    describe("Flooded grids", () => {
        const GRID_WIDTH = 7;
        const GRID_HEIGHT = 8;
        const testCases = [
            ["A", "_0", "neutral"],
            ["B", "_0", "neutral"],
            ["A", "A3", "ally"],
            ["B", "A3", "enemy"],
            ["A", "B3", "enemy"],
            ["B", "B3", "ally"],
        ]
        const gridDescription: Record<string, string> = {
            "_0": "a fully empty grid",
            "A3": "a grid conqueured by team A",
            "B3": "a grid conqueured by team B"
        }
        for (const testCase of testCases) {
            it(`Identifies ${gridDescription[testCase[1]]} as needing an all ${testCase[2]} path for team ${testCase[0]}`, () => {
                let letterDeck = "";
                for (let i = 0; i < GRID_WIDTH * GRID_HEIGHT; i++) {
                    letterDeck += "A" + testCase[1];
                }
                const grid = new LetterGridModel(GRID_WIDTH, GRID_HEIGHT);
                grid.populate(letterDeck);
                const finder = new LetterGridPathFinder();
                const path = finder.findHotPath(grid, testCase[0] as "A" | "B");
                expect(path.nodes.length).equals(GRID_WIDTH);
                for (const k of ["neutral", "ally", "enemy"]) {
                    if (k === testCase[2]) {
                        expect(path.cost[k as "neutral" | "ally" | "enemy"]).equals(GRID_WIDTH);
                    } else {
                        expect(path.cost[k as "neutral" | "ally" | "enemy"]).equals(0);
                    }
                }
            })
        }
    })

    describe("Fuzz tests", () => {
        const MIN_GRID_WIDTH = 1;
        const MIN_GRID_HEIGHT = 1;
        const GRID_WIDTH_VARIANCE = 100;
        const GRID_HEIGHT_VARIANCE = 100;
        for (let i = 0; i < 10; i++) {
            const width = MIN_GRID_WIDTH + Math.floor(Math.random() * GRID_WIDTH_VARIANCE);
            const height = MIN_GRID_HEIGHT + Math.floor(Math.random() * GRID_HEIGHT_VARIANCE);
            const grid = generateFullyRandomGrid(width, height, Math.random);
            const finder = new LetterGridPathFinder();
            const team = Math.random() < 0.5 ? "A" : "B";
            finder.findHotPath(grid, team);
        }
    })
});