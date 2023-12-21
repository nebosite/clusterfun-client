// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LexibleClientModel, LexibleClientState } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { observable } from "mobx";
import { UIProperties, GeneralGameState, SafeBrowser, GeneralClientGameState, UINormalizer, ErrorBoundary, Row } from "libs";
import LexibleClientGameComponent from "./ClientGameComponent";
import LexibleAssets from "../assets/Assets";


interface InstructionsComponentProps {
    appModel?: LexibleClientModel
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
class InstructionsComponent 
  extends React.Component<InstructionsComponentProps> {

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const switchTeam = async () => {
            try {
                await appModel.requestSwitchTeam();
            } catch (err) {
                // TODO: Let the user know we could not switch teams
                console.error("Could not reach presenter to switch teams", err);
            }
        }

        return <div>
            <div className={styles.wait_text}>
                Waiting for the host to start...
            </div>
            <Row>
                <div>You are on Team {appModel.myTeam}</div>
                <button onClick={switchTeam} style={{fontSize: "80%", marginLeft: "50px"}}>Switch Team</button>
            </Row>
            <p><b>How to play</b></p>
            <div className={styles.instructionsRow}>
                <p>
                    1. Claim tiles by spelling a word with adjacent letters. 
                    Tiles you claim will get a point value equal to the length of the word.
                </p>
                <img src={LexibleAssets.images.instructions1} alt="instructions" style={{width: "280px", height: "280px"}} />
            </div>
            <div className={styles.instructionsRow}>
                <p>
                    2. You can claim the other team's tiles, but make sure your word is long enough! 
                    If the word is not longer than a tile's score, it will not be claimed.
                </p>
                <img src={LexibleAssets.images.instructions2}  alt="instructions" style={{width: "480px", height: "280px", marginLeft: "30px"}} />
            </div>
            <p>3. TO WIN: Build a bridge of tiles that connect your team's side to the other side of the grid. </p>
            <img src={LexibleAssets.images.instructions3} alt="instructions" style={{width: "800px", marginLeft: "100px"}} />
        </div>
    }
}
 
class LexibleClientUIState {
    @observable mouseScale = 1;
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client 
  extends React.Component<{appModel?: LexibleClientModel, uiProperties: UIProperties}> {
    lastState:string = GeneralGameState.Unknown;
    containerOffset = {left: 0, top: 0};

    uiState = new LexibleClientUIState();

    // -------------------------------------------------------------------
    // When the component updates, learn about our overall offset
    // -------------------------------------------------------------------
    componentDidUpdate()
    {
        const container = document.getElementById(this.props.uiProperties.containerId) as HTMLElement; 
        if(container)
        {
            var rect = container.getBoundingClientRect();
            this.containerOffset = {left: rect.left, top: rect.top}
        }
    }

    // -------------------------------------------------------------------
    // Do something to alert the user if the game state changed
    // ------------------------------------------------------------------- 
    alertUser() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>
 
        if(appModel.gameState !== this.lastState) { 
            SafeBrowser.vibrate([50,50,50,50]);
        }
        this.lastState = appModel.gameState as string;
    }


    // -------------------------------------------------------------------
    // renderSubScreen
    // ------------------------------------------------------------------- 
    private renderSubScreen() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        switch(appModel.gameState) {
            case GeneralClientGameState.WaitingToStart: return <InstructionsComponent />
            case GeneralClientGameState.Paused:  return  <div>Game has been paused</div> 
            case LexibleClientState.Playing:
                this.alertUser();
                return <LexibleClientGameComponent 
                    clientId={this.props.uiProperties.containerId} 
                    playerId={appModel.playerId}
                    mouseScale={this.uiState.mouseScale} />
            case LexibleClientState.EndOfRound:
                this.alertUser();
                return <div>Round is over.   Team {appModel.winningTeam} is the winner. </div>
            case GeneralGameState.GameOver:
                return (
                    <React.Fragment>
                    <p>Game is over, thanks for playing!</p>
                    <div><button onClick={()=>this.props.appModel?.quitApp()}>Quit</button></div>
                    </React.Fragment>
                );
            case GeneralClientGameState.JoinError:
                return (
                    <React.Fragment>
                    <p style={{background: "red", color: "yellow", fontSize: "150%"}}>Could not join the game because: {this.props.appModel?.joinError}</p>
                    </React.Fragment>
                );
    
            default:
                return <div>UNKNOWN CLIENT STATE: {appModel.gameState}</div>          
        }
    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>

        const reportScale = (scale: number) => {
            this.uiState.mouseScale = .5/scale;
        }

        let background = "lightgray";
        if(appModel.myTeam === "A") background = "#FFFF40"
        if(appModel.myTeam === "B") background = "#AA40AA"

        return (
            <div style={{background}}>

                <UINormalizer uiProperties={this.props.uiProperties}
                    virtualHeight={1920}
                    virtualWidth={1080}
                    onScaleCalc={reportScale}
                    >
                    <div className={styles.gameclient}  style={{background}}>
                        <div className={classNames(styles.divRow, styles.topbar)}>
                            <span className={classNames(styles.gametitle)}>Lexible</span> 
                            <span>{appModel.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel.quitApp()}>X</button>
                        </div>
                        <ErrorBoundary>
                            {this.renderSubScreen()}
                        </ErrorBoundary>
                    </div>
                </UINormalizer>
            </div>
        );
    }
}
