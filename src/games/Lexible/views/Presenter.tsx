// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from './Presenter.module.css';
import classNames from "classnames";
import LexibleAssets from "../assets/Assets";
import { LexibleVersion } from "../models/GameSettings";
import { LetterBlockModel } from "../models/LetterBlockModel";
import LetterBlock from "./LetterBlock";
import { LexiblePresenterModel, MapSize, LexibleGameEvent, LexiblePlayer, LexibleGameState } from "../models/PresenterModel";
import { Row, MediaHelper, SpeechHelper, UIProperties, PresenterGameEvent, PresenterGameState, GeneralGameState, UINormalizer, DevUI } from "libs";

@inject("appModel") @observer
class GameSettings  extends React.Component<{appModel?: LexiblePresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const handleStartFromTeamAreaChange = () => {
            appModel.startFromTeamArea = !appModel.startFromTeamArea
        }
        return (
            <div className={styles.settingsArea} >
                <div><b>Settings</b></div>
                <Row>
                    <input
                        className={styles.settingsCheckbox}
                        type="checkbox"
                        checked={appModel.startFromTeamArea}
                        onChange={handleStartFromTeamAreaChange}
                    />
                    <div>Words must start from team territory:</div>
                </Row>
                <Row>
                    <div>Map Size:</div>
                    <input
                        className={styles.settingsCheckbox}
                        type="checkbox"
                        checked={appModel.mapSize === MapSize.Small}
                        onChange={()=>appModel.mapSize = MapSize.Small}
                    />
                    <div>small</div>
                    <input
                        className={styles.settingsCheckbox}
                        type="checkbox"
                        checked={appModel.mapSize === MapSize.Medium}
                        onChange={()=>appModel.mapSize = MapSize.Medium}
                    />
                    <div>medium</div>
                    <input
                        className={styles.settingsCheckbox}
                        type="checkbox"
                        checked={appModel.mapSize === MapSize.Large}
                        onChange={()=>appModel.mapSize = MapSize.Large}
                    />
                    <div>large</div>
                </Row>

            </div>
        );

    }
}

@inject("appModel") @observer
class GatheringPlayersPage  extends React.Component<{appModel?: LexiblePresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        return (
            <div className={styles.instructionArea} >
                <h3>Welcome to {appModel.name}</h3>
                <p>To Join: go to http://{ window.location.host} and enter this room code: {appModel.roomId}</p>
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
                <GameSettings/>     
            </div>
        );

    }
}

@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: LexiblePresenterModel}> {

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
        if (!appModel) return <div>NO APP MODEL</div>
        return (
            <div>
                <p>Lexible is paused</p>
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

const teamATaunts = [
    "Team a haz won.  That is how it is.  You must get you zed to this.",
    "The feeling of victory is delicious, no?",
    "To grasp a language, it is a thing of beauty.  Az iz are Triumph over team, bee!",
]

const teamBTaunts = [
    "As expected, team B has proved victorious over team A.",
    "The best team has employed their superior spelling to squash the competition.",
    "In competition, there must be a winner, and we surmise it might as well be us.",
]

@inject("appModel") @observer class PlayingPage 
    extends React.Component<{appModel?: LexiblePresenterModel, media: MediaHelper }> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: LexiblePresenterModel, media: MediaHelper }>) {
        super(props);

        const speech = new SpeechHelper();
        //const languageFromTeam = (team: string) => team === "A" ? "Google français" : "Google UK English Male"
        const languageFromTeam = (team: string) => team === "A" ? "Microsoft Zira - English (United States)" : "Google UK English Male"
        props.appModel!.subscribe(LexibleGameEvent.WordAccepted, "say accepted word", (word: string, player: LexiblePlayer) => {
            //props.media.playSound(LexibleAssets.sounds.ding)
            speech.speak(word, languageFromTeam(player.teamName));
        })
        props.appModel!.subscribe(LexibleGameEvent.TeamWon,  "Taunt from the winners", (team: string)=> {
            const taunts = team === "A" ? teamATaunts : teamBTaunts;
           
            speech.speak(props.appModel?.randomItem(taunts) ?? "", languageFromTeam(team));
        });

    }

    // -------------------------------------------------------------------
    // renderRow
    // -------------------------------------------------------------------
    renderGridRow(row: LetterBlockModel[])
    {
        const handleClick = () => {} // No need to handle block clicks from the presenter

        return <Row className={styles.letterRow}>
            { row.map(b => <LetterBlock  size={1350/this.props.appModel!.theGrid.width} key={b.__blockid} onClick={handleClick} context={b} />)} 
        </Row>
    }

    // ------------------------------------------------------------------- 
    // renderEndOfRoundOverlay
    // -------------------------------------------------------------------
    renderEndOfRoundOverlay() {
        const {appModel}= this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const startNextRoundClick = () => appModel.startNextRound();

        return <div className={styles.overlay} style={{fontSize: "200%"}}>
            <div className={styles.endOfRoundText}>TEAM {appModel.winningTeam} is the winner!</div>
            <button 
                style={{margin: "20px", fontSize:"80%"}}
                onClick={startNextRoundClick}
            >{appModel.currentRound < appModel.totalRounds
                ? "Play Next Round"
                : "Finish Game"}</button>
        </div>
    }

    // ------------------------------------------------------------------- 
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel}= this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        return (
            <div>              
                {
                    appModel.theGrid.rows.map((r,i) => <div key={i}>{this.renderGridRow(r)}</div>)
                }   
                {
                    appModel.gameState === LexibleGameState.EndOfRound
                    ? this.renderEndOfRoundOverlay()
                    : null
                }
            </div> 
        );
    }
}

