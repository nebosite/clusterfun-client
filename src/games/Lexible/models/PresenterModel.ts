import { action, makeObservable, observable } from "mobx"
import { 
    LexiblePlayRequestMessage,
    LexiblePlayerActionMessage,
    LexibleEndOfRoundMessage,
    PlayBoard,
    LexiblePlayerAction,
    LetterSelectData,
    WordSubmissionData,
    LexibleFailedWordMessage,
    LexibleScoredWordMessage,
    LexibleWordHintMessage,
    LetterChain,
    LexibleRecentlyTouchedLettersMessage, } from "./Messages";
import { PLAYTIME_MS } from "./GameSettings";
import { LetterBlockModel } from "./LetterBlockModel";
import { WordTree } from "./WordTree";
import { LetterGridModel } from "./LetterGridModel";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, Vector2, ClusterfunPresenterModel, ITelemetryLogger, IStorage, GeneralGameState, PresenterGameEvent, PresenterGameState, ClusterFunGameOverMessage, ITypeHelper } from "libs";
import Logger from "js-logger";

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
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum LexibleGameState {
    Playing = "Playing",
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

    @observable private _winningTeam = "";
    get winningTeam() { return this._winningTeam}
    set winningTeam(value) { action(()=>{this._winningTeam = value})()}

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

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Lexible", sessionHelper, logger, storage);

        this.allowedJoinStates.push(LexibleGameState.Playing, GeneralGameState.Paused)
        this.subscribe(PresenterGameEvent.PlayerJoined, this.name, this.handlePlayerJoin)

        sessionHelper.addListener(LexiblePlayerActionMessage, `${this.name}_action`, this.handlePlayerAction);

        sessionHelper.onError(err => {
            Logger.error(`Session error: ${err}`)
            this.quitApp();
        })
        
        this.minPlayers = 2;

        this.wordTree = WordTree.create([]);
        this.populateWordSet();

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
        this.theGrid.processBlocks((block)=>{this.setBlockHandlers(block)})
    }

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
                lastAwaitTime = window.performance.now();
            }
            this.wordTree.add(word.trim());
            this.wordSet.add(word.trim());
        }
        Logger.info(`Loaded ${this.wordSet.size} words`)

        const { badWords } = await badWordsPromise;
        for (const badWord of badWords) {
            if (window.performance.now() - lastAwaitTime > 5) {
                await this.waitForRealTime(0);
                lastAwaitTime = window.performance.now();
            }
            this.badWords.add(badWord.trim());
        }
        Logger.info(`Loaded ${this.badWords.size} censored words`)
    }

    private waitForRealTime(ms: number) {
        return new Promise((resolve, _reject) => {
            setTimeout(resolve, ms);
        })
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
        if(this.gameState !== PresenterGameState.Gathering) {
            this.sendToPlayer(player.playerId, this.createPlayRequestMessage(player.teamName))
        }
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
    //  prepareFreshGame - called automatically before every round
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
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
    //  resetGame
    // -------------------------------------------------------------------
    resetGame() {
        this.players.clear();
        this.gameState = PresenterGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.recentlyTouchedLetters.size <= 0) return;
        if (this.gameTime_ms - this.gameTimeLastSentTouchedLetters_ms > SEND_RECENT_LETTERS_INTERVAL_MS) {
            this.gameTimeLastSentTouchedLetters_ms = this.gameTime_ms;
            const letterCoordinates = Array.from(this.recentlyTouchedLetters.values());
            this.recentlyTouchedLetters.clear();
            const message = new LexibleRecentlyTouchedLettersMessage({ sender: this.session.personalId, letterCoordinates });
            this.sendToEveryone(() => message);
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
            teamName
        }
        return new LexiblePlayRequestMessage(payload)
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.prepareFreshGame();
        this.gameState = LexibleGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            p.status = LexiblePlayerStatus.WaitingForStart;
            p.pendingMessage = undefined;
            p.message = "";
            p.colorStyle = "white";
            p.x = .1;
            p.y = i * .1 + .1;
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.sendToEveryone((p,ie) => new ClusterFunGameOverMessage({ sender: this.session.personalId }))
            this.saveCheckpoint();
        }    
        else {
            this.sendToEveryone((p,ie) =>  this.createPlayRequestMessage(p.teamName))
            this.saveCheckpoint();
        }
        this.saveCheckpoint();
    }

    // -------------------------------------------------------------------
    //  handlePlayerAction 
    // -------------------------------------------------------------------
    handlePlayerLetterSelect = (playerId: string, data: LetterSelectData) => {
        if(!data) throw Error("handlePlayerLetterSelect: No data")
        if(!data?.coordinates) throw Error(`No coordinates passed to handlePlayerLetterSelect ${data.coordinates}`)
        
        const selectedBlock = this.theGrid.getBlock(data.coordinates);
        if (!selectedBlock) {
            Logger.warn("WEIRD: No block at:", data.coordinates);
            return;
        }
        if(data.isFirst) {
            Logger.debug(`First selection for ${playerId} is ${selectedBlock.letter}`)
            const wordList = this.findWords(selectedBlock);
            this.sendToPlayer(playerId, new LexibleWordHintMessage({ sender: this.session.personalId, wordList }))
        }
        selectedBlock.selectForPlayer(data.playerId, data.selectedValue);
        this.recentlyTouchedLetters.set(selectedBlock.coordinates.x * 1000 + selectedBlock.coordinates.y, selectedBlock.coordinates)
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
    checkForWin(team: string) {
        // Step 1: figure out the edges
        let startx = 0;
        let winx = this.theGrid.width-1;
        if(team === "B") {
             startx = this.theGrid.width-1;
             winx = 0;
        }

        // figure out the places on the edge to start with
        const workRemaining = new Array<LetterBlockModel>();
        for(let y = 0; y < this.theGrid.height; y++) {
             const block = this.theGrid.getBlock(new Vector2(startx, y))!
             if(block.team === team) { workRemaining.push(block) }
        }

        const visited = new Set<number>();

        // Now recurse through the blocks and check for win
        while(workRemaining.length > 0) {
            const currentBlock = workRemaining.pop()!;
            const {x,y} = currentBlock.coordinates;
            if(currentBlock.team !== team || visited.has(currentBlock.__blockid))  continue;

            visited.add(currentBlock.__blockid)
            if(x === winx) {
                this.handleGameWin(team);
                return;
            }
            
            if(x > 0) workRemaining.push(this.theGrid.getBlock(new Vector2(x-1,y))!)
            if(x < this.theGrid.width - 1) workRemaining.push(this.theGrid.getBlock(new Vector2(x+1,y))!)
            if(y > 0) workRemaining.push(this.theGrid.getBlock(new Vector2(x, y-1))!)
            if(y < this.theGrid.height - 1) workRemaining.push(this.theGrid.getBlock(new Vector2(x, y+1))!)
        }
    }

    // -------------------------------------------------------------------
    //  handleGameWin 
    // -------------------------------------------------------------------
    handleGameWin(team: string) {
        this.winningTeam = team;
        this.gameState = LexibleGameState.EndOfRound
        this.invokeEvent(LexibleGameEvent.TeamWon, team)
        this.sendToEveryone((p,ie) => new LexibleEndOfRoundMessage({ sender: this.session.personalId, roundNumber: this.currentRound, winningTeam: team}));
    }
    
    // -------------------------------------------------------------------
    //  placeSuccessfulWord 
    // -------------------------------------------------------------------
    placeSuccessfulWord(data: WordSubmissionData, word: string, player: LexiblePlayer) {
        const placedLetters: LetterChain = []
        data.letters.forEach(l => {
            const block = this.theGrid.getBlock(l.coordinates)
            if(block && word.length > block.score) {
                block.setScore( Math.max(word.length, block.score), player.teamName);  
                placedLetters.push(l);
            }
        })
        this.sendToEveryone((p, isExited) => {
            return new LexibleScoredWordMessage({
                sender: this.session.personalId,
                scoringPlayerId: player.playerId,
                team: player.teamName,
                letters: placedLetters,
                score: word.length
            }) 
        })
        this.invokeEvent(LexibleGameEvent.WordAccepted, word.toLowerCase(), player)
        this.checkForWin(player.teamName);
    }

    // -------------------------------------------------------------------
    //  handlePlayerWordSubmit 
    // -------------------------------------------------------------------
    handlePlayerWordSubmit = (playerId: string, data: WordSubmissionData) => {
        if(!data) throw Error("handlePlayerWordSubmit: No data")
        const player = this.players.find(p => p.playerId === playerId);
        if (!player) throw Error("Unknown player attempted to submit a word");

        let scoreTooLow = false;
        const word = data.letters.map((l,index) => {
            if(!l.coordinates) throw Error(`No coordinate on submitted letter: ${JSON.stringify(data)}`)
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
            this.placeSuccessfulWord(data, word, player);
        }
        else {
            const rejectMessage = new LexibleFailedWordMessage({
                sender: this.session.personalId,
                letters: data.letters
            })
            this.sendToPlayer(playerId, rejectMessage)
        }
    }


    // -------------------------------------------------------------------
    //  handlePlayerAction
    // -------------------------------------------------------------------
    handlePlayerAction = (message: LexiblePlayerActionMessage) => {
        const player = this.players.find(p => p.playerId === message.sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Presenter", "AnswerMessage", "Deny");
            return;
        }

        switch(message.action)
        {
            case LexiblePlayerAction.LetterSelect: 
                this.handlePlayerLetterSelect(message.sender, message.actionData as LetterSelectData) 
                break;
            case LexiblePlayerAction.WordSubmit:
                this.handlePlayerWordSubmit(message.sender, message.actionData as WordSubmissionData)
                break;
        }

        this.saveCheckpoint();
    }

}
