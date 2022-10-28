import { LetterGridModel } from "./LetterGridModel";
import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Vector2 } from "libs";

export interface PathCost {
    ally: number
    neutral: number
    enemy: number
}

function comparePathCostElements(a: PathCost, b: PathCost) {
    if (a.enemy !== b.enemy) return a.enemy - b.enemy;
    if (a.neutral !== b.neutral) return a.neutral - b.neutral;
    return a.ally - b.ally;
}

export interface LetterGridPath {
    nodes: Vector2[];
    cost: PathCost;
}

// TODO: To clean up this code in the future, make a Vector2-keyed map

export class LetterGridPathFinder {
    findHotPath(grid: LetterGridModel, team: "A" | "B"): LetterGridPath {
        // Implement A* to find the current shortest path for the given team
        let startx = 0;
        let winx = grid.width - 1;
        if (team === "B") {
            startx = grid.width - 1;
            winx = 0;
        }

        // A map indicating the previous element on a path search
        const cameFrom = new Map<Vector2, Vector2>();
        // A map of (x, (y, cost)) indicating the shortest path from start to n
        const truePathScore = new Map<number, Map<number, PathCost>>();
        // A map of (x, (y, cost)) indicating the current best guess for a path's
        // cost from start to finish if it goes through n
        const guessPathScore = new Map<number, Map<number, PathCost>>();
        // A map of (x, (y)) indicating whether a certain coordinate
        // is in the search queue (since the queue itself is not
        // directly searchable)
        const searchQueuePresence = new Map<number, Set<number>>();
        for (let x = 0; x < grid.width; x++) {
            truePathScore.set(x, new Map<number, PathCost>());
            guessPathScore.set(x, new Map<number, PathCost>());
            searchQueuePresence.set(x, new Set<number>());
        }
        // A priority queue indicating which coordinates to search next
        const searchQueue = new PriorityQueue<Vector2>((a, b) => {
            const aCost = guessPathScore.get(a.x)!.get(a.y);
            const bCost = guessPathScore.get(b.x)!.get(b.y);
            if (aCost && bCost) return comparePathCostElements(aCost, bCost);
            else if (aCost) return 1;
            else if (bCost) return -1;
            else return 0;
        });

        // Start on the startx, giving the true and estimated costs
        for (let y = 0; y < grid.height; y++) {
            const block = grid.getBlock(new Vector2(startx, y))!;
            const trueCost = {
                ally: block.team === team ? 1 : 0,
                neutral: block.team === "_" ? 1 : 0,
                enemy: block.team !== team && block.team !== "_" ? 1 : 0
            };
            const guessCost = {
                ally: trueCost.ally + grid.width - 1,
                neutral: trueCost.neutral,
                enemy: trueCost.enemy
            };
            searchQueue.enqueue(new Vector2(startx, y));
            truePathScore.get(startx)!.set(y, trueCost);
            guessPathScore.get(startx)!.set(y, guessCost);
            searchQueuePresence.get(startx)!.add(y);
        }

        while (!searchQueue.isEmpty()) {
            let current = searchQueue.dequeue();
            searchQueuePresence.get(current.x)!.delete(current.y);
            if (current.x === winx) {
                const nodes: Vector2[] = [ current ];
                const cost: PathCost = truePathScore.get(current.x)!.get(current.y)!;
                while (cameFrom.has(current)) {
                    // TODO: In tests, the path and the node cost are ocassionally off by one.
                    // Figure out why this is.
                    current = cameFrom.get(current)!;
                    nodes.push(new Vector2(current.x, current.y));
                }
                return { nodes, cost };
            }

            for (const dir of [[-1,0],[1,0],[0,-1],[0,1]]) {
                const neighbor = current.add(new Vector2(dir[0], dir[1]));
                const block = grid.getBlock(neighbor);
                if (!block) continue;

                if (!truePathScore.get(neighbor.x)!.has(neighbor.y)) {
                    truePathScore.get(neighbor.x)!.set(neighbor.y, { 
                        ally: Number.POSITIVE_INFINITY, 
                        neutral: Number.POSITIVE_INFINITY, 
                        enemy: Number.POSITIVE_INFINITY 
                    });
                    guessPathScore.get(neighbor.x)!.set(neighbor.y, { 
                        ally: Number.POSITIVE_INFINITY, 
                        neutral: Number.POSITIVE_INFINITY, 
                        enemy: Number.POSITIVE_INFINITY 
                    });
                }

                const tenativeTrueScore = {...truePathScore.get(current.x)!.get(current.y)!};
                const propertyToAdd = block.team === team ? "ally" : block.team === "_" ? "neutral" : "enemy";
                tenativeTrueScore[propertyToAdd] += 1;

                if (comparePathCostElements(tenativeTrueScore, truePathScore.get(neighbor.x)!.get(neighbor.y)!) < 0) {
                    cameFrom.set(neighbor, current);
                    truePathScore.get(neighbor.x)?.set(neighbor.y, tenativeTrueScore);
                    const neighborGuessScore = {...tenativeTrueScore};
                    neighborGuessScore.ally += Math.abs(neighbor.x - winx);
                    guessPathScore.get(neighbor.x)!.set(neighbor.y, neighborGuessScore);
                    if (!searchQueuePresence.get(neighbor.x)!.has(neighbor.y)) {
                        searchQueuePresence.get(neighbor.x)!.add(neighbor.y);
                        searchQueue.enqueue(neighbor);
                    }
                }
            }
        }

        return { nodes: [], cost: { ally: Number.POSITIVE_INFINITY, neutral: Number.POSITIVE_INFINITY, enemy: Number.POSITIVE_INFINITY } }
    }
}