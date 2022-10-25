import { Vector2 } from "libs/types/Vector2";
import { observable } from "mobx";
import { LetterBlockModel } from "./LetterBlockModel";

export class LetterGridModel {
    width = 25
    height = 22
    @observable rows= new Array<LetterBlockModel[]>()

    constructor(width: number = 0, height: number = 0) {
        this.width = width;
        this.height = height;
    }

    // -------------------------------------------------------------------
    // processBlocks
    // -------------------------------------------------------------------
    processBlocks(processor: (block: LetterBlockModel) => void) {
        if(this.rows) {
            for(let y = 0; y < this.height; y++)
            {
                const row = this.rows[y];
                for(let x = 0; x < this.width; x++) {
                    const block = row[x];
                    if(x !== block.coordinates.x || y !== block.coordinates.y) {
                        throw Error(`Coordinates no matchy (${x},${y}) != B(${block.coordinates.x},${block.coordinates.y})`)
                    }
                    processor(block);
                }
            }
        }
    }

    // -------------------------------------------------------------------
    // populate - create a fresh grid with new blocks
    // -------------------------------------------------------------------
    populate(letterDeck: string)
    {
        const CHARCODE_0 = 48;
        let deckIndex = 0;
        let gridSize = this.width * this.height;
        const newRows = new Array<LetterBlockModel[]>(this.height)
        for(let y = 0; y < this.height; y++)
        {
            newRows[y] = new Array<LetterBlockModel>(this.width)
            for(let x = 0; x < this.width; x++) {
                const spot = (deckIndex % gridSize) * 3
                const letter = letterDeck[spot];
                const team = letterDeck[spot+1];
                const score = letterDeck[spot+2].charCodeAt(0) - CHARCODE_0;
                const newBlock = new LetterBlockModel(
                    letter === "Q" ? "Qu" : letter,
                    new Vector2(x,y))
                newBlock.setScore(score, team);

                deckIndex++;
                newRows[y][x] = newBlock;
            }
        }   
        this.rows = newRows;
    }

    // -------------------------------------------------------------------
    // addBlock
    // -------------------------------------------------------------------
    addBlock(block: LetterBlockModel) {
        while(this.rows.length <= block.coordinates.y)
        {
            this.rows.push(new Array<LetterBlockModel>(this.width));
        }

        const row = this.rows[block.coordinates.y]
        row[block.coordinates.x] = block;
    }

    // -------------------------------------------------------------------
    // getBlock
    // -------------------------------------------------------------------
    getBlock(spot: Vector2) {
        if(!this.rows) throw Error("No data in this grid")
        if(spot.x < 0 
            || spot.x >= this.width
            || spot.y < 0 
            || spot.y >= this.height
            ) { 
            return null
        }
        return this.rows[spot.y][spot.x]
    }

    // -------------------------------------------------------------------
    //  serialize
    // -------------------------------------------------------------------
    serialize = () => {  
        const output: string[] = [];
        const numbers = "0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ"

        this.rows.forEach(r => {
            r.forEach(l => output.push(`${l.letter[0]}${l.team[0]}${numbers[l.score]}`))
        })

        return output.join('');
    }

    // -------------------------------------------------------------------
    //  deserialize
    // -------------------------------------------------------------------
    deserialize = (data: string) => {  
        this.populate(data);
    }

}

