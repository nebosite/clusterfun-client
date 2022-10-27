// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LexibleClientModel, LexibleClientState } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { observable } from "mobx";
import { UIProperties, GeneralGameState, SafeBrowser, GeneralClientGameState, UINormalizer, ErrorBoundary } from "libs";
import LexibleClientGameComponent from "./ClientGameComponent";

 
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
            case GeneralClientGameState.WaitingToStart:
                return (<React.Fragment>
                    <div className={styles.wait_text}>
                    Sit tight, we are waiting for the host to start the game...
                    </div>
                </React.Fragment>);  
            case GeneralClientGameState.Paused: 
                return <>
                    <div>Game has been paused</div>
                </>
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
