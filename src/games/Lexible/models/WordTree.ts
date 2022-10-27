

// -------------------------------------------------------------------
// A class for rapidly finding potential word matches
// -------------------------------------------------------------------
export class WordTree {
    private _isTerminator = false;
    private _branches = new Map<string, WordTree>()
    private _letter: string
    private _parent: WordTree | undefined

    get rootWord():string { return (this._parent?.rootWord ?? "") + this._letter}
    get myWord() { return this._isTerminator ?  this.rootWord: undefined}

    static create(words: string[])
    {
        const output = new WordTree("", undefined);
        words.forEach(w => output.add(w.toUpperCase()))
        return output;
    }

    constructor(letter: string, parent: WordTree | undefined){
        this._letter = letter;
        this._parent = parent;
    }

    branch(letter: string) {
        return this._branches.get(letter)
    }

    add(word: string) {
        if(word.length === 0) {
            this._isTerminator = true;
            return;
        }

        const indexLetter = word[0];
        word = word.substring(1)
        if(!this._branches.has(indexLetter)) {
            this._branches.set(indexLetter, new WordTree(indexLetter, this))
        }
        this._branches.get(indexLetter)!.add(word);
    }
}