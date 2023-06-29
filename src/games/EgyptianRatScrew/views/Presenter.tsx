// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css"
import classNames from "classnames";
import { observable } from "mobx";
import EgyptianRatScrewAssets from "../assets/Assets";
import { EgyptianRatScrewVersion } from "../models/GameSettings";
import { BaseAnimationController, MediaHelper, UIProperties, PresenterGameEvent, PresenterGameState, GeneralGameState, DevUI, UINormalizer } from "libs";
import { EgyptianRatScrewPresenterModel, EgyptianRatScrewGameState, EgyptianRatScrewGameEvent, PlayingCard, PlayingCardRank, PlayingCardSuit } from "../models/PresenterModel";


@inject("appModel") @observer
class GatheringPlayersPage  extends React.Component<{appModel?: EgyptianRatScrewPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        // TODO: Add instructions:
        // 1. Players take turns playing cards to the center pile
        // 2. If a player plays a face card, the next player in line has some number of chances
        //    to play another face card (4 for Ace, 3 for King, 2 for Queen, and just 1 for Jack)
        //    If they fail, the player who played the face card may take the pile. Otherwise, it's
        //    on to the next player to play a face card.
        // 3. If at any time, the card on the top matches the card below it or the card below that,
        //    _anyone_ may take the pile! This can happen even if a pile would normally belong to
        //    someone else due to a face card, and includes anyone who is joining the game or has
        //    run out of cards!
        // 4. When only one player has cards left (and there are no other active challenges),
        //    that player is the winner!
        //
        // Use the "Play" button to play a card, and the "Take" button to try and take the pile.
        // If you do it at the wrong time, you must put a card from the top of your deck onto the
        // pile.
        // Note that you will not automatically take a pile you win to a face card - someone else
        // might be able to take it if the top cards match! Also note that the Play and Take buttons
        // will not light up in any way - keep careful watch of the top card!
        return (
            <div>
                <h3>Welcome to Egyptian Rat Screw!</h3>
                <p>To Join: go to { window.location.origin } and enter this room code: {appModel.roomId}</p>
                {
                    appModel.players.length > 0
                    ?   <div><p style={{fontWeight: 600}}>Joined team members:</p>
                            <div className={styles.divRow}>
                                {appModel.players.map(player => (<div className={styles.nameBox} key={player.playerId}>{player.name}</div>))}
                            </div>
                        </div>
                    : null 
                }
                
                {appModel.players.length < appModel.minPlayers
                    ? <div>{`Waiting for at least ${appModel.minPlayers} players to join ...`}</div>
                    : <button className={styles.presenterButton} onClick={() => appModel.startGame()}> Click here to start! </button>
                }               
            </div>
        );

    }
}

@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: EgyptianRatScrewPresenterModel}> {

    // -------------------------------------------------------------------
    // resumeGame
    // -------------------------------------------------------------------
    private resumeGame = () => {
        this.props.appModel?.resumeGame();
    }
 
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;
        return (
            <div>
                <p>EgyptianRatScrew is paused</p>
                <p>Current players in the room:</p>
                <ul>
                    {appModel.players.map(player => (<li key={player.playerId}>{player.name}</li>))}
                </ul>
                <button
                    className={styles.button}
                    disabled={appModel.players.length < appModel.minPlayers} 
                    onClick={() =>this.resumeGame()}>
                        Resume Game
                </button>
            </div>
        );
    }
}

