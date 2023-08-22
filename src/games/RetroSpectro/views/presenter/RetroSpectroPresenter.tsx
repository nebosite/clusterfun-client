// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { RetroSpectroPresenterModel, RetroSpectroGameState, RetroSpectroGameEvent } from "../../models/RetroSpectroPresenterModel";
import { UIProperties, UINormalizer, DevOnly, GeneralGameState, DevUI } from "libs";
import styles from './RetroSpectroPresenter.module.css';
import classNames from "classnames";
import { MediaHelper } from "libs/Media/MediaHelper";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import AnswerSortingBox from "./AnswerSortingBox";

@inject("appModel") @observer
class GatheringPlayersPage  extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if(!appModel) return (<div>No Data</div>);

        const startButtonText = () => {
            return  appModel.players.length < appModel.minPlayers 
                    ? `Waiting for at least ${appModel.minPlayers} players to join ...`
                    : "Click here to Start!"
        }

        return (
            <div>
                <h3>Welcome to RetroSpectro</h3>
                <p>Use this at the start of a retrospective meeting to discover
                    what is at the top of everyone's mind and generate productive discussion.</p>
                <p>To Join: go to http://clusterfun.io and enter this room code: {appModel.roomId}</p>
                <p style={{fontWeight: 600}}>Joined team members:</p>
                <div className={styles.basicRow}>
                    {appModel.players.map(player => (<div className={styles.nameBox} key={player.playerId}>{player.name}</div>))}
                </div>
                <button
                    className={styles.button}
                    disabled={appModel.players.length < appModel.minPlayers} 
                    onClick={() => appModel.startGame()}>
                        {startButtonText()}                     
                </button>
            </div>
        );
    }
}

@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

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
        if(!appModel) return (<div>No Data</div>);

        return (
            <div>
                <p>RetroSpectro is paused</p>
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



// -------------------------------------------------------------------
// WaitingForAnswersPage
// -------------------------------------------------------------------
@inject("appModel") @observer class WaitingForAnswersPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

    render() {
        const {appModel} = this.props;
        if(!appModel) return (<div>No Data</div>);

        return (
            <div>
                <p>Begin entering retrospective items on your devices.  </p> 
                <DevOnly>
                    <button onClick={()=> appModel.generateAnswers()}>Make answers</button>
                </DevOnly>
                <p>Seconds left: <span className={styles.secondsCounter}>{appModel.secondsLeftInStage}</span> 
                    <button onClick={()=> appModel.finishRound()}>Done</button>
                </p>
                <p>Answers:</p>
                <div className={styles.answerList}>
                    {appModel.answerCollections.map(a => (
                        <div className={styles.nameBox} 
                        style={{background: (a.answers[0].answerType === "Positive" ? "limegreen": "red")}} 
                        key={a.id}>
                            ****
                        </div>))}
                </div>

            </div>
        );
    }
}

// -------------------------------------------------------------------
// SortingAnswersPage
// -------------------------------------------------------------------
@inject("appModel") @observer class SortingAnswersPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

    render() {
        const {appModel} = this.props;
        if(!appModel) return (<div>No Data</div>);


        return (
            <DndProvider backend={HTML5Backend}>
                <div>
                    <p>OK, let's group the thoughts together- just drag and drop to create groups out of similar ideas. 
                        It's alright if positive and negative ideas are grouped together.  Only the category is important.
                    </p>
                    <AnswerSortingBox context={appModel} />
                    <button className={classNames(styles.doneSortingButton)} 
                            style={{marginRight: "30px"}}
                            onClick={()=>appModel.doneSorting()}>
                                Done
                    </button>                       

                </div>
            </DndProvider>
        );
    }
}


// -------------------------------------------------------------------
// GameOverPage
// -------------------------------------------------------------------

@inject("appModel") @observer class GameOverPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if(!appModel) return (<div>No Data</div>);

        return (
            <div>
                <h2>Game Over</h2>
                <p>Final Scores: </p>
                {appModel.players.map(p => <div key={p.playerId}>{p.name}: {p.totalScore} {p.winner ? <span><b>WINNER!!!</b></span> : null }</div>)}
                ---
                <div className={classNames(styles.divRow)}>
                    <div><button onClick={()=> appModel.playAgain()}>Play Again</button></div>
                    <div><button style={{marginLeft: "20px"}} onClick={()=>appModel.quitApp()}>Quit</button></div>
                </div>
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
extends React.Component<{appModel?: RetroSpectroPresenterModel, uiProperties: UIProperties}> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: RetroSpectroPresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;
        if(!appModel) throw Error("No App Model in Presenter constructor")

        // Set up sound effects
        const media = new MediaHelper();
        //media.loadSound("ding.wav");
        media.loadSound("hello.mp3");
        //media.loadSound("response.mp3");
        const sfxVolume = 1.0;       

        // const repeatSound = (name: string, count: number, delay_ms: number) => {
        //     for(let i = 0; i< count; i++)
        //     {
        //         setTimeout(()=> media.playSound(name, {volume: sfxVolume}), 100 * i)
        //     }
        // }

        let timeAlertLoaded = false;
        appModel.onTick.subscribe("Timer Watcher", ()=>{
            if(appModel.secondsLeftInStage > 10) timeAlertLoaded = true; 
            if( (appModel.gameState === RetroSpectroGameState.WaitingForAnswers)
                && timeAlertLoaded 
                && appModel.secondsLeftInStage <= 10) {
                timeAlertLoaded = false 
                //repeatSound("ding.wav", 5, 100);
            }
        })
        appModel.subscribe(RetroSpectroGameEvent.PlayerJoined,      "play joined sound", ()=> media.playSound("hello.mp3", {volume: sfxVolume}));
        appModel.subscribe(RetroSpectroGameEvent.ResponseReceived,  "play response received sound", ()=> media.playSound("response.mp3", {volume: sfxVolume}));

    }

    // -------------------------------------------------------------------
    // renderSubScreen
    // -------------------------------------------------------------------
    private renderSubScreen() {
        const {appModel} = this.props;
        if(!appModel) {
            console.log("NO GAME DATA.  Quitting...")
            return;
        }

        switch(appModel.gameState)
        {
            case RetroSpectroGameState.Gathering:
                return <GatheringPlayersPage />
            case RetroSpectroGameState.WaitingForAnswers:
                    return <WaitingForAnswersPage />
            case RetroSpectroGameState.Sorting:
                return <SortingAnswersPage />
            case RetroSpectroGameState.GameOver:
                return <GameOverPage />
            case GeneralGameState.Paused:
                return <PausedGamePage />
            default:
                return <div>Unhandled game state: {appModel.gameState}</div>
        }
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if(!appModel) return (<div>No Data</div>);

        return (
            <UINormalizer
                className={styles.gamepresenter}
                uiProperties={this.props.uiProperties}
                virtualHeight={1080}
                virtualWidth={1920}>
                    <div className={classNames(styles.divRow)}>
                        <button className={classNames(styles.button)} 
                            style={{marginRight: "30px"}}
                            onClick={()=>appModel.quitApp()}>
                                Quit
                        </button>                       
                        <div className={classNames(styles.roomCode)}>Room Code: {appModel.roomId}</div>
                        <DevUI context={appModel} ><div></div></DevUI> 
                    </div>
                    <div >
                        <div style={{margin: "40px"}}>
                            {this.renderSubScreen()}
                        </div>
                    </div>
            </UINormalizer>
        );
    };
}
