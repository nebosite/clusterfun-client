// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { AnswerType, RetroSpectroClientModel, RetroSpectroClientState } from "../../models/RetroSpectroClientModel";
import { UIProperties, UINormalizer, GeneralGameState, GeneralClientGameState } from "libs";
import styles from './RetroSpectroClient.module.css';
import classNames from "classnames";
import { ErrorBoundary } from "libs/components/ErrorBoundary";
import { SafeBrowser } from "libs/Browser/SafeBrowser";

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client 
  extends React.Component<{appModel?: RetroSpectroClientModel, uiProperties: UIProperties}> {
    lastState: RetroSpectroClientState | GeneralClientGameState | GeneralGameState = GeneralClientGameState.WaitingToStart;

    // -------------------------------------------------------------------
    // Do something to alert the user if the game state changed
    // ------------------------------------------------------------------- 
    alertUser() {
        const {appModel} = this.props;  
        if(!appModel) return;
        if(appModel.gameState !== this.lastState) {
            SafeBrowser.vibrate([50,50,50,50]);
        }
        this.lastState = appModel.gameState as RetroSpectroClientState | GeneralGameState;
    }

    // -------------------------------------------------------------------
    // renderSubScreen
    // ------------------------------------------------------------------- 
    private renderSubScreen() {
        const {appModel} = this.props;

        if(!appModel) return (<div>No Data</div>);

        switch(appModel.gameState) {
            case GeneralClientGameState.WaitingToStart:
                return (<React.Fragment>
                    <div className={styles.wait_text}>
                    Sit tight, waiting for the host to start the retrospective...
                    </div>
                </React.Fragment>);  
            case RetroSpectroClientState.AnsweringQuestion:
                this.alertUser();
                return (<React.Fragment>
                    <p>Think of something that came up this sprint, good or bad.  Enter a cetergory for it here, 5 words or less:</p>
                    <div>
                        <input
                        type="text"
                        value={appModel.currentAnswer}
                        onChange={(ev) =>{ appModel.currentAnswer = ev.target.value;}}
                        />                 
                    </div>
                    <div className={styles.basicRow} >
                        <button 
                            className={classNames(styles.submitButton)} 
                            style={{background: "green"}}
                            disabled={!appModel.currentAnswerOK} 
                            onClick={() => appModel.submitAnswer(AnswerType.Positive)}>Submit as Positive<br/>👍</button>         
                        <button 
                            className={classNames(styles.submitButton)} 
                            style={{background: "red"}}
                            disabled={!appModel.currentAnswerOK} 
                            onClick={() => appModel.submitAnswer(AnswerType.Negative)}>Submit as Negative<br/>👎</button>         
                    </div>
                    <p>Examples:</p>
                    <p style={{marginLeft: "50px"}}>
                        "Bug Tacking System"<br/>
                        "Fred Fenning"<br/>
                        "Standups"<br/>
                        "Cafeteria"<br/>
                    </p>

                  </React.Fragment>)
            case RetroSpectroClientState.WaitingForQuestionFinish:
                return (
                    <React.Fragment>
                    <h4>{appModel.playerName}</h4>
                    <h3>RetroSpectro</h3>
                    <p>To the question "{appModel.activeQuestion}" you answered: "{appModel.currentAnswer}"</p>
                    <p>Waiting for other players to answer...</p>
                    </React.Fragment>
                );
            case RetroSpectroClientState.Sorting:
                return (
                    <React.Fragment>
                    <p>Sorting ...</p>
                    </React.Fragment>
                );
            case GeneralGameState.GameOver:
                return (
                    <React.Fragment>
                    <p>Game is over, thanks for playing!</p>
                    <div><button onClick={()=>appModel.quitApp()}>Quit</button></div>
                    </React.Fragment>
                );
            case RetroSpectroClientState.JoinError:
                return (
                    <React.Fragment>
                    <p>Could not join the game because: {appModel.joinError}</p>
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
        if(!appModel) return (<div>No Data</div>);

        return (
            <UINormalizer uiProperties={this.props.uiProperties}
                virtualHeight={1920}
                virtualWidth={1080}>
                    <div className={styles.gameclient}>
                        <div className={classNames(styles.divRow, styles.topbar)}>
                            <span className={classNames(styles.gametitle)}>RetroSpectro</span>
                            <span>{appModel.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel.quitApp()}>X</button>
                        </div>
                        <div style={{margin: "40px"}}>
                            <ErrorBoundary>
                                {this.renderSubScreen()}
                            </ErrorBoundary>
                        </div>
                    </div>
            </UINormalizer>
        );
    };
}