@inject("appModel") @observer class PlayingPage 
    extends React.Component<{appModel?: EgyptianRatScrewPresenterModel, media: MediaHelper }> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: EgyptianRatScrewPresenterModel, media: MediaHelper }>) {
        super(props);
    }

    private renderCard(card: PlayingCard) {
        // TODO: This should be replaced with full-fledged card images,
        // preferably SVGs
        const RANK_MAPPING: Record<PlayingCardRank, string> = {
            [PlayingCardRank.Ace]: "A",
            [PlayingCardRank.Two]: "2",
            [PlayingCardRank.Three]: "3",
            [PlayingCardRank.Four]: "4",
            [PlayingCardRank.Five]: "5",
            [PlayingCardRank.Six]: "6",
            [PlayingCardRank.Seven]: "7",
            [PlayingCardRank.Eight]: "8",
            [PlayingCardRank.Nine]: "9",
            [PlayingCardRank.Ten]: "10",
            [PlayingCardRank.Jack]: "J",
            [PlayingCardRank.Queen]: "Q",
            [PlayingCardRank.King]: "K",
            [PlayingCardRank.Joker]: "JOKER"
        }
        const SUIT_SYMBOL_MAPPING: Record<PlayingCardSuit, string> = {
            [PlayingCardSuit.Clubs]: "♣",
            [PlayingCardSuit.Diamonds]: "♦",
            [PlayingCardSuit.Spades]: "♠",
            [PlayingCardSuit.Hearts]: "♥"
        }
        const SUIT_COLOR_MAPPING: Record<PlayingCardSuit, string> = {
            [PlayingCardSuit.Clubs]: "black",
            [PlayingCardSuit.Diamonds]: "red",
            [PlayingCardSuit.Spades]: "black",
            [PlayingCardSuit.Hearts]: "red"
        }
        // TODO: Render Jokers
        return <span style={ {color: SUIT_COLOR_MAPPING[card.suit]}}>{RANK_MAPPING[card.rank]} {SUIT_SYMBOL_MAPPING[card.suit]}</span>
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel}= this.props;
        if (!appModel) return <div>NO APP MODEL</div>;
        return (
            <div>
                <p>
                    {appModel.pile.length > 0 
                        ? this.renderCard(appModel.pile.at(-1)!) 
                        : "(empty)"} 
                    <sub>({appModel.pile.length})</sub>
                </p>
                {appModel.players.map(player => (
                    <p key={player.playerId}>
                        {player.name} ({player.cards.length}) 
                        {appModel.currentPlayerId === player.playerId ? "☚" : undefined}
                        {appModel.previousFaceCardPlayerId === player.playerId ? "★" : undefined}
                    </p>
                ))}
            </div>
        );
    }
}

@inject("appModel") @observer class EndOfRoundPage 
    extends React.Component<{appModel?: EgyptianRatScrewPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        return (
            <div>
                <div>End of round {appModel.currentRound}</div>
                {
                    appModel.currentRound >= appModel.totalRounds 
                    ? <div>
                            <div>The game is over...</div>
                            <button onClick={() => appModel.startGame()}>Play again, same players</button> 
                        </div>
                    : <button onClick={() => appModel.startNextRound()}>Start next round</button> 
                }
                              
            </div>
        );
    }
}

// -------------------------------------------------------------------
// Presenter Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Presenter 
extends React.Component<{appModel?: EgyptianRatScrewPresenterModel, uiProperties: UIProperties}> {
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: EgyptianRatScrewPresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;

        // Set up sound effects
        this.media = new MediaHelper();
        for(let soundName in EgyptianRatScrewAssets.sounds)
        {
            this.media.loadSound((EgyptianRatScrewAssets.sounds as any)[soundName]);
        }

        const sfxVolume = 1.0;       

        appModel?.subscribe(PresenterGameEvent.PlayerJoined,     "play joined sound", ()=> this.media.playSound(EgyptianRatScrewAssets.sounds.hello, {volume: sfxVolume * .2}));
        appModel?.subscribe(EgyptianRatScrewGameEvent.ResponseReceived,  "play response received sound", ()=> this.media.playSound(EgyptianRatScrewAssets.sounds.response, {volume: sfxVolume}));

    }

    // -------------------------------------------------------------------
    // renderSubScreen
    // -------------------------------------------------------------------
    private renderSubScreen() {
        const {appModel} = this.props;
        if(!appModel) {
            return <div>NO APP MODEL</div>
        }

        switch(appModel.gameState)
        {
            case PresenterGameState.Gathering:
                return <GatheringPlayersPage />
            case EgyptianRatScrewGameState.Playing:
                return <PlayingPage media={this.media} />
            case GeneralGameState.GameOver:
                return <EndOfRoundPage />
            case GeneralGameState.Paused:
                return <PausedGamePage />
            default:
                return <div>Whoops!  No display for this state: {appModel.gameState}</div>
        }
    }

    // -------------------------------------------------------------------
    // renderFrame
    // -------------------------------------------------------------------
    private renderFrame() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;
        return (
            <div className={classNames(styles.divRow)}>
                <button className={classNames(styles.button)} 
                    style={{marginRight: "30px"}}
                    onClick={()=>appModel.quitApp()}>
                        Quit
                </button>                       
                <button className={classNames(styles.button)} 
                    disabled={appModel.gameState === PresenterGameState.Gathering}
                    style={{marginRight: "30px"}}
                    onClick={()=>appModel.pauseGame()}>
                        Pause
                </button>
                <div className={classNames(styles.roomCode)}>Room Code: {appModel.roomId}</div>
                <DevUI context={appModel} children={<div></div>} />
                <div style={{marginLeft: "50px"}}>v{EgyptianRatScrewVersion}</div>
            </div>)
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        return (
            <UINormalizer
                className={styles.gamepresenter}
                uiProperties={this.props.uiProperties}
                virtualHeight={1080}
                virtualWidth={1920}>
                    {this.renderFrame()}
                    <div style={{margin: "40px"}}>
                        {this.renderSubScreen()}
                    </div>
            </UINormalizer>
        );
    };
}
