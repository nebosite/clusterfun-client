import { action, makeObservable, observable } from "mobx"

import { PLAYTIME_MS } from "./GameSettings";
import { LetterBlockModel } from "./LetterBlockModel";
import { WordTree } from "./WordTree";
import { LetterGridModel } from "./LetterGridModel";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, Vector2, ClusterfunPresenterModel, ITelemetryLogger, IStorage, GeneralGameState, PresenterGameEvent, PresenterGameState, ITypeHelper } from "libs";
import Logger from "js-logger";
import { findHotPathInGrid, LetterGridPath } from "./LetterGridPath";
import { LetterChain, LexibleBoardUpdateEndpoint, LexibleEndRoundEndpoint, LexibleOnboardClientEndpoint, 
    LexibleOnboardClientMessage, LexibleRecentlyTouchedLettersMessage, LexibleReportTouchLetterEndpoint, 
    LexibleRequestWordHintsEndpoint, LexibleServerRecentlyTouchedLettersEndpoint, LexibleSubmitWordEndpoint, 
    LexibleSwitchTeamEndpoint, 
    LexibleSwitchTeamRequest, 
    LexibleSwitchTeamResponse, 
    LexibleTouchLetterRequest, LexibleWordHintRequest, LexibleWordHintResponse, 
    LexibleWordSubmissionRequest, LexibleWordSubmissionResponse, PlayBoard } from "./lexibleEndpoints";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";

const LEXIBLE_SETTINGS_KEY = "lexible_settings";
const SEND_RECENT_LETTERS_INTERVAL_MS = 200;

export enum LexiblePlayerStatus {
    Unknown = "Unknown",
    WaitingForStart = "WaitingForStart",
}

