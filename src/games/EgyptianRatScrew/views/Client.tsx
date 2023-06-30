// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { EgyptianRatScrewClientModel, EgyptianRatScrewClientState } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { ClusterCanvas, UIProperties, GeneralGameState, SafeBrowser, GeneralClientGameState, UINormalizer, ErrorBoundary} from "libs";
import Logger from "js-logger";


// -------------------------------------------------------------------
// Game Screen -  Client play UI
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameScreen extends React.Component<{appModel?: EgyptianRatScrewClientModel}> 
{
    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(props: {appModel?: EgyptianRatScrewClientModel})
    {
        super(props);
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentDidMount()
    {
        this.componentDidUpdate();
        // TODO: Set where needed: Do a vibrate whenever an action fails
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentDidUpdate()
    {

    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APPMODEL</div>; 

        // TODO: Integrate the styling of the buttons below into the style sheet

        // TODO: "Play" should be disabled if you don't have cards -
        // I'm leaving that behavior out for now because I can't get
        // the component to update according to the number of cards
        // remaining
        return (
            <div>
                <h4>{appModel.playerName}</h4>
                <p>{appModel.numberOfCards} Cards Remaining</p>
                <div style={ { height: "1500px", display: "flex", flexDirection: "column", alignItems: "stretch" } }>
                    <button 
                        className={styles.clientButton}
                        style={{ height: "100%", backgroundColor: "#8f8" }}
                        onClick={()=>appModel.doPlayCard()}>
                            Play
                    </button>
                    <button 
                        className={styles.clientButton} 
                        style={{ height: "100%", backgroundColor: "#ff8" }}
                        onClick={()=>appModel.doTakePile()}>
                            Take
                    </button>
                </div>
            </div>
        );
    };

}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client 
  extends React.Component<{appModel?: EgyptianRatScrewClientModel, uiProperties: UIProperties}> {
    lastState:string = GeneralGameState.Unknown;
    containerOffset = {left: 0, top: 0};

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
            case EgyptianRatScrewClientState.Playing:
                this.alertUser();
                return <GameScreen />
            case EgyptianRatScrewClientState.EndOfRound:
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
        // TODO: Because quitting a game in progress results in you forfeiting all of your cards,
        // quitting here should produce an "are you sure" modal or should otherwise
        // be hard to hit on accident
        return (
            <div>

                <UINormalizer uiProperties={this.props.uiProperties}
                    virtualHeight={1920}
                    virtualWidth={1080}>
                    <div className={styles.gameclient}>
                        <div className={classNames(styles.divRow, styles.topbar)}>
                            <span className={classNames(styles.gametitle)}>EgyptianRatScrew</span> 
                            <span>{appModel?.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel?.quitApp()}>X</button>
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
