
// -------------------------------------------------------------------
// A class for rapidly finding potential word matches
// -------------------------------------------------------------------
export class WordTree {
    private _head: WordTreeNode;

    static create()
    {
        return new WordTree({
            branches: {},
            isTerminator: false,
            letterCode: 0
        });
    }

    constructor(head: WordTreeNode){
        this._head = head;
    }

    export(): WordTreeNode {
        return this._head;
    }

    search() {
        return new WordTreeSearcher(this._head, []);
    }

    has(word: string) {
        return this.hasAt(this._head, word);
    }

    add(word: string) {
        this.addAt(this._head, word);
    }

    private hasAt(current: WordTreeNode, word: string): boolean {
        if (word.length === 0) {
            return current.isTerminator;
        }
        const indexCode = word.charCodeAt(0);
        if (indexCode === undefined) {
            throw new Error(`Word contains unsupported letter ${word.charAt(0)}`)
        }
        if(!current.branches[indexCode]) {
            return false;
        }
        return this.hasAt(current.branches[indexCode]!, word.substring(1));
    }

    private addAt(current: WordTreeNode, word: string) {
        if(word.length === 0) {
            current.isTerminator = true;
            return;
        }

        const indexCode = word.charCodeAt(0);
        if(!current.branches[indexCode]) {
            current.branches[indexCode] = {
                branches: {},
                isTerminator: false,
                letterCode: indexCode
            };
        }
        this.addAt(current.branches[indexCode]!, word.substring(1));
    }
}

export class WordTreeSearcher {
    private _current: WordTreeNode;
    private _parents: WordTreeSearcher[];

    constructor(current: WordTreeNode, parent: WordTreeSearcher[]) {
        this._current = current;
        this._parents = parent;
    }

    isTerminator(): boolean {
        return this._current.isTerminator;
    }

    currentWord(): string {
        let word = "";
        for (const parent of this._parents) {
            const parentCode = parent._current.letterCode;
            if (parentCode) {
                word += String.fromCharCode(parentCode);
            }
        }
        const currentCode = this._current.letterCode;
        if (currentCode) {
            word += String.fromCharCode(this._current.letterCode);
        }
        return word;
    }

    parent(): WordTreeSearcher | undefined {
        if (this._parents.length === 0) {
            return undefined;
        }
        return this._parents[this._parents.length - 1];
    }

    child(letter: string | number): WordTreeSearcher | undefined {
        if (typeof letter === "string") {
            letter = letter.charCodeAt(0);
        }
        const node = this._current.branches[letter]
        if (!node) {
            return undefined;
        }
        return new WordTreeSearcher(node, this._parents.concat([this]));
    }
}

export interface WordTreeNode {
    isTerminator: boolean;
    letterCode: number;
    branches: Record<number, WordTreeNode>
}