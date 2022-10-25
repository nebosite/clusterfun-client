import { action, observable } from "mobx";
import { ClusterFunGameProps, ISessionHelper } from "libs";
import { ITelemetryLogger } from "libs/telemetry/TelemetryLogger";
import { IStorage } from "libs/storage/StorageHelper";
import { LetterSelectData, LexibleEndOfRoundMessage, LexibleFailedWordMessage, LexiblePlayerAction, LexiblePlayerActionMessage, LexiblePlayRequestMessage, LexibleScoredWordMessage, LexibleWordHintMessage, PlayBoard, WordSubmissionData } from "./LexibleMessages";
import { GeneralClientState, ClusterfunClientModel } from "../../../libs";
import { LetterBlockModel } from "./LetterBlockModel";
import { LetterGridModel } from "./LetterGridModel";
import { LexibleGameEvent } from "./LexiblePresenterModel";
import { Vector2 } from "libs/types/Vector2";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getLexibleClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ) =>
 {
     return {
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "LetterGridModel": return new LetterGridModel();
                case "LetterBlockModel": return new LetterBlockModel("_");
                case "Vector2": return new Vector2(0,0);
                case "LexibleClientModel":
                        return new LexibleClientModel(
                        sessionHelper,
                        gameProps.playerName || "Player",
                        gameProps.logger,
                        gameProps.storage);
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            switch(propertyName)
            {
                case "__blockid": return false;
                case "failFade": return false;
            } 

            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            switch(propertyName)
            {
                case "selectMap": return observable(rehydratedObject as string[])
                case "letterChain": return observable(rehydratedObject as LetterBlockModel[])
            } 

            return rehydratedObject;
        }
     }
}

export enum LexibleClientState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Client data and logic
// -------------------------------------------------------------------
export class LexibleClientModel extends ClusterfunClientModel  {

    @observable theGrid = new LetterGridModel();
    @observable letterChain = observable(new Array<LetterBlockModel>())
    @observable myTeam = "_";

    @observable private _winningTeam = "";
    @observable private _wordList: string[] = []
    get wordList() {
        const prefix = this.activeWord;
        return this._wordList.filter(w => w.startsWith(prefix))   
    }
    get winningTeam() { return this._winningTeam}
    set winningTeam(value) { action(()=>{this._winningTeam = value})()}

    get activeWord() {
        let output = "";
        this.letterChain.forEach(b => output += b.letter.toUpperCase())
        return output;
    }

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("LexibleClient", sessionHelper, playerName, logger, storage);