export class LexiblePlayer extends ClusterFunPlayer {
    @observable totalScore = 0;
    @observable status = LexiblePlayerStatus.Unknown;
    @observable message = "";
    @observable colorStyle= "#ffffff";
    @observable x = 0;
    @observable y = 0;
    @observable teamName = "X";
    @observable longestWord = "";
    @observable captures = 0;
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum LexibleGameState {
    EndOfRound = "EndOfRound",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum LexibleGameEvent {
    ResponseReceived = "ResponseReceived",
    WordAccepted = "WordAccepted",
    TeamWon = "TeamWon"
}

//--------------------------------------------------------------------------------------
// 
//--------------------------------------------------------------------------------------
export enum MapSize {
    Small = "Small",
    Medium = "Medium", 
    Large = "Large"
}

interface LexibleSettings {
    mapSize: MapSize,
    startFromTeamArea: boolean
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
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
                case "LexiblePresenterModel": return new LexiblePresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
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

// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class LexiblePresenterModel extends ClusterfunPresenterModel<LexiblePlayer> {

    @observable theGrid = new LetterGridModel();

    @observable private _roundWinningTeam = "";
    get roundWinningTeam() { return this._roundWinningTeam}
    set roundWinningTeam(value) { action(()=>{this._roundWinningTeam = value})()}

    @observable  private _startFromTeamArea = true
    get startFromTeamArea() {return this._startFromTeamArea}
    set startFromTeamArea(value) {action(()=>{
        this._startFromTeamArea = value;
        this.saveSettings();
    })()}
    
    @observable  private _mapSize = MapSize.Medium;
    get mapSize() {return this._mapSize}
    set mapSize(value) {action(()=>{
        this._mapSize = value;
        this.saveSettings();
    })()}

    get gameTimeMinutes() {
        return this.gameTime_ms / (60000)
    }
    

    letterData = [
        { letter:'E', ratio:0.1013},
        { letter:'A', ratio:0.085},
        { letter:'R', ratio:0.0758},
        { letter:'I', ratio:0.0754},
        { letter:'O', ratio:0.0716},
        { letter:'T', ratio:0.0695},
        { letter:'N', ratio:0.0665},
        { letter:'S', ratio:0.0574},
        { letter:'L', ratio:0.0549},
        { letter:'C', ratio:0.0454},
        { letter:'U', ratio:0.0363},
        { letter:'D', ratio:0.0338},
        { letter:'P', ratio:0.0317},
        { letter:'M', ratio:0.0301},
        { letter:'H', ratio:0.03},
        { letter:'G', ratio:0.0247},
        { letter:'B', ratio:0.0207},
        { letter:'F', ratio:0.0181},
        { letter:'Y', ratio:0.0178},
        { letter:'W', ratio:0.0129},
        { letter:'K', ratio:0.011},
        { letter:'V', ratio:0.0101},
        { letter:'X', ratio:0.004},
        { letter:'Z', ratio:0.006},
        { letter:'J', ratio:0.005},
        { letter:'Q', ratio:0.005},
    ];

    wordTree: WordTree;
    wordSet = new Set<string>();
    badWords = new Set<string>();

    gameTimeLastSentTouchedLetters_ms = 0;
    recentlyTouchedLetters = new Map<number, Vector2>();
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

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Lexible", sessionHelper, logger, storage);

        this.allowedJoinStates.push(GeneralGameState.Playing, GeneralGameState.Paused, GeneralGameState.Instructions)
        
        this.minPlayers = 2;

        this.wordTree = WordTree.create([]);
        
        const savedSettingsValue = storage.get(LEXIBLE_SETTINGS_KEY);
        if (savedSettingsValue) {
            const savedSettings = JSON.parse(savedSettingsValue) as LexibleSettings;
            this.mapSize = savedSettings.mapSize ?? MapSize.Medium;
            this.startFromTeamArea = savedSettings.startFromTeamArea ?? true;
        }

        makeObservable(this);
    }


    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.populateWordSet();
        this.subscribe(PresenterGameEvent.PlayerJoined, this.name, this.handlePlayerJoin)
        this.listenToEndpoint(LexibleOnboardClientEndpoint, this.handleOnboardClient);
        this.listenToEndpoint(LexibleReportTouchLetterEndpoint, this.handleTouchLetterMessage);
        this.listenToEndpoint(LexibleRequestWordHintsEndpoint, this.handleWordHintMessage);
        this.listenToEndpoint(LexibleSubmitWordEndpoint, this.handleSubmitWordMessage);
        this.listenToEndpoint(LexibleSwitchTeamEndpoint, this.handleSwitchTeam);
        // TODO: Make this method cleanuppable
        // this.session.onError(err => {
        //     Logger.error(`Session error: ${err}`)
        //     this.quitApp();
        // })
        this.theGrid.processBlocks((block)=>{this.setBlockHandlers(block)})
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    saveSettings() {
        const savedSettings: LexibleSettings = {
            mapSize: this.mapSize,
            startFromTeamArea: this.startFromTeamArea
        }
        this.storage.set(LEXIBLE_SETTINGS_KEY, JSON.stringify(savedSettings, null, 2));
    }

    // -------------------------------------------------------------------
    //  populateWordSet - asynchronously load the words from the compressed 
    //                    word list
    // -------------------------------------------------------------------
    private async populateWordSet() {
        const wordListPromise = import("../assets/words/Collins_Scrabble_2019");
        const badWordsPromise = import("../assets/words/badwords");

        const { wordList } = await wordListPromise;
        let lastAwaitTime = window.performance.now();
        const words = wordList.split('\n')
        this.wordTree = new WordTree("", undefined);
        for (const word of words) {
            if (window.performance.now() - lastAwaitTime > 10) {
                await this.waitForRealTime(0);
                if (this.isShutdown) return;
                lastAwaitTime = window.performance.now();
            }
            this.wordTree.add(word.trim());
            this.wordSet.add(word.trim());
        }
        Logger.info(`Loaded ${this.wordSet.size} words`)

        const { badWordList } = await badWordsPromise;
        const badWords = badWordList.split('\n');
        for (const badWord of badWords) {
            if (window.performance.now() - lastAwaitTime > 5) {
                await this.waitForRealTime(0);
                if (this.isShutdown) return;
                lastAwaitTime = window.performance.now();
            }
            this.badWords.add(badWord.trim());
        }
        Logger.info(`Loaded ${this.badWords.size} censored words`)
    }

    // -------------------------------------------------------------------
    // handlePlayerJoin 
    // -------------------------------------------------------------------
    handlePlayerJoin = (player: LexiblePlayer) => {

        if(player.teamName === "X") {
            // See how many players on each team
            const teamA = this.players.filter(p => p.teamName === "A")
            const teamB = this.players.filter(p => p.teamName === "B")

            // Add to smallest
            if(teamA.length < teamB.length) player.teamName = "A";
            else if(teamB.length < teamA.length) player.teamName = "B";
            else {
                player.teamName = "AB"[Date.now() % 2]
            }
        }

        Logger.debug(`Joined game state: ${this.gameState}`)
    }

    // -------------------------------------------------------------------
    // setBlockHandlers 
    // -------------------------------------------------------------------
    setBlockHandlers(block: LetterBlockModel) {
        block.onSelectedChanged = this.handleLetterSelect
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    handleLetterSelect = (playerId: string, selectedValue: boolean) => {
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): LexiblePlayer
    {
        const newPlayer = new LexiblePlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;

        return newPlayer;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.gameState = PresenterGameState.Gathering;
        this.currentRound = 0;
        this._teamPoints.fill(0)
    }

    // -------------------------------------------------------------------
    //  prepareFreshRound - called automatically before every round
    // -------------------------------------------------------------------
    prepareFreshRound = () => {
        const boardRatio = 34/24;

        let boardWidth = 20 + 2 * this.players.length;
        switch(this.mapSize) {
            case MapSize.Small: boardWidth *=.6; break;
            case MapSize.Large: boardWidth *= 1.5; break;
        }

        const newGrid = new LetterGridModel(Math.floor(boardWidth), Math.floor(boardWidth/boardRatio));


        const letterCount = newGrid.width * newGrid.height + 20;
        const letterDeck: string[] = []

        // Assemble a collection of letters to choose from
        this.letterData.forEach(item => {
            const toPlace = Math.floor(item.ratio * letterCount)
            for(let i = 0; i < toPlace; i++)
            {
                letterDeck.push(item.letter);
            }
        }) 

        // shuffle
        for(let i = 0; i < letterDeck.length - 1; i++)
        {
            const pick = i + 1 + this.randomInt(letterDeck.length-i-1)
            const temp = letterDeck[i];
            letterDeck[i] = letterDeck[pick]
            letterDeck[pick] = temp;
        }
  
        newGrid.populate(letterDeck.map(l=>`${l}_0`).join(""))
        if(this.startFromTeamArea) {
            for (let y = 0; y < newGrid.height; y++)
            {
                newGrid.getBlock(new Vector2(0,y))!.setScore(4, "A")
                newGrid.getBlock(new Vector2(newGrid.width-1,y))!.setScore(4, "B")
            }
        }
        newGrid.processBlocks((block)=>{this.setBlockHandlers(block)})


        // done!
        this.theGrid = newGrid;
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.recentlyTouchedLetters.size > 0) {
            if (this.gameTime_ms - this.gameTimeLastSentTouchedLetters_ms > SEND_RECENT_LETTERS_INTERVAL_MS) {
                this.gameTimeLastSentTouchedLetters_ms = this.gameTime_ms;
                const letterCoordinates = Array.from(this.recentlyTouchedLetters.values());
                this.recentlyTouchedLetters.clear();
                const message: LexibleRecentlyTouchedLettersMessage = { letterCoordinates }
                this.sendToEveryone(LexibleServerRecentlyTouchedLettersEndpoint, () => message);
            }
        }
    }

    // -------------------------------------------------------------------
    //  createPlayRequestMessage
    // -------------------------------------------------------------------
    createPlayRequestMessage(teamName: string) {
        const playBoard:PlayBoard = {
            gridHeight: this.theGrid.height,
            gridWidth: this.theGrid.width,
            gridData: this.theGrid.serialize()
        }
        const payload = { 
            sender: this.session.personalId,
            roundNumber: this.currentRound,
            playBoard,
            teamName,
            settings: {startFromTeamArea: this.startFromTeamArea}
        }
        return payload;
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    doneGathering(){
        this.gameState = GeneralGameState.Instructions;
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.prepareFreshRound();
        this.gameState = GeneralGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            p.status = LexiblePlayerStatus.WaitingForStart;
            p.message = "";
            p.colorStyle = "white";
            p.x = .1;
            p.y = i * .1 + .1;
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.requestEveryone(GameOverEndpoint, (p,ie) => ({}))
                .then(_result => {})
                .catch(err => {
                    console.warn("Not able to send Game Over to everyone:", err)
                })
        }    
        else {
            this.sendToEveryone(InvalidateStateEndpoint, (p, ie) => ({}));
        }
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  findWords 
    // -------------------------------------------------------------------
    findWords(startBlock: LetterBlockModel) {

        const selectedBlocks = new Set<number>();

        const findHere = (block: LetterBlockModel, parentSpot: WordTree):string[] => {
            const output: string[] = []
            // ignore blocks off the board or seleced block
            if(selectedBlocks.has(block.__blockid)) return output;

            let wordSpot: WordTree | undefined = parentSpot;
            for(let i =0; i < block.letter.length; i++) {
                wordSpot = wordSpot?.branch(block.letter[i].toUpperCase())
            }
            if(!wordSpot) return output;
            
            const word = wordSpot.myWord; 
            
            if(word && (word.length >= 3))  {
                output.push(word)
            }

            selectedBlocks.add(block.__blockid);

            for(let x = -1; x <= 1; x++) {
                for(let y = -1; y <= 1; y++) {
                    const neighborSpot = new Vector2(x,y).add(block.coordinates);
                    const neighborBlock = this.theGrid.getBlock(neighborSpot);
                    if(neighborBlock){
                        output.push(...findHere(neighborBlock, wordSpot))  
                    }
                }
            }
            selectedBlocks.delete(block.__blockid);
            return output;
        }

        const words = findHere(startBlock, this.wordTree)
        const returnMe: string[] = []
        words.forEach(w => {
            if(!returnMe.find(item => item === w)
                && !this.badWords.has(w)
            )  {
                returnMe.push(w)
            } 
        } )
        returnMe.sort();
        returnMe.sort((a,b) => b.length - a.length);
        return returnMe;
    }

    // -------------------------------------------------------------------
    //  checkForWin - a win is when there is a contiguous line of blocks
    //                from one side to the other for a single team. 
    //                Blocks are not continguous through corners.
    // -------------------------------------------------------------------
    async checkForWin() {
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
                this.handleGameWin(team);
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

    // -------------------------------------------------------------------
    //  handleGameWin 
    // -------------------------------------------------------------------
    handleGameWin(team: string) {
        this.roundWinningTeam = team;
        switch(team) {
            case "A": this._teamPoints[0]++; break;
            case "B": this._teamPoints[1]++; break;
            default: console.log(`WEIRD: unexpected team value: ${team}`)
        }
        this.gameState = LexibleGameState.EndOfRound
        this.invokeEvent(LexibleGameEvent.TeamWon, team)
        this.sendToEveryone(LexibleEndRoundEndpoint, (p, ie) => {
            return { roundNumber: this.currentRound, winningTeam: team }
        })
    }
    
    // -------------------------------------------------------------------
    //  placeSuccessfulWord 
    // -------------------------------------------------------------------
    placeSuccessfulWord(data: LexibleWordSubmissionRequest, word: string, player: LexiblePlayer) {
        const placedLetters: LetterChain = []
        data.letters.forEach(l => {
            const block = this.theGrid.getBlock(l.coordinates)
            if(!block) {
                console.log(`WEIRD: placeSuccessfulWord: no block at `, l.coordinates)
                return;
            }
            // only capture this block if the score is high enough
            if(word.length > block.score){
                if(block.team !== "_" && block.team !== player.teamName) {
                    player.captures++
                }
                block.setScore( Math.max(word.length, block.score), player.teamName);  
                placedLetters.push(l);                
            }
            // however, do mark redundant word submissions
            if (word.length === block.score && block.team === player.teamName) {
                placedLetters.push(l);
            }
        })

        if(word.length > player.longestWord.length) player.longestWord = word;

        this.sendToEveryone(LexibleBoardUpdateEndpoint, (p, isExited) => {
            return {
                letters: placedLetters,
                score: word.length,
                scoringPlayerId: player.playerId,
                scoringTeam: player.teamName
            }
        });

        this.invokeEvent(LexibleGameEvent.WordAccepted, word.toLowerCase(), player)
        if (player.teamName === "A" || player.teamName === "B") {
            this.checkForWin();
        } else {
            Logger.warn("WEIRD: Player with unknown teamname")
        }
        this.saveCheckpoint();
    }

    handleOnboardClient = (sender: string, message: unknown): LexibleOnboardClientMessage => {
        const player = this.players.find(p => p.playerId === sender);
        if (!player) {
            throw new Error("Sending player has not joined yet");
        }
        const playBoard:PlayBoard = {
            gridHeight: this.theGrid.height,
            gridWidth: this.theGrid.width,
            gridData: this.theGrid.serialize()
        }
        const payload: LexibleOnboardClientMessage = { 
            gameState: this.gameState,
            roundNumber: this.currentRound,
            playBoard,
            teamName: player.teamName,
            settings: {startFromTeamArea: this.startFromTeamArea}
        }
        this.telemetryLogger.logEvent("Presenter", "Onboard Client")
        return payload;
    }

    handleWordHintMessage = (sender: string, message: LexibleWordHintRequest): LexibleWordHintResponse => {
        if (message.currentWord.length < 1) throw Error("No word submitted");

        const block = this.theGrid.getBlock(message.currentWord[0].coordinates);
        if (!block) throw Error("Word coordinate does not correspond to an existing block");
        if (block.letter !== message.currentWord[0].letter) throw Error("Desync: client thinks letter is different");

        const wordList = this.findWords(block);
        return { wordList };
    }

    handleTouchLetterMessage = (sender: string, message: LexibleTouchLetterRequest): void => {
        if (message.touchPoint.x < 0 || message.touchPoint.x >= this.theGrid.width
            || message.touchPoint.y < 0 || message.touchPoint.y >= this.theGrid.height) {
                Logger.warn("Touched letter coordinates are out of bounds");
                return;
            }
        this.recentlyTouchedLetters.set(message.touchPoint.x * 1000 + message.touchPoint.y, message.touchPoint);
    }

    handleSubmitWordMessage = (sender: string, request: LexibleWordSubmissionRequest): LexibleWordSubmissionResponse => {
        const player = this.players.find(p => p.playerId === sender);
        if (!player) throw Error("Unknown player attempted to submit a word");

        let scoreTooLow = false;
        const word = request.letters.map((l,index) => {
            if(!l.coordinates) throw Error(`No coordinate on submitted letter: ${JSON.stringify(l)}`)
            const block = this.theGrid.getBlock(l.coordinates);
            if(!block)  return "#"
            if(this.startFromTeamArea
                && index === 0 
                && player.teamName !== block.team) {
                    return "#"
                }
            // // don't allow letter for spelling unless score is hight
            // if( block.team !== player.teamName
            //     && block.score >= data.letters.length) scoreTooLow = true;
            if(block.letter === l.letter) return l.letter.toUpperCase()
            else return "#"
        }).join("");


        if(!scoreTooLow && this.wordSet.has(word.toUpperCase())) {
            this.placeSuccessfulWord(request, word, player);
            return {
                success: true,
                letters: request.letters
            }
        }
        else {
            Logger.info(`Failed word '${word}' because ${(scoreTooLow ? "Low score" : "Not found" )}`)
            return {
                success: false,
                letters: request.letters
            };
        }
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    handleSwitchTeam = (sender: string, request: LexibleSwitchTeamRequest) : LexibleSwitchTeamResponse => {
        const player = this.players.find(p => p.playerId === sender);
        if (!player) throw Error("Unknown player attempted to switch teams");

        const TeamA = this.players.filter(p => p.teamName === "A")
        const TeamB = this.players.filter(p => p.teamName === "B")

        if(request.desiredTeam === "A" 
            && !TeamA.find(p => p.playerId === player.playerId)
            && TeamB.length > 1) {
                player.teamName = request.desiredTeam
        }
        if(request.desiredTeam === "B" 
            && !TeamB.find(p => p.playerId === player.playerId)
            && TeamA.length > 1) {
                player.teamName = request.desiredTeam
        }

        return {currentTeam: player.teamName}
    }
}