@inject("appModel") @observer class EndOfRoundPage 
    extends React.Component<{appModel?: LexiblePresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        return (
            <div>
                {
                    appModel.currentRound >= appModel.totalRounds 
                    ?   <div>
                            <div>The game is over...</div>
                            <button onClick={() => appModel.playAgain(false)}>Play again, same players</button> 
                        </div>
                    :   <div>
                            <div>End of round {appModel.currentRound}</div>
                            <button onClick={() => appModel.startNextRound()}>Start next round</button> 
                        </div>
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
extends React.Component<{appModel?: LexiblePresenterModel, uiProperties: UIProperties}> {
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: LexiblePresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;
        if (!appModel) throw new Error("No appModel provided")

        // Set up sound effects
        this.media = new MediaHelper();
        for(let soundName in LexibleAssets.sounds)
        {
            this.media.loadSound((LexibleAssets.sounds as any)[soundName]);
        }

        const sfxVolume = 1.0;       

        let timeAlertLoaded = false;
        appModel.onTick.subscribe("Timer Watcher", ()=>{
            if(appModel.secondsLeftInStage > 10) timeAlertLoaded = true; 
            if( (appModel.gameState === LexibleGameState.Playing)
                && timeAlertLoaded 
                && appModel.secondsLeftInStage <= 10) {
                timeAlertLoaded = false 
                this.media.repeatSound("ding.wav", 5, 100);
            }
        })
        appModel.subscribe(PresenterGameEvent.PlayerJoined,     "play joined sound", ()=> this.media.playSound(LexibleAssets.sounds.hello, {volume: sfxVolume * .2}));
        appModel.subscribe(LexibleGameEvent.ResponseReceived,  "play response received sound", ()=> this.media.playSound(LexibleAssets.sounds.response, {volume: sfxVolume}));
    }

    // -------------------------------------------------------------------
    // renderPlayArea
    // -------------------------------------------------------------------
    private renderPlayArea() {
        const {appModel} = this.props;
        if(!appModel) {
            console.log("NO GAME DATA.  Quitting...")
            return;
        }

        switch(appModel.gameState)
        {
            case PresenterGameState.Gathering:
                return <GatheringPlayersPage />
            case LexibleGameState.EndOfRound:
            case LexibleGameState.Playing:
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
        if (!appModel) return <div>NO APP MODEL</div>
        return (
            <div className={classNames(styles.divRow)}>
                <button className={classNames(styles.quitButton)} 
                    style={{marginRight: "30px", fontSize:"10px"}}
                    onClick={()=> appModel.quitApp()}>X</button>
                <div className={classNames(styles.roomCode)}>
                    <div>Room Code:</div>
                    <div style={{fontSize: "180%", fontWeight: 800}}>{appModel.roomId}</div>
                </div>
                <div className={classNames(styles.currentRound)}>
                    <div>Round:</div>
                    <div style={{fontSize: "180%", fontWeight: 800}}>{appModel.currentRound}/{appModel.totalRounds}</div>
                </div>
                <div className={classNames(styles.version)}>v{LexibleVersion}</div>
            </div>)
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const renderTeam = (teamName: string) => {
            return <div>
                <div className={styles.teamTitle}>TEAM {teamName}</div>
                {
                    this.props.appModel!.players.filter(p => p.teamName === teamName).map(p => (
                        <div className={styles.teamPlayerName} key={p.playerId}>{p.name}</div>
                    ))
                }
            </div>
        }

        return (
            <UINormalizer
                className={styles.gamepresenter}
                uiProperties={this.props.uiProperties}
                virtualHeight={1080}
                virtualWidth={1920}>
                    {this.renderFrame()}
                    <DevUI style={{position: "absolute", left: "30%", bottom: "0px", fontSize: "50%"}} context={appModel} >
                        <button onClick={()=>appModel.handleGameWin("A")}>Win: A</button>
                        <button onClick={()=>appModel.handleGameWin("B")}>Win: B</button>
                    </DevUI>

                    <div style={{margin: "15px"}}>
                        <Row className={styles.presenterRow}>
                            <div 
                                className={styles.teamColumn}
                                style={{background: "yellow"}}
                            >{renderTeam("A")}</div>
                            <div className={styles.playColumn}>{this.renderPlayArea()}</div>
                            <div 
                                className={styles.teamColumn}
                                style={{background: "purple"}}
                            >{renderTeam("B")}</div>
                        </Row>
                    </div>
            </UINormalizer>
        );
    };
}
