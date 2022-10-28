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

class Vector2Map<V> implements Map<Vector2, V> {
    private _size: number = 0;
    data: Map<number, Map<number, V>> = new Map<number, Map<number, V>>();
    clear(): void {
        this.data.clear();
    }
    delete(key: Vector2): boolean {
        if (!this.data.has(key.x)) return false;
        const xmap = this.data.get(key.x)!;
        const result = xmap.delete(key.y);
        if (result) this._size--;
        if (xmap.size === 0) this.data.delete(key.x);
        return result;
    }
    forEach(callbackfn: (value: V, key: Vector2, map: Map<Vector2, V>) => void, thisArg?: any): void {
        this.data.forEach((xmap, x) => {
            xmap.forEach((v, y) => {
                callbackfn(v, new Vector2(x, y), this);
            })
        })
    }
    get(key: Vector2): V | undefined {
        if (!this.data.has(key.x)) return undefined;
        return this.data.get(key.x)!.get(key.y);
    }
    has(key: Vector2): boolean {
        if (!this.data.has(key.x)) return false;
        return this.data.get(key.x)!.has(key.y);
    }
    set(key: Vector2, value: V): this {
        if (!this.data.has(key.x)) {
            this.data.set(key.x, new Map<number, V>());
        }
        const xmap = this.data.get(key.x)!;
        if (!xmap.has(key.y)) this._size++;
        xmap.set(key.y, value);
        return this;
    }
    get size(): number {
        return this._size;
    }
    *entries(): IterableIterator<[Vector2, V]> {
        for (const [x, xmap] of this.data.entries()) {
            for (const [y, v] of xmap.entries()) {
                yield [new Vector2(x, y), v];
            }
        }
    }
    *keys(): IterableIterator<Vector2> {
        for (const [x, xmap] of this.data.entries()) {
            for (const y of xmap.keys()) {
                yield new Vector2(x, y);
            }
        }
    }
    *values(): IterableIterator<V> {
        for (const xmap of this.data.values()) {
            for (const v of xmap.values()) {
                yield v;
            }
        }
    }
    [Symbol.iterator](): IterableIterator<[Vector2, V]> {
        return this.entries();
    }
    get [Symbol.toStringTag](): string {
        return "Vector2Map";
    }
}

// ---------------------------------------------------------
// findHotPathInGrid - Find the shortest hot path in the
//   grid for the given team. This is defined as the path
//   that has to cross the fewest enemy squares, followed
//   by the fewest neutral squares, followed by the fewest
//   ally squares.
// If a path across the board exists that only requires
//   crossing ally squares, then that team has won the round
//   and this function will find that path.
// ---------------------------------------------------------
export function findHotPathInGrid(grid: LetterGridModel, team: "A" | "B"): LetterGridPath {
    // Implement A* to find the current shortest path for the given team
    let startx = 0;
    let winx = grid.width - 1;
    if (team === "B") {
        startx = grid.width - 1;
        winx = 0;
    }

    // A map indicating the previous element on a path search
    const cameFrom = new Vector2Map<Vector2>();
    // A map of (x, (y, cost)) indicating the shortest path from start to n
    const truePathScore = new Vector2Map<PathCost>();
    // A map of (x, (y, cost)) indicating the current best guess for a path's
    // cost from start to finish if it goes through n
    const guessPathScore = new Vector2Map<PathCost>();
    // A map of (x, (y)) indicating whether a certain coordinate
    // is in the search queue (since the queue itself is not
    // directly searchable)
    const searchQueuePresence = new Vector2Map<boolean>();
    // A priority queue indicating which coordinates to search next
    const searchQueue = new PriorityQueue<Vector2>((a, b) => {
        const aCost = guessPathScore.get(a);
        const bCost = guessPathScore.get(b);
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
        const vector = new Vector2(startx, y);
        searchQueue.enqueue(new Vector2(startx, y));
        truePathScore.set(vector, trueCost);
        guessPathScore.set(vector, guessCost);
        searchQueuePresence.set(vector, true);
    }

    while (!searchQueue.isEmpty()) {
        let current = searchQueue.dequeue();
        searchQueuePresence.delete(current);
        if (current.x === winx) {
            const nodes: Vector2[] = [ current ];
            const cost: PathCost = truePathScore.get(current)!;
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

            if (!truePathScore.has(neighbor)) {
                truePathScore.set(neighbor, { 
                    ally: Number.POSITIVE_INFINITY, 
                    neutral: Number.POSITIVE_INFINITY, 
                    enemy: Number.POSITIVE_INFINITY 
                });
                guessPathScore.set(neighbor, { 
                    ally: Number.POSITIVE_INFINITY, 
                    neutral: Number.POSITIVE_INFINITY, 
                    enemy: Number.POSITIVE_INFINITY 
                });
            }

            const tenativeTrueScore = {...truePathScore.get(current)!};
            const propertyToAdd = block.team === team ? "ally" : block.team === "_" ? "neutral" : "enemy";
            tenativeTrueScore[propertyToAdd] += 1;

            if (comparePathCostElements(tenativeTrueScore, truePathScore.get(neighbor)!) < 0) {
                cameFrom.set(neighbor, current);
                truePathScore.set(neighbor, tenativeTrueScore);
                const neighborGuessScore = {...tenativeTrueScore};
                neighborGuessScore.ally += Math.abs(neighbor.x - winx);
                guessPathScore.set(neighbor, neighborGuessScore);
                if (!searchQueuePresence.has(neighbor)) {
                    searchQueuePresence.set(neighbor, true);
                    searchQueue.enqueue(neighbor);
                }
            }
        }
    }

    return { nodes: [], cost: { ally: Number.POSITIVE_INFINITY, neutral: Number.POSITIVE_INFINITY, enemy: Number.POSITIVE_INFINITY } }
}
