// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { AnswerType, RetroSpectroClientModel, RetroSpectroClientState } from "../models/ClientModel";
import { UIProperties, UINormalizer, GeneralGameState, GeneralClientGameState } from "libs";
import styles from './Client.module.css';
import { ErrorBoundary } from "libs/components/ErrorBoundary";
import { SafeBrowser } from "libs/Browser/SafeBrowser";
import classNames from "classnames";

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client 
  extends React.Component<{appModel?: RetroSpectroClientModel, uiProperties: UIProperties}> {
    lastState:string = GeneralGameState.Unknown;
    containerOffset = {left: 0, top: 0};

    // -------------------------------------------------------------------
    // When the component updates, learn about our overall offset
    // -------------------------------------------------------------------
    componentDidUpdate()
    {
        // TODO: update any calculated coordinates here.  (See Foomius)
    }

    // -------------------------------------------------------------------
    // Do something to alert the user if the game state changed
    // ------------------------------------------------------------------- 
    alertUser() {
        const {appModel} = this.props;  
        if(!appModel) return <div>No Data</div>;

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
        if(!appModel) return <div>No Data</div>;

        switch(appModel.gameState) {
            case GeneralClientGameState.WaitingToStart:
                return (<React.Fragment>
                    <div className={styles.wait_text}>
                    Sit tight, waiting for the host to start the retrospective...
                    </div>
                </React.Fragment>);  
            case RetroSpectroClientState.SubmittingAnswers:
                this.alertUser();
                return (<React.Fragment>
                    <p>As you think about the topic, write down whatever pops into your head. 
                        There are no good or bad ideas.  Trust your brain!</p>
                        <p> Summarize your idea here in 5 words or less:</p>
                    <div>
                        <input
                        type="text"
                        value={appModel.currentAnswer}
                        onChange={(ev) =>{ appModel.currentAnswer = ev.target.value;}}
                        />                 
                    </div>
                    <div className={styles.divRow} >
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
                        "coffee machine"<br/>
                    </p>

                  </React.Fragment>)
            case RetroSpectroClientState.Sorting:
                return (
                    <React.Fragment>
                    <p>The presenter is now sorting all of the suggestions into categories.  Feel 
                        free to suggest how to group the different items. 
                    </p>
                    </React.Fragment>
                );
            case RetroSpectroClientState.Discussing:
                if(appModel.hasOnscreenAnswer) this.alertUser();
                return (
                    <React.Fragment>
                        <p>We are now in a team discussion.</p>
                        {appModel.hasOnscreenAnswer ? <div className={styles.answerAlert}>You have an answer on this page - tell us more!</div> : null}
                    </React.Fragment>
                );
    
            case GeneralGameState.GameOver:
                return (
                    <React.Fragment>
                    <p>Game is over, thanks for playing!</p>
                    <div><button onClick={()=>appModel.quitApp()}>Quit</button></div>
                    </React.Fragment>
                );
            case GeneralClientGameState.JoinError:
                return (
                    <React.Fragment>
                    <p>Could not join the game because: {appModel.joinError}</p>
                    </React.Fragment>
                );

    
            default:
                return <div>These are not the droids you are looking for... ({appModel.gameState})</div>          
        }
    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        if(!appModel) return <div>No Data</div>;

        return (
            <div>

                <UINormalizer uiProperties={this.props.uiProperties}
                    virtualHeight={1920}
                    virtualWidth={1080}>
                    <div className={styles.gameclient}>
                        <div className={classNames(styles.divRow, styles.topbar)}>
                            <span className={classNames(styles.gametitle)}>RetroSpectro</span> 
                            <span>{appModel.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel.quitApp()}>X</button>
                        </div>
                        <div style={{margin: "100px"}}>
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
