// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css"
import classNames from "classnames";
import { observable } from "mobx";
import WrongAnswersAssets from "../assets/Assets";
import { WrongAnswersVersion } from "../models/GameSettings";
import { BaseAnimationController, MediaHelper, UIProperties, PresenterGameEvent, PresenterGameState, GeneralGameState, DevUI, UINormalizer } from "libs";
import { WrongAnswersPresenterModel, WrongAnswersGameState, WrongAnswersGameEvent } from "../models/PresenterModel";
import { PresenterGatheringPage } from "./PresenterGatheringPage";
import { PresenterInstructionsPage } from "./PresenterInstructionsPage";
import { PresenterStartRoundPage } from "./PresenterStartRoundPage";


@inject("appModel") @observer
class PausedGamePage  extends React.Component<{appModel?: WrongAnswersPresenterModel}> {

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
                <p>WrongAnswers is paused</p>
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
    extends React.Component<{appModel?: WrongAnswersPresenterModel, media: MediaHelper }> {
    private _playStartAnimation: PlayStartAnimationController;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: WrongAnswersPresenterModel, media: MediaHelper }>) {
        super(props);
        this._playStartAnimation = new  PlayStartAnimationController(()=>{});
        props.appModel!.registerAnimation(this._playStartAnimation);

        props.appModel!.subscribe("ColorChange", "presenterColorChange", () => {
            props.media.playSound(WrongAnswersAssets.sounds.ding)
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
    extends React.Component<{appModel?: WrongAnswersPresenterModel}> {
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
extends React.Component<{appModel?: WrongAnswersPresenterModel, uiProperties: UIProperties}> {
    media: MediaHelper;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: WrongAnswersPresenterModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;

        // Set up sound effects
        this.media = new MediaHelper();
        for(let soundName in WrongAnswersAssets.sounds)
        {
            this.media.loadSound((WrongAnswersAssets.sounds as any)[soundName]);
        }

        const sfxVolume = 1.0;       

        let timeAlertLoaded = false;
        // appModel?.onTick.subscribe("Timer Watcher", ()=>{
        //     if(appModel!.secondsLeftInStage > 10) timeAlertLoaded = true; 
        //     if( (appModel!.gameState === WrongAnswersGameState.Playing)
        //         && timeAlertLoaded 
        //         && appModel!.secondsLeftInStage <= 10) {
        //         timeAlertLoaded = false 
        //         this.media.repeatSound("ding.wav", 5, 100);
        //     }
        // })
        appModel?.subscribe(PresenterGameEvent.PlayerJoined,     "play joined sound", ()=> this.media.playSound(WrongAnswersAssets.sounds.hello, {volume: sfxVolume * .2}));
        appModel?.subscribe(WrongAnswersGameEvent.ResponseReceived,  "play response received sound", ()=> this.media.playSound(WrongAnswersAssets.sounds.response, {volume: sfxVolume}));

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
                return <PresenterGatheringPage />
            case PresenterGameState.Instructions:
                return <PresenterInstructionsPage />
            case WrongAnswersGameState.StartOfRound:
                return <PresenterStartRoundPage />
            // case WrongAnswersGameState.Playing:
            //     return <PlayingPage media={this.media} />
            // case WrongAnswersGameState.EndOfRound:
            // case GeneralGameState.GameOver:
            //     return <EndOfRoundPage />
            case GeneralGameState.Paused:
                return <PausedGamePage />
            default:
                return <div>WrongAnswers: Whoops!  No display for this state: {appModel.gameState}</div>
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
                <div style={{marginLeft: "50px"}}>v{WrongAnswersVersion}</div>
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
