import { action, observable } from "mobx"
import { ERS_MIN_CARDS_PER_PLAYER, PLAYTIME_MS } from "./GameSettings";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, ClusterfunPresenterModel, ITelemetryLogger, IStorage, ITypeHelper, PresenterGameState, GeneralGameState, Vector2 } from "libs";
import Logger from "js-logger";
import { ERSActionResponse, ERSActionSuccessState, ERSTimepointUpdateMessage, EgyptianRatScrewOnboardClientEndpoint, EgyptianRatScrewPlayCardActionEndpoint, EgyptianRatScrewPushUpdateEndpoint, EgyptianRatScrewTakePileActionEndpoint } from "./egyptianRatScrewEndpoints";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";

export enum PlayingCardRank {
    Ace = 1,
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
    Ten = 10,
    Jack = 11,
    Queen = 12,
    King = 13,
    Joker = 100
}

export enum PlayingCardSuit {
    Clubs = 0,
    Diamonds = 1,
    Spades = 2,
    Hearts = 3
}

export class PlayingCard {
    readonly rank: PlayingCardRank;
    readonly suit: PlayingCardSuit;
    readonly deckId: string | number | symbol;

    constructor(rank: PlayingCardRank, suit: PlayingCardSuit, deckId: string | number | symbol) {
        this.rank = rank;
        this.suit = suit;
        this.deckId = deckId;
    }
}

const FACE_CARD_CHALLENGE_COUNTS: Record<any, number> = {
    [PlayingCardRank.Ace]: 4,
    [PlayingCardRank.King]: 3,
    [PlayingCardRank.Queen]: 2,
    [PlayingCardRank.Jack]: 1
}
const MAX_CHALLENGE_COUNT = 4;

export class EgyptianRatScrewPlayer extends ClusterFunPlayer {
    @observable cards: PlayingCard[] = observable([])
}

// -------------------------------------------------------------------
// The Game state  
// -------------------------------------------------------------------
export enum EgyptianRatScrewGameState {
    Playing = "Playing",
}

// -------------------------------------------------------------------
// Game events
// -------------------------------------------------------------------
export enum EgyptianRatScrewGameEvent {
    ResponseReceived = "ResponseReceived",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getEgyptianRatScrewPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "EgyptianRatScrewPresenterModel",
        getTypeName(o) {
            switch (o.constructor) {
                case EgyptianRatScrewPresenterModel: return "EgyptianRatScrewPresenterModel";
                case EgyptianRatScrewPlayer: return "EgyptianRatScrewPlayer";
                case PlayingCard: return "PlayingCard";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "EgyptianRatScrewPresenterModel": return new EgyptianRatScrewPresenterModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "EgyptianRatScrewPlayer": return new EgyptianRatScrewPlayer();
                case "PlayingCard": return new PlayingCard(PlayingCardRank.Ace, PlayingCardSuit.Spades, 0);
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof EgyptianRatScrewPresenterModel)
            {
                const doNotSerializeMe = 
                [
                    // do not save timepoints - refreshing the page counts as a timepoint change
                    "_timepointCode",
                    "_timepointScratch"
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "EgyptianRatScrewPresenterModel")
            {
                // TODO: if there are any properties that need special treatment on 
                // deserialization, you can override it here.  e.g.:
                // switch(propertyName) {
                //     case "myOservableCollection": 
                //         return observable<ItemType>(rehydratedObject as ItemType[]); 
                // }
            }
            return rehydratedObject;
        }
     }
}


// -------------------------------------------------------------------
// presenter data and logic
// -------------------------------------------------------------------
export class EgyptianRatScrewPresenterModel extends ClusterfunPresenterModel<EgyptianRatScrewPlayer> {

    // NOTE: The cards in each player's deck is in the Player struct

    @observable pile: PlayingCard[] = observable([]); // The pile of cards in the center
    @observable currentPlayerId: string = ""; // The player whose turn it is to play a card
    @observable previousFaceCardPlayerId: string | undefined = undefined; // The player who most recently played a face card
    private _timepointCode: string = ""; // A unique string representing the current moment in time
    private _timepointScratch: Uint32Array = new Uint32Array(2); // Scratch space for generating the timepoint

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("EgyptianRatScrew", sessionHelper, logger, storage);
        Logger.info(`Constructing EgyptianRatScrewPresenterModel ${this.gameState}`)

        this.allowedJoinStates = [PresenterGameState.Gathering, EgyptianRatScrewGameState.Playing]

        this.minPlayers = 2;
        this.maxPlayers = 20;
        this.totalRounds = 1;

        this.updateTimepointCode();
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpoint(EgyptianRatScrewOnboardClientEndpoint, this.handleOnboardClient);
        this.listenToEndpoint(EgyptianRatScrewPlayCardActionEndpoint, this.handlePlayCardAction);
        this.listenToEndpoint(EgyptianRatScrewTakePileActionEndpoint, this.handleTakePileAction);

