import { LetterGridModel } from "./LetterGridModel";
import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Vector2 } from "libs";

export interface PathCost {
    ally: number
    neutral: number
    enemy: number
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

interface QueueElement {
    cost: PathCost;
    location: Vector2;
    previous?: QueueElement;
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

    // A set indicating whether a coordinate has been visited
    const visited = new Vector2Map<boolean>();
    // A priority queue indicating which coordinates to search next
    const searchQueue = new PriorityQueue<QueueElement>((a, b) => {
        // The true cost of searching a node is a combination
        // of the enemy, neutral, and ally squares crossed,
        // compared in that order (like Stars and Coins in Mario Party).
        // The A* search heuristic is the minimum possible distance
        // we can have left, which occurs if we have a straight shot
        // from the current location to the winning side in
        // allied squares.
        const aTotal = a.cost.enemy + a.cost.neutral;
        const bTotal = b.cost.enemy + b.cost.neutral;
        if (aTotal !== bTotal) return aTotal - bTotal;
        if (a.cost.enemy !== b.cost.enemy) return a.cost.enemy - b.cost.enemy;
        return (a.cost.ally + Math.abs(winx - a.location.x)) 
            - (b.cost.ally + Math.abs(winx - b.location.x));
    });

    // Start on the startx, giving the true and estimated costs
    for (let y = 0; y < grid.height; y++) {
        const block = grid.getBlock(new Vector2(startx, y))!;
        const trueCost = {
            ally: block.team === team ? 1 : 0,
            neutral: block.team === "_" ? 1 : 0,
            enemy: block.team !== team && block.team !== "_" ? 1 : 0
        };
        const vector = new Vector2(startx, y);
        searchQueue.enqueue({ cost: trueCost, location: vector });
        visited.set(vector, true);
    }

    while (!searchQueue.isEmpty()) {
        let current = searchQueue.dequeue();
        
        if (current.location.x === winx) {
            const cost = current.cost;
            const nodes: Vector2[] = [ current.location ];
            while (current.previous) {
                current = current.previous;
                nodes.push(new Vector2(current.location.x, current.location.y));
            }
            nodes.reverse();
            return { nodes, cost };
        }

        for (const dir of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const neighbor = current.location.add(new Vector2(dir[0], dir[1]));
            if (visited.has(neighbor)) continue;
            const block = grid.getBlock(neighbor);
            if (!block) continue;

            const neighborCost = {...current.cost};
            const propertyToAdd = block.team === team ? "ally" : block.team === "_" ? "neutral" : "enemy";
            neighborCost[propertyToAdd] += 1;
            searchQueue.enqueue({ cost: neighborCost, location: neighbor, previous: current });
            visited.set(current.location, true);
        }
    }

    return { nodes: [], cost: { ally: Number.POSITIVE_INFINITY, neutral: Number.POSITIVE_INFINITY, enemy: Number.POSITIVE_INFINITY } }
}
