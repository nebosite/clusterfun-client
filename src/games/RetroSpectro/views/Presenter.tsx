// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { RetroSpectroGameState, RetroSpectroGameEvent, RetroSpectroPresenterModel } from "../models/PresenterModel";
import { UIProperties, UINormalizer, DevOnly, DevUI, GeneralGameState, PresenterGameEvent, PresenterGameState, Row } from "libs";
import styles from './Presenter.module.css';
import classNames from "classnames";
import { MediaHelper } from "libs/Media/MediaHelper";
import { DndProvider } from "react-dnd";
import AnswerSortingBox from "./AnswerSortingBox";
import { HTML5Backend } from "react-dnd-html5-backend";
import { RetroSpectroVersion } from "../models/GameSettings";
import RetroSpectroAssets from "../assets/Assets";

@inject("appModel") @observer
class GatheringPlayersPage  extends React.Component<{appModel?: RetroSpectroPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if(!appModel) return <div>No Data</div>;

        return (
            <div>
                <h3>Welcome to {appModel.name}</h3>
                <div style={{fontSize: "120%"}}>This app is for people who want to talk!  Invite people to join and we will help you discover what is on everone's mind.</div>
                <div style={{fontSize: "100%", marginTop: "60px", marginBottom: "60px", marginLeft: "100px"}}><b>To Join</b>: 
                    <ol style={{marginLeft: "150px"}}>
                        <li>On any web browser, go to <u style={{color:"blue"}}>http://{ window.location.host}</u></li>
                        <li>Enter this room code: {appModel.roomId}</li>
                    </ol> 
                </div>
                <div style={{fontSize: "120%", marginBottom: "30px"}}>(If you are hosting, then you will also want to join from your personal device or another browser window.)</div>
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

// -------------------------------------------------------------------
// InstructionsPage
// -------------------------------------------------------------------
@inject("appModel") @observer class InstructionsPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        return (
            <div>
                <div className={styles.instructions}>
                    <h3>New? Here’s how this works: </h3>
                    <p><b>Stage 1: Brainstorm!</b> The meeting should have a topic, it can be anything.  
                        Maybe "How did things go last week?" or "Family Vacation Ideas." 
                        Now, what thoughts are popping into your head?  Enter them as fast as you can!
                        You only get five words, so you'll have to summarize them. 
                        (Note: what you will write will NOT be anonymous in 
                        stage 3.) </p>  
                    
                    <p><b>Stage 2: Categorize! </b> When the timer finishes, 
                        group the ideas according to theme. </p>


                    <p><b>Stage 3: Talk!</b> 
                      &nbsp; The app will show groupings one at a time, biggest first.  Now Everyone
                        gets to talk.  Why did that idea come up?  Do you agree with it?  Does it 
                        generate new ideas for you? Is there something we could do about it? Once you Feel
                        like a category is talked out, go to the next one. Keep going like 
                        this until you run out 
                        of cards or run out of time.</p>

                </div>
                <button className={styles.letsGo} onClick={()=> this.props.appModel?.startNextRound()}>We have a topic, let's start...</button>
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
        if(!appModel) return <div>No Data</div>;

        return (
            <div className={styles.answeringPage}>
                <p>Begin entering your ideas!  See you device for instructions.  </p> 
                <p style={{fontSize: "80%"}}>Join any time by visiting <u>http://{ window.location.host}</u> and entering the room code. </p> 
                <DevOnly> <button onClick={()=> appModel.generateAnswers()}>Make answers</button></DevOnly>
                <div className={styles.secondsCounterRow}>
                    <div>Seconds left: </div>
                    <div className={styles.secondsCounter}>{appModel.secondsLeftInStage}</div>
                    <div>Add Time: </div>
                    <button className={styles.discussionButton} onClick={()=>appModel.addTime(10)}>10 seconds</button>
                    <button className={styles.discussionButton} onClick={()=>appModel.addTime(60)}>1 minute</button>
                </div>
                <p>Answers:</p>
                <div className={styles.answerList}>
                    {appModel.answerCollections.map(a => (
                        <div className={styles.nameBox} 
                        style={{background: (a.answers[0].answerType === "Positive" ? "limegreen": "red")}} 
                        key={a.id}>
                            <img className={styles.lightbulb} src={RetroSpectroAssets.images.lightbulb} alt="💡" />
                        </div>))}
                </div>
                <button className={styles.doneSortingButton} onClick={()=> appModel.finishRound()}>Done</button>

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
        if(!appModel) return <div>No Data</div>;

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
// SortingAnswersPage
// -------------------------------------------------------------------
@inject("appModel") @observer class DiscussionPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

    state: {summaryVisible: boolean}

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: {appModel?: RetroSpectroPresenterModel})
    {
        super(props);

        this.state = {summaryVisible: false}
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        const {summaryVisible} = this.state;
        if(!appModel) return <div>No Data</div>;

        const discussionBox = () =>
        {
            if(!appModel.currentDiscussion) return null;
            return <div className={styles.discussionGroup}>
                { appModel.currentDiscussion.answers.map(a => (
                    <div className={styles.discussionCard} key={a.id}>
                        <div
                            style={{background: (a.answerType === "Positive" ? "limegreen": "#ff6666")}}>
                            <div className={styles.discussionCardText}>{a.text}</div>
                            <div className={styles.discussionCardAuthor}>({a.player?.name})</div>
                        </div>
                    </div> 
                ))}  
            </div>         
        }

        const prevOpacity = appModel.hasPrev ? 1.0 : .20;
        const nextOpacity = appModel.hasNext ? 1.0 : .20;

        const showSummary = () => {
            this.setState({summaryVisible: !summaryVisible})     
        }



        return (
            <DndProvider backend={HTML5Backend}>
                <div>
                    <div className={styles.summaryBox} style={{opacity: summaryVisible ? 1 : 0, width: summaryVisible ? undefined : "0px" }}>
                        <div>Retro Summary:</div>
                        <ul>
                            {
                                appModel.answerCollections.map(ac =>
                                    {
                                        return (
                                            <li style={{marginLeft: "50px"}}>Category: {ac.name ?? "(none)" }
                                                <ul>
                                                    {ac.answers.map(a => <li key={a.id} style={{marginLeft: "50px"}}>{a.text}</li>)}
                                                </ul>
                                            </li>
                                        )
                                    })
                            }

                        </ul>
                    </div>
                    <div className={styles.divRow}>
                        <div style={{width: "100%"}}>
                            <b>Discussion Time! </b> &nbsp;  Submitters, tell us your thoughts.
                            <br/>Everyone: What have we learned? Is there an action we can take?
                            <button style={{fontSize: "15px"}} onClick={() => appModel.goBackToCategorizing()}>Go back to categorizing</button>
                        </div>
                        <div>
                            <button className={classNames(styles.discussionButton)}  
                                style={{marginLeft:"250px",fontSize:"50%"}}
                                onClick={() => showSummary()}>
                                Show Summary
                            </button>
                        </div>
                    </div>
                    {discussionBox()}
                    <div className={styles.discussionButtonRow}>
                        <button className={classNames(styles.discussionButton)}  
                            style={{opacity: prevOpacity}} 
                            onClick={()=>appModel.prevDiscussion()}>
                                {appModel.prevName + " "}⬅ Prev
                        </button>                       
                        <div className={styles.discussionCategoryLabel}>{appModel.currentDiscussion?.name}</div>
                        <button className={classNames(styles.discussionButton)} 
                            style={{opacity: nextOpacity}}  
                            onClick={()=>appModel.nextDiscussion()}>
                                Next ➡{" " + appModel.nextName}
                        </button>                       
                    </div>

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
        if(!appModel) return <div>No Data</div>;

        return (
            <div>
                <h2>Game Over</h2>
                <p>Final Scores: </p>
                {appModel.players.map(p => <div key={p.playerId}>{p.name}: {p.totalScore} {p.winner ? <span><b>WINNER!!!</b></span> : null }</div>)}
                ---
                <div className={classNames(styles.divRow)}>
                    <div><button onClick={()=>appModel.playAgain()}>Play Again</button></div>
                    <div><button className={styles.presenterButton} onClick={()=>appModel.quitApp()}>Quit</button></div>
                </div>
            </div>
        );
    }
}

// -------------------------------------------------------------------
// PausePage
// -------------------------------------------------------------------
@inject("appModel") @observer class PausePage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if(!appModel) return <div>No Data</div>;

        return (
            <div>
                <h2>Paused - waiting for players to rejoin</h2>
                <Row>
                    <div>Current Players:</div>
                    {appModel.players.map(player => (<div className={styles.nameBox} key={player.playerId}>{player.name}</div>))}
               </Row>
   
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
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: RetroSpectroPresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;
        if(!appModel) throw Error("No appModel")

        // Set up sound effects
        this.media = new MediaHelper();
        for(let soundName in RetroSpectroAssets.sounds)
        {
            this.media.loadSound((RetroSpectroAssets.sounds as any)[soundName]);
        }

        const sfxVolume = 1.0;       

        let timeAlertLoaded = false;
        appModel.onTick.subscribe("Timer Watcher", ()=>{
            if(appModel.secondsLeftInStage > 15) timeAlertLoaded = true; 
            if( (appModel.gameState === RetroSpectroGameState.WaitingForAnswers)
                && timeAlertLoaded 
                && appModel.secondsLeftInStage <= 15) {
                timeAlertLoaded = false 
                this.media.repeatSound(RetroSpectroAssets.sounds.ding, 5, 100);
            }
        })
        appModel.subscribe(PresenterGameEvent.PlayerJoined,     "play joined sound", 
            ()=> this.media.playSound(RetroSpectroAssets.sounds.response, {volume: sfxVolume * .5}));
        appModel.subscribe(RetroSpectroGameEvent.ResponseReceived,  "play response received sound", 
            ()=> this.media.playSound(RetroSpectroAssets.sounds.ding, {volume: sfxVolume}));

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
            case PresenterGameState.Gathering:              return <GatheringPlayersPage />
            case RetroSpectroGameState.Instructions:        return <InstructionsPage />
            case RetroSpectroGameState.WaitingForAnswers:   return <WaitingForAnswersPage />
            case RetroSpectroGameState.Sorting:             return <SortingAnswersPage />
            case RetroSpectroGameState.Discussing:          return <DiscussionPage />
            case GeneralGameState.GameOver:                 return <GameOverPage />
            case GeneralGameState.Paused:                   return <PausePage />
            default: return <div>Unhandled game state: {appModel.gameState}</div>
        }
    }

    // -------------------------------------------------------------------
    // renderFrame
    // -------------------------------------------------------------------
    private renderFrame() {
        const {appModel} = this.props;
        if(!appModel) return <div>No Data</div>;
        
        return (
            <div className={classNames(styles.divRow, styles.navbar)}>
                <img src={RetroSpectroAssets.images.logo} alt="RS" className={styles.icon} />
                <div className={styles.divRow}>
                    <div className={styles.appTitle}>RetroSpectro</div>
                    <div className={styles.appVersion}>v{RetroSpectroVersion}</div>
                </div>
                <div className={classNames(styles.roomCode)}>Room Code: <span style={{fontSize: "120%", fontWeight: 800}}>{appModel.roomId}</span></div>
                <DevUI context={appModel} />
                <button className={styles.presenterButton} 
                    style={{marginRight: "30px", width: "100px", fontSize: "90%"}}
                    onClick={()=>appModel.quitApp()}>
                        Quit
                </button>                       
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
