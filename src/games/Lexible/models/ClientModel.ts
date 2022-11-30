import { action, makeObservable, observable } from "mobx";
import { LetterBlockModel } from "./LetterBlockModel";
import { LetterGridModel } from "./LetterGridModel";
import { LexibleGameEvent } from "./PresenterModel";
import { ISessionHelper, ClusterFunGameProps, Vector2, ClusterfunClientModel, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper } from "libs";
import Logger from "js-logger";
import { findHotPathInGrid, LetterGridPath } from "./LetterGridPath";
import { LexibleBoardUpdateEndpoint, LexibleBoardUpdateNotification, LexibleEndOfRoundMessage, LexibleEndRoundEndpoint, LexibleOnboardClientEndpoint, LexibleRecentlyTouchedLettersMessage, LexibleRequestTouchLetterEndpoint, LexibleShowRecentlyTouchedLettersEndpoint, LexibleSubmitWordEndpoint, LexibleWordSubmissionRequest, PlayBoard } from "./lexibleEndpoints";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getLexibleClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "LexibleClientModel",
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

    @observable  private _myTeam = "_"
    get myTeam() {return this._myTeam}
    set myTeam(value) {action(()=>{this._myTeam = value})()}

    @observable  private _winningTeam = ""
    get winningTeam() {return this._winningTeam}
    set winningTeam(value) {action(()=>{this._winningTeam = value})()}

    @observable  private _wordList = [] as string[]
    get wordList() {
        const prefix = this.activeWord;
        return this._wordList.filter(w => w.startsWith(prefix))   
    }
    set wordList(value) {action(()=>{this._wordList = value})()}
    
    get activeWord() {
        let output = "";
        this.letterChain.forEach(b => output += b.letter.toUpperCase())
        return output;
    }

    startFromTeamArea = true;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("LexibleClient", sessionHelper, playerName, logger, storage);

        sessionHelper.listen(LexibleShowRecentlyTouchedLettersEndpoint, this.handleRecentlyTouchedMessage);
        sessionHelper.listen(LexibleEndRoundEndpoint, this.handleEndOfRoundMessage);
        sessionHelper.listen(LexibleBoardUpdateEndpoint, this.handleBoardUpdateMessage); 

        makeObservable(this);
    }

    async requestGameStateFromPresenter(): Promise<void> {
        const onboardState = await this.session.request(LexibleOnboardClientEndpoint, this.session.presenterId, {})
        if(this.gameState === GeneralClientGameState.WaitingToStart) {
            this.telemetryLogger.logEvent("Client", "Start");
        }
        this.roundNumber = onboardState.roundNumber;
        this.myTeam = onboardState.teamName;
        this.startFromTeamArea = onboardState.settings.startFromTeamArea;

        this.setupPlayBoard(onboardState.playBoard)

        this.gameState = LexibleClientState.Playing;

        this.saveCheckpoint();
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    toggleSelect(block: LetterBlockModel, playerId: string) {
        let selectable = true;
        let isSelected = block.isSelectedByPlayer(playerId)
        if(!isSelected) {
            if (    this.startFromTeamArea 
                &&  this.letterChain.length === 0 
                &&  block.team !== this.myTeam) 
            {
                selectable = false;
            }
        }
        
        if(selectable) {
            block.selectForPlayer(playerId, !isSelected) 
        } 
    }

    // -------------------------------------------------------------------
    // submitWord 
    // -------------------------------------------------------------------
    async submitWord() {
        if(this.letterChain.length === 0) {
            Logger.warn("WEIRD:  should have been letters in the letter chain")
            return;
        }

        const submissionData: LexibleWordSubmissionRequest = {
            letters: this.letterChain.map(l => ({letter: l.letter, coordinates: l.coordinates}))
        }

        const response = await this.session.request(LexibleSubmitWordEndpoint, this.session.presenterId, submissionData)
        if (response.success) {
            this.invokeEvent(LexibleGameEvent.WordAccepted)
        } else {
            response.letters.forEach(l => {
                const block = this.theGrid.getBlock(l.coordinates)
                if(!block) {
                    Logger.warn(`WEIRD: No block at ${JSON.stringify(l.coordinates)}`)
                }
                else block.fail()
            })
        }

        this.letterChain[0].selectForPlayer(this.playerId, false);
    }

        // -------------------------------------------------------------------
    //  checkForWin - a win is when there is a contiguous line of blocks
    //                from one side to the other for a single team. 
    //                Blocks are not continguous through corners.
    // -------------------------------------------------------------------
    async updateWinningPaths() {
        this.theGrid.processBlocks(b => { b.onPath = false; })
        await this.waitForRealTime(0); // allow mobx to clear animations
        const paths: Record<"A" | "B", LetterGridPath> = {
            "A": findHotPathInGrid(this.theGrid, "A"),
            "B": findHotPathInGrid(this.theGrid, "B")
        }
        let pathsToDraw: Array<"A" | "B"> = ["A","B"];
        for (const team of ["A", "B"] as Array<"A" | "B">) {
            const path = paths[team];
            if (path.cost.enemy === 0 && path.cost.neutral === 0) {
                pathsToDraw = [team];
            }
        }
        for (let i = 0; i < this.theGrid.width * 4; i++) {
            let paintedOne = false;
            for (const team of pathsToDraw) {
                if (paths[team].nodes.length > i) {
                    paintedOne = true;
                    this.theGrid.getBlock(paths[team].nodes[i])!.onPath = true;
                }
            }
            if (!paintedOne) {
                break;
            } else {
                await this.waitForRealTime(50);
            }
        }
    }

    protected handleBoardUpdateMessage = (sender: string, message: LexibleBoardUpdateNotification) => {
        message.letters.forEach(l => {
            const block = this.theGrid.getBlock(l.coordinates)
            if(!block) Logger.warn(`WEIRD: No block at ${l.coordinates}`)
            else block.setScore( Math.max(message.score, block.score), message.scoringTeam);
        })
        this.updateWinningPaths();
        this.saveCheckpoint();
        this.invokeEvent(LexibleGameEvent.WordAccepted);
    }

    // -------------------------------------------------------------------
    // handleRecentlyTouchedMessage
    // -------------------------------------------------------------------
    protected handleRecentlyTouchedMessage = (sender: string, message: LexibleRecentlyTouchedLettersMessage) => {
        message.letterCoordinates.forEach(c => {
            const block = this.theGrid.getBlock(c)
            if(!block) {
                Logger.warn(`WEIRD: No block at ${JSON.stringify(c)}`)
            }
            else block.fail()
        })
    }

    // -------------------------------------------------------------------
    // handleEndOfRoundMessage
    // -------------------------------------------------------------------
    protected handleEndOfRoundMessage = (sender: string, message: LexibleEndOfRoundMessage) => {
        this.winningTeam = message.winningTeam;
        this.gameState = LexibleClientState.EndOfRound;

        this.saveCheckpoint();
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

                    if(this.letterChain.length === 0) this.wordList = []
                }

                this.session.request(LexibleRequestTouchLetterEndpoint, this.session.presenterId, {
                    touchPoint: block.coordinates
                }).forget();
                
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
}
