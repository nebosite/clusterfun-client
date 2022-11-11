
// The size of each record in bytes
const RECORD_SIZE = 112
const FIRST_NODE_LOCATION = 8

// Record format:
// 0 - UTF-32 code for the character being represented (or 0 if no character)
// 1 - Whether or not this node is a terminator
// 4 - pointer to parent (or 0 if no parent)
// 8 thru 111 - pointers to each child (A-Z, 0 if no child)

export interface WordTreeSearcher {
    get currentWord(): string;
    get currentLetter(): string;
    get isTerminator(): boolean;
    hasParent(): boolean;
    hasChild(letter: string): boolean;
    parent(): WordTreeSearcher | undefined;
    child(letter: string): WordTreeSearcher | undefined;
}

export interface WordTreeUsageRecord {
    nodeCount: number;
    filledChildPointers: number;
    totalChildPointers: number;
}

class WordTreeUsageRecordImpl implements WordTreeUsageRecord {
    nodeCount: number = 0;
    filledChildPointers: number = 0;
    totalChildPointers: number = 0;
    
    toString(): string {
        return `WordTreeUsageRecord (${this.nodeCount} nodes, ${this.filledChildPointers}/${this.totalChildPointers} pointers filled)`
    }
}

export interface WordTreeUsageStats {
    nodeCount: number;
    wordCount: number;
    totalChildPointers: number;
    filledChildPointers: number;
    usageStatsByLetter: Map<string, WordTreeUsageRecord>
    usageStatsByLength: Map<number, WordTreeUsageRecord>
}

// -------------------------------------------------------------------
// A class for rapidly finding potential word matches
// -------------------------------------------------------------------
export class WordTree {
    // TODO: Do bounds checks
    private _buffer: ArrayBuffer;
    private _allocationPoint: number;
    private _totalNodeCount: number;
    private _totalWordCount: number;

    constructor() {
        this._buffer = new ArrayBuffer(RECORD_SIZE + FIRST_NODE_LOCATION);
        this._allocationPoint = FIRST_NODE_LOCATION + RECORD_SIZE;
        this._totalNodeCount = 1;
        this._totalWordCount = 0;
    }

    add(word: string) {
        this.addInternal(word, FIRST_NODE_LOCATION);
        this._totalWordCount++;
    }

    search(): WordTreeSearcher {
        return new WordTree.WordTreeSearcherImpl(this);
    }

    trim(): void {
        this.resize(this._allocationPoint);
    }

    hasWord(word: string) {
        word = word.toUpperCase();
        let searcher: WordTreeSearcher = this.search();
        for (const letter of word) {
            const next = searcher.child(letter);
            if (!next) return false;
            searcher = next;
        }
        return searcher.isTerminator;
    }

    getUsageStats(): WordTreeUsageStats {
        const stats: WordTreeUsageStats = {
            nodeCount: this._totalNodeCount,
            wordCount: this._totalWordCount,
            filledChildPointers: this._totalNodeCount - 1,
            totalChildPointers: this._totalNodeCount * 26,
            usageStatsByLength: new Map(),
            usageStatsByLetter: new Map()
        }
        if (process.env.REACT_APP_DEVMODE !== "development") return stats;
        const searchers = [this.search()];
        while (searchers.length > 0) {
            const searcher = searchers.pop()!;
            const letter = searcher.currentLetter;
            if (!stats.usageStatsByLetter.has(letter)) {
                stats.usageStatsByLetter.set(letter, new WordTreeUsageRecordImpl())
            }
            const letterStats = stats.usageStatsByLetter.get(letter)!;

            const length = searcher.currentWord.length;
            if (!stats.usageStatsByLength.has(length)) {
                stats.usageStatsByLength.set(length, new WordTreeUsageRecordImpl())
            }
            const lengthStats = stats.usageStatsByLength.get(length)!;
            letterStats.nodeCount++;
            lengthStats.nodeCount++;
            for (let i = "A".charCodeAt(0); i <= "Z".charCodeAt(0); i++) {
                letterStats.totalChildPointers++;
                lengthStats.totalChildPointers++;
                const child = searcher.child(String.fromCharCode(i));
                if (child) {
                    letterStats.filledChildPointers++;
                    lengthStats.filledChildPointers++;
                    searchers.push(child);
                }
            }
        }
        return stats;
    }