        sessionHelper.addListener(LexiblePlayRequestMessage, playerName, this.handlePlayRequestMessage);
        sessionHelper.addListener(LexibleEndOfRoundMessage, playerName, this.handleEndOfRoundMessage);
        sessionHelper.addListener(LexibleScoredWordMessage, playerName, this.handleScoredWordMessage);
        sessionHelper.addListener(LexibleFailedWordMessage, playerName, this.handleFailedWordMessage);
        sessionHelper.addListener(LexibleWordHintMessage, playerName, this.handleWordHintMessage);
    }

    // -------------------------------------------------------------------
    // submitWord 
    // -------------------------------------------------------------------
    submitWord() {
        if(this.letterChain.length === 0) {
            console.log("WEIRD:  should have been letters in the letter chain")
            return;
        }

        const submissionData: WordSubmissionData = {
            letters: this.letterChain.map(l => ({letter: l.letter, coordinates: l.coordinates}))
        }

        this.sendAction(LexiblePlayerAction.WordSubmit, submissionData)

        this.letterChain[0].selectForPlayer(this.playerId, false);
    }

    // -------------------------------------------------------------------
    // handleScoredWordMessage
    // -------------------------------------------------------------------
    protected handleScoredWordMessage = (message: LexibleScoredWordMessage) => {
        message.letters.forEach(l => {
            const block = this.theGrid.getBlock(l.coordinates)
            if(!block) console.error(`WEIRD: No block at ${l.coordinates}`)
            else block.setScore( Math.max(message.score, block.score), message.team);
        })
        this.saveCheckpoint();
        this.ackMessage(message);  
        this.invokeEvent(LexibleGameEvent.WordAccepted)
    }

    // -------------------------------------------------------------------
    // handleFailedWordMessage
    // -------------------------------------------------------------------
    protected handleFailedWordMessage = (message: LexibleFailedWordMessage) => {
        message.letters.forEach(w => {
            const block = this.theGrid.getBlock(w.coordinates)
            if(!block) {
                console.error(`No block at ${JSON.stringify(w.coordinates)}`)
            }
            else block.fail()
        })
        this.saveCheckpoint();
        this.ackMessage(message);
    }

    // -------------------------------------------------------------------
    // handleWordHintMessage
    // -------------------------------------------------------------------
    protected handleWordHintMessage = (message: LexibleWordHintMessage) => {
        this._wordList = message.wordList;
        this.saveCheckpoint();
        this.ackMessage(message);
    }

    // -------------------------------------------------------------------
    // handleEndOfRoundMessage
    // -------------------------------------------------------------------
    protected handleEndOfRoundMessage = (message: LexibleEndOfRoundMessage) => {
        this.winningTeam = message.winningTeam;
        this.gameState = LexibleClientState.EndOfRound;

        this.saveCheckpoint();
        this.ackMessage(message);
    }

    // -------------------------------------------------------------------
    // handlePlayRequestMessage 
    // -------------------------------------------------------------------
    protected handlePlayRequestMessage = (message: LexiblePlayRequestMessage) => {
        if(this.gameState === GeneralClientState.WaitingToStart) {
            this.logger.logEvent("Client", "Start");
        }
        this.roundNumber = message.roundNumber;
        this.myTeam = message.teamName;

        this.setupPlayBoard(message.playBoard)

        this.gameState = LexibleClientState.Playing;

        this.saveCheckpoint();
        this.ackMessage(message);
    }

    // -------------------------------------------------------------------
    // setBlockHandlers 
    // -------------------------------------------------------------------
    setBlockHandlers(block: LetterBlockModel) {

        const isNextLetter = ()=> {
            if(this.letterChain.length > 0) {
                const previousBlock = this.letterChain[this.letterChain.length-1];
                if(Math.abs(previousBlock.coordinates.x - block.coordinates.x) > 1) {
                    return false;
                }
                else if(Math.abs(previousBlock.coordinates.y - block.coordinates.y) > 1) {
                    return false
                }
            }
            return true;
        };

        const deleteBlocksFromIndex = (index: number, playerId: string) => {
            if(index > -1) {
                const deletedBlocks = this.letterChain.splice(index)
                deletedBlocks.forEach(b => b.selectForPlayer(playerId, false))
            }
        }

        block.onSelectedChanged = (playerId, selectedValue)=> {
            let isFirst = false;
            action(()=>{
                if(selectedValue) {
                    if(this.letterChain.length === 0) {
                        isFirst = true;
                    }
                    else if(!isNextLetter()){
                        deleteBlocksFromIndex(0, playerId);
                        isFirst = true;
                    }
                    this.letterChain.push(block);               
                }
                else {
                    const index = this.letterChain.findIndex(b => b.__blockid === block.__blockid);
                    deleteBlocksFromIndex(index, playerId);

                    if(this.letterChain.length === 0) this._wordList = []
                }

                this.sendAction(LexiblePlayerAction.LetterSelect, {
                    coordinates:block.coordinates, 
                    playerId, 
                    selectedValue: selectedValue,
                    isFirst
                })
                this.saveCheckpoint();
            })()
        }
    }

    // -------------------------------------------------------------------
    // setupPlayBoard 
    // -------------------------------------------------------------------
    setupPlayBoard(playBoard: PlayBoard) {

        const newGrid = new LetterGridModel(playBoard.gridWidth, playBoard.gridHeight)
        newGrid.deserialize(playBoard.gridData)
        newGrid.processBlocks(b => this.setBlockHandlers(b))
        action(()=>{this.theGrid = newGrid;})()
    }

    // -------------------------------------------------------------------
    // reconstitute 
    // -------------------------------------------------------------------
    reconstitute() {
        this.theGrid.processBlocks(b => this.setBlockHandlers(b))
    }

    // -------------------------------------------------------------------
    // sendAction 
    // -------------------------------------------------------------------
    protected sendAction(action: LexiblePlayerAction, actionData: LetterSelectData | WordSubmissionData = null) {
        const message = new LexiblePlayerActionMessage(
            {
                sender: this.session.personalId,
                roundNumber: this.roundNumber,
                action,
                actionData
            }
        );

        this.session.sendMessageToPresenter(message);
    }

    // // -------------------------------------------------------------------
    // // Tell the presenter to change my color
    // // -------------------------------------------------------------------
    // doColorChange(){
    //     const hex = Array.from("0123456789ABCDEF");
    //     let colorStyle = "#";
    //     for(let i = 0; i < 6; i++) colorStyle += this.randomItem(hex);
    //     this.sendAction("ColorChange", {colorStyle})
    // }
   
    // // -------------------------------------------------------------------
    // // Tell the presenter to show a message for me
    // // -------------------------------------------------------------------
    // doMessage(){
    //     const messages = ["Hi!", "Bye?", "What's up?", "Oh No!", "Hoooooweeee!!", "More gum."]
    //     this.sendAction("Message", {text: this.randomItem(messages)})
    // }
   
    // // -------------------------------------------------------------------
    // // Tell the presenter that I tapped somewhere
    // // -------------------------------------------------------------------
    // doTap(x: number, y: number){
    //     x = Math.floor(x * 1000)/1000;
    //     y = Math.floor(y * 1000)/1000;
        
    //     this.sendAction("Tap", {x,y})
    // }
}
