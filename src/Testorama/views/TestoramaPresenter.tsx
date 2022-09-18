// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { TestoramaGameState, TestoramaGameEvent, TestoramaPresenterModel } from "../models/TestoramaPresenterModel";
import { UIProperties, UINormalizer } from "libs";
import styles from './TestoramaPresenter.module.css';
import classNames from "classnames";
import { MediaHelper } from "libs/Media/MediaHelper";
import { PresenterGameEvent, PresenterGameState } from "libs/models/ClusterfunPresenterModel";
import { GeneralGameState } from "libs/models/BaseGameModel";
import DevUI from "libs/components/DevUIComponent";
import { BaseAnimationController } from "libs/Animation/AnimationController";
import { observable } from "mobx";
import TestoramaAssets from "../assets/TestoramaAssets";
import { TestoramaVersion } from "../models/TestoramaGameSettings";

@inject("appModel") @observer
class GatheringPlayersPage  extends React.Component<{appModel?: TestoramaPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        return (
            <div>
                <h3>Welcome to {appModel.name}</h3>
                <p>This is an example app for clusterfun.</p>
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
            </div>
        );

    }
}

@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: TestoramaPresenterModel}> {

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
                <p>Testorama is paused</p>
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

class PlayStartAnimationController  extends BaseAnimationController {
    @observable announceText = " ";
    @observable textLocation: string | null = null;
    @observable showStatus: boolean = false;
    
    constructor(onFinish: ()=> void) {      
        super(onFinish);

        const textAnimation = (fraction: number) =>
        {
            const x = .01 + .01 * Math.sin(fraction * 20)
            this.textLocation = `${(x * 100).toFixed(2)}%`
        }

        // set up a set of sequential animations
        // delay_s = how many seconds to wait before the action happens
        this.run([
            {delay_s: 1.0, id: "Introduce Round",       action: (c)=>{this.announceText = "Here we go..."; this.slide(1, textAnimation)}},
            {delay_s: 2.0, id: "heads up!",             action: (c)=>{this.announceText = "Instructions are on your devices"}},
            {delay_s: 4.0, id: "Now play",     action: (c)=>{this.showStatus = true; }},
        ])
    }
}

@inject("appModel") @observer class PlayingPage 
    extends React.Component<{appModel?: TestoramaPresenterModel, media: MediaHelper }> {
    private _playStartAnimation: PlayStartAnimationController;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: TestoramaPresenterModel, media: MediaHelper }>) {
        super(props);
        this._playStartAnimation = new  PlayStartAnimationController(()=>{});
        props.appModel!.registerAnimation(this._playStartAnimation);

        props.appModel!.onTick.subscribe("animate", (e) => this.animateFrame(e)) 
        props.appModel!.subscribe("ColorChange", "presenterColorChange", () => {
            props.media.playSound(TestoramaAssets.sounds.ding)
        })
    }

    // -------------------------------------------------------------------
    // animateFrame - render a single animation frame to the canvas
    // -------------------------------------------------------------------
    animateFrame = (elapsed_ms: number) => {
        const canvas = document.getElementById("presenterGameCanvas") as HTMLCanvasElement;
        if(!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;

        context.fillStyle = "#888888";
        const w = canvas.width;
        const h = canvas.height;
        context.fillRect(0,0,w,h);

        this.props.appModel?.players.forEach(p=>
            {
                const px = p.x * h;
                const py = p.y * h * .9 + h * 0.05;
                context.font = '50px serif';
                let label = p.name;
                if(p.message !== "") label += ` says '${p.message}'`;
                context.fillStyle = "#777777" 
                context.fillText(label, px+4, py+4);
                context.fillStyle = p.colorStyle;
                context.fillText(label, px, py);
            })
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel}= this.props;
        if (!appModel) return <div>NO APP MODEL</div>;
        return (
            <div>
                {this._playStartAnimation.showStatus 
                    ? <div>Playing round {appModel.currentRound}.  Seconds left: {appModel.secondsLeftInStage}</div>
                    : <div style={{paddingLeft: this._playStartAnimation.textLocation ?? "0px"}}>&nbsp;{this._playStartAnimation.announceText}</div>
                }
                <div className={styles.gameCanvasFrame} >
                    <canvas className={styles.gameCanvas} width="1200px" height="700px" id="presenterGameCanvas" />
                </div>
            </div>
        );
    }
}

@inject("appModel") @observer class EndOfRoundPage 
    extends React.Component<{appModel?: TestoramaPresenterModel}> {
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
extends React.Component<{appModel?: TestoramaPresenterModel, uiProperties: UIProperties}> {
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: TestoramaPresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;

        // Set up sound effects
        this.media = new MediaHelper();
        for(let soundName in TestoramaAssets.sounds)
        {
            this.media.loadSound((TestoramaAssets.sounds as any)[soundName]);
        }

        const sfxVolume = 1.0;       

        let timeAlertLoaded = false;
        appModel?.onTick.subscribe("Timer Watcher", ()=>{
            if(appModel!.secondsLeftInStage > 10) timeAlertLoaded = true; 
            if( (appModel!.gameState === TestoramaGameState.Playing)
                && timeAlertLoaded 
                && appModel!.secondsLeftInStage <= 10) {
                timeAlertLoaded = false 
                this.media.repeatSound("ding.wav", 5, 100);
            }
        })
        appModel?.subscribe(PresenterGameEvent.PlayerJoined,     "play joined sound", ()=> this.media.playSound(TestoramaAssets.sounds.hello, {volume: sfxVolume * .2}));
        appModel?.subscribe(TestoramaGameEvent.ResponseReceived,  "play response received sound", ()=> this.media.playSound(TestoramaAssets.sounds.response, {volume: sfxVolume}));

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
            case PresenterGameState.Gathering:
                return <GatheringPlayersPage />
            case TestoramaGameState.Playing:
                return <PlayingPage media={this.media} />
            case TestoramaGameState.EndOfRound:
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
                <div style={{marginLeft: "50px"}}>v{TestoramaVersion}</div>
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
