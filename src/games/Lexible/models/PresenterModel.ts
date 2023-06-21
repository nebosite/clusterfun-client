// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game

import { ClusterFunGameProps, ISessionHelper, ITypeHelper, Vector2 } from "libs";
import { action, observable } from "mobx";
import { LetterBlockModel } from "./LetterBlockModel";
import { LetterGridModel } from "./LetterGridModel";
import { LexibleGameEvent, LexiblePlayer, MapSize } from "./lexibleDataTypes";
import { ClusterfunPresenterModel } from "libs/GameModel/ClusterfunPresenterModel";
import { LexibleBoardUpdateEndpoint, LexibleBoardUpdateNotification, LexibleEndOfRoundMessage, LexibleOnboardPresenterEndpoint, LexibleOnboardPresenterMessage, LexiblePushFullPresenterUpdateEndpoint, PlayBoard } from "./lexibleEndpoints";
import Logger from "js-logger";
import { LetterGridPath, findHotPathInGrid } from "./LetterGridPath";
import { LexibleClientState } from "./ClientModel";

// -------------------------------------------------------------------
export const getLexiblePresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "LexiblePresenterModel",
        getTypeName(o) {
            switch (o.constructor) {
                case LetterGridModel: return "LetterGridModel";
                case LetterBlockModel: return "LetterBlockModel";
                case LexiblePresenterModel: return "LexiblePresenterModel";
                case LexiblePlayer: return "LexiblePlayer";
                case Vector2: return "Vector2";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "LetterGridModel": return new LetterGridModel();
                case "LetterBlockModel": return new LetterBlockModel("_");
                case "LexiblePresenterModel": return new LexiblePresenterModel("Lexible", sessionHelper, gameProps.logger, gameProps.storage);
                case "LexiblePlayer": return new LexiblePlayer();
                case "Vector2": return new Vector2(0,0);
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            switch(propertyName)
            {
                case "__blockid": 
                case "failFade": 
                case "wordTree":
                case "wordSet": return false;
            } 

            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            switch(propertyName)
            {
                case "selectMap": return observable(rehydratedObject as string[])
            } 

            return rehydratedObject;
        }
     }
}

export class LexiblePresenterModel extends ClusterfunPresenterModel<LexiblePlayer> {
    @observable theGrid = new LetterGridModel();

    @observable private _roundWinningTeam = "";
    get roundWinningTeam() { return this._roundWinningTeam}
    set roundWinningTeam(value) { action(()=>{this._roundWinningTeam = value})()}

    @observable  private _startFromTeamArea = true
    get startFromTeamArea() {return this._startFromTeamArea}
    set startFromTeamArea(value) {action(()=>{
        this._startFromTeamArea = value;
    })()}
    
    @observable  private _mapSize = MapSize.Medium;
    get mapSize() {return this._mapSize}
    set mapSize(value) {action(()=>{
        this._mapSize = value;
    })()}

    get gameTimeMinutes() {
        return this.gameTime_ms / (60000)
    }

    _teamPoints:number[] = observable([0,0])
    get gameWinningTeam() {
        if(this._teamPoints[0] > this._teamPoints[1]) return "A";
        if(this._teamPoints[0] < this._teamPoints[1]) return "B";
        else return undefined;
    }

    get longestWord() {
        let longestWord = {value: "_", playerName: "na"};
        this.players.forEach(p => {
            if(p.longestWord.length > longestWord.value.length) {
                longestWord.value = p.longestWord;
                longestWord.playerName = p.name;
            }
        })
        return longestWord;
    }

    get mostCaptures() {
        let mostCaptures = {value: 0, playerName: "na"};
        this.players.forEach(p => {
            if(p.captures > mostCaptures.value) {
                mostCaptures.value = p.captures;
                mostCaptures.playerName = p.name;
            }
        })
        return mostCaptures;
    }

    reconstitute(): void {
        super.reconstitute();
        this.listenToEndpointFromHost(LexiblePushFullPresenterUpdateEndpoint, this.handleFullPresenterUpdate);
        this.listenToEndpointFromHost(LexibleBoardUpdateEndpoint, this.handleBoardUpdateMessage);
    }

    async requestGameStateFromHost(): Promise<void> {
        const payload = await this.session.requestHost(LexibleOnboardPresenterEndpoint, {});
        this.handleFullPresenterUpdate(payload);
    }

    handleFullPresenterUpdate = (payload: LexibleOnboardPresenterMessage) => {
        action(() => { this.currentRound = payload.roundNumber })();
        this.gameState = payload.gameState;
        this.startFromTeamArea = payload.settings.startFromTeamArea;
        this.mapSize = payload.settings.mapSize;
        this.roundWinningTeam = payload.roundWinningTeam;
        this._teamPoints[0] = payload.teamPoints[0];
        this._teamPoints[1] = payload.teamPoints[1];

        this.setupPlayBoard(payload.playBoard);

        const playerIdsToRemove = new Set(this.players.map(p => p.playerId));
        for (const incomingPlayer of payload.players) {
            const currentPlayer = this.players.find(p => p.playerId === incomingPlayer.playerId);
            if (currentPlayer) {
                Object.assign(currentPlayer, incomingPlayer);
                playerIdsToRemove.delete(currentPlayer.playerId);
            } else {
                const newPlayer = new LexiblePlayer();
                Object.assign(newPlayer, incomingPlayer);
                this.players.push(newPlayer);
            }
        }
        for (let i = 0; i < this.players.length;) {
            if (playerIdsToRemove.has(this.players[i].playerId)) {
                this.players.splice(i, 1);
            } else {
                i++;
            }
        }
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

    protected handleBoardUpdateMessage = (message: LexibleBoardUpdateNotification) => {
        message.letters.forEach(l => {
            const block = this.theGrid.getBlock(l.coordinates)
            if(!block) Logger.warn(`WEIRD: No block at ${l.coordinates}`)
            else block.setScore( Math.max(message.score, block.score), message.scoringTeam);
        })
        this.updateWinningPaths();
        this.saveCheckpoint();
        this.invokeEvent(LexibleGameEvent.WordAccepted, message.word.toLowerCase(), message.scoringTeam);
    }

    // -------------------------------------------------------------------
    // handleEndOfRoundMessage
    // -------------------------------------------------------------------
    protected handleEndOfRoundMessage = (message: LexibleEndOfRoundMessage) => {
        this.invokeEvent(LexibleGameEvent.TeamWon, message.winningTeam);
        this.gameState = LexibleClientState.EndOfRound;

        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    // setupPlayBoard 
    // -------------------------------------------------------------------
    setupPlayBoard(playBoard: PlayBoard) {
        const newGrid = new LetterGridModel(playBoard.gridWidth, playBoard.gridHeight)
        newGrid.deserialize(playBoard.gridData)
        action(()=>{this.theGrid = newGrid;})()
    }

}