        // TODO: Respond to a player leaving.
        // When a player leaves, all of their cards should go to the bottom of the pile.

        // TODO: Respond to a player failing to respond.
        // If a player takes too long (say, 10 seconds) to respond,
        // they should drop a penalty card
    }


    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): EgyptianRatScrewPlayer
    {
        const newPlayer = new EgyptianRatScrewPlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;

        return newPlayer;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    prepareFreshRound = () => {
    }

    // -------------------------------------------------------------------
    //  prepareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.gameState = PresenterGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        // Note - we are not checking "isStageOver" as we will only
        // be playing one round and will be using other methods to handle idling
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.gameState = EgyptianRatScrewGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.requestEveryone(GameOverEndpoint, (p,ie) => ({}))
            this.saveCheckpoint();
        }    
        else {
            this.gameState = EgyptianRatScrewGameState.Playing;
            this.populatePlayerDecks();
            this.currentPlayerId = this.players[0].playerId;
            this.requestEveryoneAndForget(InvalidateStateEndpoint, (p,ie) => ({}))
            this.saveCheckpoint();
        }
    }

    private populatePlayerDecks() {
        const cards: PlayingCard[] = [];
        this.players.forEach(player => {
            // remove all cards any players might have
            player.cards.splice(0, player.cards.length);
        })
        let deckId: number = 1;
        while (cards.length / this.players.length < ERS_MIN_CARDS_PER_PLAYER) {
            cards.push(...this.createDeck(deckId));
            deckId++;
        }
        let playerIndex = 0;
        while (cards.length > 0) {
            this.players[playerIndex].cards.push(cards.splice(Math.floor(Math.random() * cards.length), 1)[0])
            playerIndex++;
            if (playerIndex >= this.players.length) {
                playerIndex = 0;
            }
        }
        this.updateTimepointCode();
    }

    // -------------------------------------------------------------------
    //  create a new deck
    // -------------------------------------------------------------------
    private *createDeck(deckId: number): Iterable<PlayingCard> {
        const ranks = [PlayingCardRank.Ace, PlayingCardRank.Two, PlayingCardRank.Three, PlayingCardRank.Four, PlayingCardRank.Five, PlayingCardRank.Six, PlayingCardRank.Seven, 
                            PlayingCardRank.Eight, PlayingCardRank.Nine, PlayingCardRank.Ten, PlayingCardRank.Jack, PlayingCardRank.Queen, PlayingCardRank.King];
        const suits = [PlayingCardSuit.Clubs, PlayingCardSuit.Diamonds, PlayingCardSuit.Hearts, PlayingCardSuit.Spades];
        for (const rank of ranks) {
            for (const suit of suits) {
                yield new PlayingCard(rank, suit, deckId);
            }
        }
        // TODO: Add Jokers - we can just return two cards here:
        // yield new PlayingCard(PlayingCardRank.Joker, PlayingCardSuit.Spades, deckId);
        // yield new PlayingCard(PlayingCardRank.Joker, PlayingCardSuit.Hearts, deckId);
    }

    // -------------------------------------------------------------------
    //  update the current timepoint code. Change this whenever
    //  the game state meaningfully changes
    // -------------------------------------------------------------------
    private updateTimepointCode() {
        crypto.getRandomValues(this._timepointScratch);
        const newTimepointCode = this._timepointScratch[0].toString(16).padStart(8, "0") + this._timepointScratch[1].toString(16).padStart(8, "0");
        this._timepointCode = newTimepointCode;
    }

    private pushClientUpdates() {
        this.requestEveryoneAndForget(EgyptianRatScrewPushUpdateEndpoint, (p, ie) => {
            if (ie) return undefined;
            return {
                numberOfCards: p.cards.length,
                timepointCode: this._timepointCode
            }
        });
    }

    // Issue the correct penalty for a failed action
    private resolveFailedAction(playerId: string): ERSActionResponse {
        const player = this.players.find(p => p.playerId === playerId);
        if (!player || player.cards.length <= 0) {
            return { successState: ERSActionSuccessState.Ignored }
        }
        action(() => {
            this.pile.unshift(player.cards.pop()!);
            if (player.cards.length === 0 && playerId === this.currentPlayerId) {
                this.advanceToNextPlayer();
            }
            this.updateTimepointCode();
            this.pushClientUpdates();
        })();
        return {
            successState: ERSActionSuccessState.PenaltyCard,
            timepoint: {
                numberOfCards: player.cards.length,
                timepointCode: this._timepointCode
            }
        }
    }

    // Returns whether or not the pile can be taken by any player
    private isPileTakeable(): boolean {
        if (this.pile.length >= 2 && this.pile.at(-1)!.rank === this.pile.at(-2)!.rank) {
            return true;
        }
        if (this.pile.length >= 3 && this.pile.at(-1)!.rank === this.pile.at(-3)!.rank) {
            return true;
        }
        return false;
    }

    // Returns whether or not the pile has been won by the player who previously took a face card.
    // In this state, no one is allowed to play cards.
    private isPileWon(): boolean {
        let i = this.pile.length - 1;
        while (i >= this.pile.length - 1 - MAX_CHALLENGE_COUNT && i >= 0) {
            const card = this.pile[i];
            if (card.rank in FACE_CARD_CHALLENGE_COUNTS) {
                const cardsAboveThisCard = (this.pile.length - 1) - i;
                return cardsAboveThisCard >= FACE_CARD_CHALLENGE_COUNTS[card.rank];
            }
            i--;
        }
        return false;
    }

    // Returns whether or not there is an active face card on the pile,
    // whether or not it has won the pile
    private isPileUnderFaceCardControl(): boolean {
        let i = this.pile.length - 1;
        while (i >= this.pile.length - 1 - MAX_CHALLENGE_COUNT && i >= 0) {
            const card = this.pile[i];
            if (card.rank in FACE_CARD_CHALLENGE_COUNTS) {
                return true;
            }
            i--;
        }
        return false;
    }

    // Try advancing to the next player, skipping any players with no cards.
    // If there are no other players with cards, mark the game as won.
    private advanceToNextPlayer() {
        const currentPlayerIndex = this.players.findIndex(p => p.playerId === this.currentPlayerId);
        let i = currentPlayerIndex;
        while (true) {
            i++;
            if (i >= this.players.length) {
                i = 0;
            }
            if (i === currentPlayerIndex) {
                // no other players with cards - the current player just won
                this.gameState = GeneralGameState.GameOver;
                this.requestEveryoneAndForget(InvalidateStateEndpoint, (p, ie) => true)
                break;
            }
            if (this.players[i].cards.length > 0) {
                action(() => this.currentPlayerId = this.players[i].playerId)();
                break;
            }
        }
    }

    handleOnboardClient = (sender: string, message: unknown): { state: string, timepoint?: ERSTimepointUpdateMessage } => {
        this.telemetryLogger.logEvent("Presenter", "Onboard Client")
        const player = this.players.find(p => p.playerId === sender);
        if (!player) {
            throw new Error("Unknown sender");
        }
        return {
            state: this.gameState,
            timepoint: {
                numberOfCards: player.cards.length,
                timepointCode: this._timepointCode
            }
        }
    }

    handlePlayCardAction = (sender: string, message: { timepointCode: string }): ERSActionResponse => {
        const player = this.players.find(p => p.playerId === sender);
        if (!player) {
            throw new Error("Unknown sender");
        }

        // Make sure the timepoint code matches - if it doesn't, ignore the action
        if (this._timepointCode !== message.timepointCode) {
            return { successState: ERSActionSuccessState.Ignored };
        }

        if (this.currentPlayerId !== sender) {
            return this.resolveFailedAction(sender);
        }
        if (this.isPileWon()) {
            return this.resolveFailedAction(sender);
        }
        
        action(() => {
            const card = player.cards.pop();
            if (!card) {
                throw new Error("Current player should not be the current player if they are out of cards")
            }
            this.pile.push(card);
            if (card.rank in FACE_CARD_CHALLENGE_COUNTS) {
                this.previousFaceCardPlayerId = sender;
                this.advanceToNextPlayer();
            } else if (!this.isPileUnderFaceCardControl() || player.cards.length === 0) {
                this.advanceToNextPlayer();
            }
            this.saveCheckpoint();
            this.updateTimepointCode();
            this.pushClientUpdates();
        })()
        
        return {
            successState: ERSActionSuccessState.Success,
            timepoint: {
                numberOfCards: player.cards.length,
                timepointCode: this._timepointCode
            }
        }
    }

    handleTakePileAction = (sender: string, message: { timepointCode: string }): ERSActionResponse => {
        const player = this.players.find(p => p.playerId === sender);
        if (!player) {
            throw new Error("Unknown sender");
        }

        // Make sure the timepoint code matches - if it doesn't, ignore the action
        if (this._timepointCode !== message.timepointCode) {
            // TODO: Record that a slap happened so that it can still be pictured
            return { successState: ERSActionSuccessState.Ignored };
        }

        if (this.isPileTakeable() || (this.previousFaceCardPlayerId === sender && this.isPileWon())) {
            action(() => {
                // Take the entire pile and put it on the bottom of the deck in order
                player.cards.unshift(...this.pile.splice(0, this.pile.length));
                this.previousFaceCardPlayerId = undefined;
                this.currentPlayerId = sender;
                // TODO: There should be some delay (perhaps one or two seconds) before
                // cards should be played again. This allows slaps to happen immediately
                // after this one without any penalty being issued
                this.saveCheckpoint();
                this.updateTimepointCode();
                this.pushClientUpdates();
            })();

            return {
                successState: ERSActionSuccessState.Success,
                timepoint: {
                    numberOfCards: player.cards.length,
                    timepointCode: this._timepointCode
                }
            }
        } else {
            return this.resolveFailedAction(sender);
        }
    }
}
