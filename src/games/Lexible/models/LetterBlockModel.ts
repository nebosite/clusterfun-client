import { Vector2 } from "libs";
import { action, observable } from "mobx";

export type BlockSelectHandler = (playerId: string, selectedValue: boolean)=>void
export type BlockSelectAuthroizer = (block: LetterBlockModel)=>boolean

let blockIdSeed = Date.now();
export class LetterBlockModel
{
    __blockid = blockIdSeed++;
    coordinates: Vector2
    
    @observable private _letter: string = "#";
    get letter() {return this._letter}
    set letter(value) { action(()=>this._letter = value)()}

    @observable private _score = 0;
    get score() {return this._score}

    @observable selectedMap = observable(new Array<string>());
    get selected() {return this.selectedMap.length > 0}

    @observable failFade = 0;
    @observable team: string = "_"

    onSelectedChanged:BlockSelectHandler = ()=>{console.log("WERID: Default select action happening")}

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor( letter: string = "_",  coordinates: Vector2 = new Vector2(0,0)) 
    {
        this.letter = letter;
        this.coordinates = coordinates;
    }

    // -------------------------------------------------------------------
    // selectForPlayer 
    // -------------------------------------------------------------------
    selectForPlayer(playerId: string, value: boolean) {
        action(()=>{
            if(value === this.isSelectedByPlayer(playerId)) return; 

            if(!value) {
                const index = this.selectedMap.findIndex(i => i === playerId)
                if(index > -1) this.selectedMap.splice(index, 1);
            }
            else {
                this.selectedMap.push(playerId);
            }
            this.onSelectedChanged(playerId, value)
        })()
    }

    // -------------------------------------------------------------------
    // isSelectedByPlayer 
    // -------------------------------------------------------------------
    isSelectedByPlayer(playerId: string) {
        return this.selectedMap.findIndex(i => i === playerId) > -1
    }

    // -------------------------------------------------------------------
    // setScore 
    // -------------------------------------------------------------------
    setScore(value: number, team: string) {
        action(()=> {
            this._score = value;
            this.team = team;
        })()
    }

    // -------------------------------------------------------------------
    // fail 
    // -------------------------------------------------------------------
    fail() { 
        const animator = () => {
            action(()=> {
                    this.failFade *= .90;
                    if(this.failFade < 0.1) {
                        this.failFade = 0;
                    }
                    else {
                        setTimeout(animator, 30);
                    }
                })()
        }
        this.failFade = 1;
        setTimeout(animator,30); 
    }
}