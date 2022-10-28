import { expect } from "chai";
import { Vector2 } from "libs";
import { LetterGridModel } from "./LetterGridModel";
import { LetterGridPathFinder } from "./LetterGridPathFinder";

function generateUniformlyFilledGrid(width: number, height: number, 
    team: string, score: string, nextRandom: () => number) {
    const LETTERS = "QWERTYUIOPASDFGHJKLZXCVBNM";
    let letterDeck = "";
    for (let i = 0; i < width * height; i++) {
        letterDeck += LETTERS.charAt(Math.floor(LETTERS.length * nextRandom()));
        letterDeck += team;
        letterDeck += score;
    }
    const grid = new LetterGridModel(width, height);
    grid.populate(letterDeck);
    return grid;
}

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
            ["A", "_", "neutral"],
            ["B", "_", "neutral"],
            ["A", "A", "ally"],
            ["B", "A", "enemy"],
            ["A", "B", "enemy"],
            ["B", "B", "ally"],
        ]
        const gridDescription: Record<string, string> = {
            "_": "a fully empty grid",
            "A": "a grid conqueured by team A",
            "B": "a grid conqueured by team B"
        }
        for (const testCase of testCases) {
            it(`Identifies ${gridDescription[testCase[1]]} as needing an all ${testCase[2]} path for team ${testCase[0]}`, () => {
                const grid = generateUniformlyFilledGrid(GRID_WIDTH, GRID_HEIGHT, testCase[1], "4", Math.random);
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
            it(`Doesn't crash (iteration ${i + 1})`, () => {
                const width = MIN_GRID_WIDTH + Math.floor(Math.random() * GRID_WIDTH_VARIANCE);
                const height = MIN_GRID_HEIGHT + Math.floor(Math.random() * GRID_HEIGHT_VARIANCE);
                const grid = generateFullyRandomGrid(width, height, Math.random);
                const finder = new LetterGridPathFinder();
                const team = Math.random() < 0.5 ? "A" : "B";
                finder.findHotPath(grid, team);
            });
        }
    })

    describe("Random walk tests", () => {
        const MIN_GRID_WIDTH = 5;
        const MIN_GRID_HEIGHT = 5;
        const GRID_WIDTH_VARIANCE = 20;
        const GRID_HEIGHT_VARIANCE = 20;
        for (let i = 0; i < 10; i++) {
            it(`Finds winning path if it exists (iteration ${i + 1})`, () => {
                const width = MIN_GRID_WIDTH + Math.floor(Math.random() * GRID_WIDTH_VARIANCE);
                const height = MIN_GRID_HEIGHT + Math.floor(Math.random() * GRID_HEIGHT_VARIANCE);
                const grid = generateUniformlyFilledGrid(width, height, "_", "0", Math.random);
                const team = i % 2 === 0 ? "A" : "B";
    
                let x = 0, y = Math.floor(height / 2);
                while (x < width) {
                    const block = grid.getBlock(new Vector2(x, y))!;
                    block.setScore(4, team);
                    const dirRand = Math.random();
                    if (dirRand < 0.1) {
                        x--;
                        if (x < 0) x = 0;
                    } else if (dirRand < 0.3) {
                        y--;
                        if (y < 0) y = 0;
                    } else if (dirRand < 0.5) {
                        y++;
                        if (y > height - 1) y = height - 1;
                    } else {
                        x++;
                    }
                }
                const finder = new LetterGridPathFinder();
                const path = finder.findHotPath(grid, team);
                expect(path.cost.neutral).equals(0);
                expect(path.cost.enemy).equals(0);
                expect(path.nodes.length).equals(path.cost.ally);
            });
        }
    })
});