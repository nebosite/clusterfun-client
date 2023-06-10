// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from './Presenter.module.css';
import classNames from "classnames";
import LexibleAssets from "../assets/Assets";
import { LexibleVersion } from "../models/GameSettings";
import { LetterBlockModel } from "../models/LetterBlockModel";
import LetterBlock from "./LetterBlock";
import { LexibleHostModel, MapSize, LexibleGameEvent, LexiblePlayer, LexibleGameState } from "../models/HostModel";
import { Row, MediaHelper, UIProperties, HostGameEvent, HostGameState, GeneralGameState, UINormalizer, DevUI } from "libs";
import { action, makeAutoObservable } from "mobx";
import SamJs from "sam-js";

@inject("appModel") @observer
class GameSettings  extends React.Component<{appModel?: LexibleHostModel}> {
    myState = {
        showSettings: false
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    constructor(props: {appModel?: LexibleHostModel}) {
        super(props);

        makeAutoObservable(this.myState);
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    renderSettingsItems() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const handleStartFromTeamAreaChange = () => {
            appModel.startFromTeamArea = !appModel.startFromTeamArea
        }
        
        return (
            <div className={styles.settingsArea} >
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

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const toggleShow = () => action(()=>this.myState.showSettings = !this.myState.showSettings)()

        return (
            <div>
                <div onClick={toggleShow} className={styles.settingsButton}>Settings</div>
                { this.myState.showSettings
                    ? this.renderSettingsItems()
                    : null
                }
            </div>   
        );
    }
}

@inject("appModel") 
@observer
class GatheringPlayersPage  extends React.Component<{appModel?: LexibleHostModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        return (
            <div className={styles.instructionArea} >
                <h1>Welcome to {appModel.name}</h1>
                <div className={styles.joinBlock}>
                    <p><b>To Join:</b> go to {window.location.origin}
                    &nbsp;&nbsp;&nbsp;(room code: <b>{appModel.roomId}</b>)</p>
                </div>
                
                {appModel.players.length < appModel.minPlayers
                    ? <div className={styles.waitingText}>{`Waiting for at least ${appModel.minPlayers} players to join ...`}</div>
                    : <button className={styles.startButton} onClick={() => appModel.doneGathering()}> 
                        Click here to start! 
                    </button>
                }          
                <div className={styles.settingsBox}>
                    <GameSettings/> 
                </div>
            </div>
        );

    }
}


@inject("appModel") @observer class InstructionsPage 
    extends React.Component<{appModel?: LexibleHostModel}> {

    myState = {
        instructionsPage: 0
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    constructor(props: {appModel?: LexibleHostModel}) {
        super(props);

        makeAutoObservable(this.myState);
    }    

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        const {instructionsPage} = this.myState;
        if (!appModel) return <div>NO APP MODEL</div>

        const renderInstructionsPage = () => {
            switch(instructionsPage) {
                case 0: return (<div>
                        <p className={styles.instructionParagraph}>
                            1. Claim tiles by spelling a word with adjacent letters.
                            Tiles you claim will get a point value equal to the length of the word.
                        </p>
                        <img src={LexibleAssets.images.instructions1} alt="instructions" style={{width: "280px", height: "280px"}} />
                    </div>);
                case 1: return (<div>
                        <p className={styles.instructionParagraph}>
                            2. You can claim the other team's tiles, but make sure your word is long enough! 
                            If the word is not longer than a tile's score, it will not be claimed.
                        </p>
                        <img src={LexibleAssets.images.instructions2}  alt="instructions" style={{width: "480px", height: "280px", marginLeft: "30px"}} />
                    </div>);
                case 2: return (<div>
                        <p className={styles.instructionParagraph}>
                        3. TO WIN: Build a bridge of tiles that connect your team's side to the other side of the grid. </p>
                        <img src={LexibleAssets.images.instructions3} alt="instructions" style={{width: "800px", marginLeft: "100px"}} />
                    </div>);
                default: return (<div>Let's play!</div>)
            }

        }

        const turnPage = (count: number) => {
            const newPage = instructionsPage + count;
            if(newPage >= 0 && newPage <= 3) {
                action(()=>this.myState.instructionsPage = newPage)();
            }
        }

        const buttonStyle: React.CSSProperties = {
            width: "200px"
        }
        return (
            <div className={styles.instructionFrame}>
                <p><b>How to play</b></p>
                <div>
                    { renderInstructionsPage() }
                </div>
                <Row style={{position: "absolute", bottom: "150px"}}>
                {
                    instructionsPage > 0 
                        ? <button style={buttonStyle} onClick={() => turnPage(-1)}>◀</button>
                        : <div style={buttonStyle}></div>
                }                
                <button style={{margin: "40px"}} onClick={() => appModel.startGame()}>Ready!</button>
                {
                    instructionsPage < 3
                        ? <button style={buttonStyle} onClick={() => turnPage(1)}>▶</button>
                        : <div style={buttonStyle}></div>
                }
                </Row>

            </div>
        );
    }
} 



@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: LexibleHostModel}> {

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
    "Team A has won.  That is how it is.  You must get used to this.",
    "The feeling of victory is delicious, no?",
    "To grasp a language, it is a thing of beauty.  As is our triumph over team B!",
]

const teamBTaunts = [
    "As expected, team B has proved victorious over team A.",
    "The best team has employed their superior spelling to squash the competition.",
    "In competition, there must be a winner, and we surmise it might as well be us.",
]

@inject("appModel") @observer class PlayingPage 
    extends React.Component<{appModel?: LexibleHostModel, media: MediaHelper }> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: LexibleHostModel, media: MediaHelper }>) {
        super(props);

        const teamAVoice = new SamJs({ speed: 72, pitch: 64, throat: 128, mouth: 128 }); // default SAM/V1
        const teamBVoice = new SamJs({ speed: 72, pitch: 48, throat: 128, mouth: 128 }); // higher pitched SAM
        const voiceFromTeam = (team: string) => team === "A" ? teamAVoice : teamBVoice;
        props.appModel!.subscribe(LexibleGameEvent.WordAccepted, "say accepted word", (word: string, player: LexiblePlayer) => {
            voiceFromTeam(player.teamName).speak(word);
        })
        props.appModel!.subscribe(LexibleGameEvent.TeamWon,  "Taunt from the winners", (team: string)=> {
            const taunts = team === "A" ? teamATaunts : teamBTaunts;
            voiceFromTeam(team).speak(props.appModel?.randomItem(taunts) ?? taunts[0]);
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
            <div className={styles.endOfRoundText}>TEAM {appModel.roundWinningTeam} is the winner!</div>
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
    extends React.Component<{appModel?: LexibleHostModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        return (
            <div>
                <div>The game is over...</div>
                <div>Overall winner is: { appModel.gameWinningTeam 
                    ? `Team ${appModel.gameWinningTeam}`
                    : "It's a TIE!"
                }</div>
                <div>Longest word: {appModel.longestWord.value} ({appModel.longestWord.playerName}) </div>
                <div>Most Captures: {appModel.mostCaptures.value} ({appModel.mostCaptures.playerName}) </div>
                <button onClick={() => appModel.playAgain(false)}>Play again, same players</button> 
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
extends React.Component<{appModel?: LexibleHostModel, uiProperties: UIProperties}> {
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: LexibleHostModel; uiProperties: UIProperties; }>) {
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
            if( (appModel.gameState === GeneralGameState.Playing)
                && timeAlertLoaded 
                && appModel.secondsLeftInStage <= 10) {
                timeAlertLoaded = false 
                this.media.repeatSound("ding.wav", 5, 100);
            }
        })
        appModel.subscribe(HostGameEvent.PlayerJoined,     "play joined sound", ()=> this.media.playSound(LexibleAssets.sounds.hello, {volume: sfxVolume * .2}));
        appModel.subscribe(LexibleGameEvent.ResponseReceived,  "play response received sound", ()=> this.media.playSound(LexibleAssets.sounds.response, {volume: sfxVolume}));
    }

    // ------------------------------------------------------------------- 
    // renderPlayArea
    // -------------------------------------------------------------------
    private renderPlayArea() {
        const {appModel} = this.props;
        if(!appModel) {
            return <div>NO APP MODEL</div>
        }

        switch(appModel.gameState)
        {
            case HostGameState.Gathering:
                return <GatheringPlayersPage />
            case GeneralGameState.Instructions:
                return <InstructionsPage />
            case LexibleGameState.EndOfRound:
            case GeneralGameState.Playing:
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

        const stats = appModel.session.stats;
        const sendRate = stats.sentCount / appModel.gameTimeMinutes;
        const recieveRate = stats.recievedCount / appModel.gameTimeMinutes;
        const sendSize = stats.bytesSent / stats.sentCount / 1000;
        const receiveSize = stats.bytesRecieved / stats.sentCount / 1000;

        const debugClick = () => {
            appModel.showDebugInfo = !appModel.showDebugInfo;
        }

        return (
            <UINormalizer
                className={styles.gamepresenter}
                uiProperties={this.props.uiProperties}
                virtualHeight={1080}
                virtualWidth={1920}>
                    {this.renderFrame()}
                    <DevUI style={{position: "absolute", left: "50%", bottom: "0px", fontSize: "50%"}} context={appModel} >
                        <button onClick={()=>appModel.handleGameWin("A")}>Win: A</button>
                        <button onClick={()=>appModel.handleGameWin("B")}>Win: B</button>
                    </DevUI>
                    <button className={styles.debugButton} onClick={debugClick}/>
                    {
                        appModel.showDebugInfo
                            ?   <div className={styles.debugtext} >
                                    Sent: {stats.sentCount}  {sendRate.toFixed(1)}/min ({(stats.bytesSent / 1000).toFixed(1)}KB, {sendSize.toFixed(1)}/msg)
                                    Recv: {stats.recievedCount} {recieveRate.toFixed(1)}/min ({(stats.bytesRecieved / 1000).toFixed(1)}KB, {receiveSize.toFixed(1)}/msg)
                                </div>
                            :   null
                    }
                    

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
