
// Record format:
// 0 - 4 byte address to parent
const PARENT_OFFSET = 0;
// 4 thru 107:
// Lowest bit - Whether or not this node is a terminator
// Bits 1 and 2 - Reserved
// Higher bits - 4 byte address to next node
const CHILD_OFFSET = 8;

// The size of each record in bytes
const RECORD_SIZE = 112
// The place in the array where the first record is stored (note: must be non-zero)
const FIRST_NODE_LOCATION = 8
// The char code for the letter A (so we don't have to keep recalculating it)
const A_CODE = "A".charCodeAt(0);

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
        return new WordTree.WordTreeSearcherRoot(this);
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

    private static WordTreeSearcherImpl = class WordTreeSearcherImpl implements WordTreeSearcher {
        private _tree: WordTree;
        private _currentNodeAddress: number;
        private _currentWord: string;

        constructor(tree: WordTree, address: number, word: string) {
            this._tree = tree;
            this._currentNodeAddress = address;
            this._currentWord = word;
        }
        get currentWord(): string {
            return this._currentWord;
        }
        get currentLetter(): string {
            return this.currentWord.charAt(this.currentWord.length - 1);
        }
        get currentNodeAddress(): number {
            return this._currentNodeAddress;
        }
        get isTerminator(): boolean {
            const nodeView = this.getCurrentNodeView();
            const branchIndex = this.currentLetter.charCodeAt(0) - A_CODE;
            if (branchIndex < 0 || branchIndex > 25) {
                debugger;
                throw new Error("Branch index out of range");
            }
            const terminatorValue = nodeView.getUint32(CHILD_OFFSET + branchIndex * 4) & 0x00000001;
            return terminatorValue !== 0;
        }
        hasParent(): boolean {
            return this.parent() !== undefined;
        }
        hasChild(letter: string): boolean {
            return this.child(letter) !== undefined;
        }
        parent(): WordTreeSearcher | undefined {
            if (this._currentNodeAddress === FIRST_NODE_LOCATION) {
                if (this._currentWord.length !== 1) {
                    debugger;
                    throw new Error("Unexpected word length at root node");
                }
                // Special case: if we're at the first node, but have a letter behind us,
                // move to the root state
                return new WordTree.WordTreeSearcherRoot(this._tree);
            }
            const nodeView = this.getCurrentNodeView();
            const nodeAddress = nodeView.getUint32(PARENT_OFFSET);
            if (!nodeAddress) {
                debugger;
                throw new Error("Unexpected null parent");
            }
            return new WordTreeSearcherImpl(this._tree, nodeAddress, this._currentWord.substring(0, this._currentWord.length - 1));
        }
        child(letter: string): WordTreeSearcher | undefined {
            const nodeView = this.getCurrentNodeView();
            const branchIndex = this.currentLetter.charCodeAt(0) - A_CODE;
            if (branchIndex < 0 || branchIndex > 25) {
                debugger;
                throw new Error("Branch index out of range");
            }
            const nodeAddress = nodeView.getUint32(CHILD_OFFSET + branchIndex * 4) & 0xfffffff8;
            if (!nodeAddress) {
                return undefined;
            }
            return new WordTreeSearcherImpl(this._tree, nodeAddress, this._currentWord + letter);
        }
        private getCurrentNodeView() {
            return new DataView(this._tree._buffer, this._currentNodeAddress, RECORD_SIZE);
        }
    }

    private static WordTreeSearcherRoot = class WordTreeSearcherRoot implements WordTreeSearcher {
        private _tree: WordTree;
        constructor(tree: WordTree) {
            this._tree = tree;
        }
        get currentWord(): string {
            return "";
        }
        get currentLetter(): string {
            return "";
        }
        get isTerminator(): boolean {
            return false;
        }
        hasParent(): boolean {
            return false;
        }
        hasChild(letter: string): boolean {
            return this.child(letter) !== undefined;
        }
        parent(): WordTreeSearcher | undefined {
            return undefined;
        }
        child(letter: string): WordTreeSearcher | undefined {
            const dataView = new DataView(this._tree._buffer, FIRST_NODE_LOCATION, RECORD_SIZE);
            const branchIndex = letter.charCodeAt(0) - A_CODE;
            if (branchIndex < 0 || branchIndex > 25) {
                debugger;
                throw new Error("Branch index out of range");
            }
            const childValue = dataView.getUint32(CHILD_OFFSET + branchIndex * 4);
            if (childValue) {
                return new WordTree.WordTreeSearcherImpl(this._tree, FIRST_NODE_LOCATION, letter);
            }
        }
        
    }

    private addInternal(word: string, currentNodeAddress: number) {
        let nodeView = new DataView(this._buffer, currentNodeAddress, RECORD_SIZE);
        const branchIndex = word.charCodeAt(0) - A_CODE;
        if (branchIndex < 0 || branchIndex > 25) {
            debugger;
            throw new Error("Branch index out of range");
        }
        let childValue = nodeView.getUint32(CHILD_OFFSET + branchIndex * 4);
        if (word.length === 1) {
            childValue |= 0x00000001;
            nodeView.setUint32(CHILD_OFFSET + branchIndex * 4, childValue);
            return;
        }
        
        const restOfWord = word.substring(1);
        let branchAddress = childValue & 0xfffffff8;
        if (!branchAddress) {
            branchAddress = this.allocateNode(currentNodeAddress);
            // Recreate the current node view in case things changed
            nodeView = new DataView(this._buffer, currentNodeAddress, RECORD_SIZE);
            childValue = (childValue & 0x00000007) | branchAddress;
            nodeView.setUint32(CHILD_OFFSET + branchIndex * 4, childValue);
        }
        this.addInternal(restOfWord, branchAddress);
    }

    private allocateNode(parentAddress: number): number {
        if (!parentAddress) {
            debugger;
            throw new Error("Expected parent address");
        }
        if (this._allocationPoint + RECORD_SIZE > this._buffer.byteLength) {
            this.resize(this._buffer.byteLength * 2);
        }
        const nodeAddress = this._allocationPoint;
        const nodeView = new DataView(this._buffer, nodeAddress, RECORD_SIZE);
        nodeView.setUint32(PARENT_OFFSET, parentAddress);
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