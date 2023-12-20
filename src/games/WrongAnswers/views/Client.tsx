// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { WrongAnswersClientModel, WrongAnswersClientState } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { UIProperties, GeneralGameState, SafeBrowser, GeneralClientGameState, UINormalizer, ErrorBoundary} from "libs";
import Logger from "js-logger";
import { ClientAnsweringPage } from "./ClientAnsweringPage";


// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client 
  extends React.Component<{appModel?: WrongAnswersClientModel, uiProperties: UIProperties}> {
    lastState:string = GeneralGameState.Unknown;
    containerOffset = {left: 0, top: 0};

    // -------------------------------------------------------------------
    // Do something to alert the user if the game state changed
    // ------------------------------------------------------------------- 
    alertUser() {
        const {appModel} = this.props;
        if(appModel!.gameState !== this.lastState) { 
            SafeBrowser.vibrate([50,50,50,50]);
        }
        this.lastState = appModel!.gameState as string;
    }

    // -------------------------------------------------------------------
    // renderSubScreen
    // ------------------------------------------------------------------- 
    private renderSubScreen() {
        const {appModel} = this.props;

        Logger.debug(`RENDERING WITH GAME STATE: ${appModel?.gameState}`)

        switch(appModel!.gameState) {
            case GeneralClientGameState.WaitingToStart:
                return (<React.Fragment>
                    <div className={styles.wait_text}>
                    Sit tight, we are waiting for the host to start the game...
                    </div>
                </React.Fragment>);  
            case WrongAnswersClientState.Answering:
                this.alertUser();
                return <ClientAnsweringPage />
            case WrongAnswersClientState.EndOfRound:
                this.alertUser();
                return <div>Round is over... </div>
            case GeneralGameState.GameOver:
                return (
                    <React.Fragment>
                    <p>Game is over, thanks for playing!</p>
                    <div><button onClick={()=>this.props.appModel!.quitApp()}>Quit</button></div>
                    </React.Fragment>
                );
            case GeneralClientGameState.JoinError:
                return (
                    <React.Fragment>
                    <p>Could not join the game because: {this.props.appModel!.joinError}</p>
                    </React.Fragment>
                );

    
            default:
                return <div>These are not the droids you are looking for...</div>          
        }
    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        return (
            <div>

                <UINormalizer uiProperties={this.props.uiProperties}
                    virtualHeight={1920}
                    virtualWidth={1080}>
                    <div className={styles.gameclient}>
                        <div className={classNames(styles.divRow, styles.topbar)}>
                            <span className={classNames(styles.gametitle)}>WrongAnswers</span> 
                            <span>{appModel?.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel?.quitApp()}>X</button>
                        </div>
                        <div className={styles.subScreenFrame}>
                            <ErrorBoundary>
                                {this.renderSubScreen()}
                            </ErrorBoundary>
                        </div>
                    </div>
                </UINormalizer>
            </div>
        );
    }
}