    private static WordTreeSearcherImpl = class WordTreeSearcherImpl implements WordTreeSearcher {
        private _tree: WordTree;
        private _currentNodeAddress: number;
        private _currentWord: string;
        constructor(tree: WordTree) {
            this._tree = tree;
            this._currentNodeAddress = FIRST_NODE_LOCATION;
            this._currentWord = "";
        }
        get currentWord(): string {
            return this._currentWord;
        }
        get currentLetter(): string {
            const nodeView = this.getCurrentNodeView();
            const code = nodeView.getUint8(0);
            return code > 0 ? String.fromCharCode(code) : "";
        }
        get currentNodeAddress(): number {
            return this._currentNodeAddress;
        }
        get isTerminator(): boolean {
            const nodeView = this.getCurrentNodeView();
            return nodeView.getUint8(1) !== 0;
        }
        hasParent(): boolean {
            const nodeView = this.getCurrentNodeView();
            return nodeView.getUint32(4) !== 0;
        }
        hasChild(letter: string): boolean {
            const nodeView = this.getCurrentNodeView();
            const branchIndex = (letter.toUpperCase()).charCodeAt(0) - "A".charCodeAt(0);
            return nodeView.getUint32(8 + branchIndex * 4) !== 0;
        }
        parent(): WordTreeSearcher | undefined {
            const nodeView = this.getCurrentNodeView();
            const nodeAddress = nodeView.getUint32(4);
            if (!nodeAddress) return undefined;
            const newSearcher = new WordTreeSearcherImpl(this._tree);
            newSearcher._currentNodeAddress = nodeAddress;
            newSearcher._currentWord = this._currentWord.substring(0, this._currentWord.length - 1);
            return newSearcher;
        }
        child(letter: string): WordTreeSearcher | undefined {
            const nodeView = this.getCurrentNodeView();
            const branchIndex = (letter.toUpperCase()).charCodeAt(0) - "A".charCodeAt(0);
            const nodeAddress = nodeView.getUint32(8 + branchIndex * 4);
            if (!nodeAddress) return undefined;
            const newSearcher = new WordTreeSearcherImpl(this._tree);
            newSearcher._currentNodeAddress = nodeAddress;
            newSearcher._currentWord = this._currentWord + (letter.toUpperCase()).charAt(0);
            return newSearcher;
        }
        private getCurrentNodeView() {
            return new DataView(this._tree._buffer, this._currentNodeAddress, RECORD_SIZE);
        }
    }

    private addInternal(word: string, currentNodeAddress: number) {
        let nodeView = new DataView(this._buffer, currentNodeAddress, RECORD_SIZE);
        if (word.length === 0) {
            nodeView.setUint8(1, 1);
            return;
        }
        const branchIndex = word.charCodeAt(0) - "A".charCodeAt(0);
        const restOfWord = word.substring(1);
        let branchAddress = nodeView.getUint32(8 + branchIndex * 4);
        if (!branchAddress) {
            branchAddress = this.allocateNode(currentNodeAddress, word.charCodeAt(0));
            // Recreate the current node view in case things changed
            nodeView = new DataView(this._buffer, currentNodeAddress, RECORD_SIZE);
            nodeView.setUint32(8 + branchIndex * 4, branchAddress);
        }
        this.addInternal(restOfWord, branchAddress);
    }

    private allocateNode(parentAddress: number, charCode: number): number {
        if (this._allocationPoint + RECORD_SIZE > this._buffer.byteLength) {
            this.resize(this._buffer.byteLength * 2);
        }
        const nodeAddress = this._allocationPoint;
        const nodeView = new DataView(this._buffer, nodeAddress, RECORD_SIZE);
        nodeView.setUint8(0, charCode);
        nodeView.setUint32(4, parentAddress);
        this._allocationPoint += RECORD_SIZE;
        this._totalNodeCount++;
        return nodeAddress;
    }

    private resize(size: number): void {
        if (size < this._allocationPoint) {
            throw new Error("WordTree resize would cut off existing data")
        }
        const newBuffer = new ArrayBuffer(size);
        const oldDataView = new Uint8Array(this._buffer);
        const newDataView = new Uint8Array(newBuffer);
        for (let i = 0; i < this._allocationPoint; i++) {
            newDataView[i] = oldDataView[i];
        }
        this._buffer = newBuffer;
    }
}