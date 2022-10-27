// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { TestatoClientModel, TestatoClientState } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { ClusterCanvas, UIProperties, GeneralGameState, SafeBrowser, GeneralClientGameState, UINormalizer, ErrorBoundary} from "libs";


// -------------------------------------------------------------------
// Game Screen -  Client play UI
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameScreen extends React.Component<{appModel?: TestatoClientModel}> 
{
    canvasDomId: string;
    w = 100;
    h = 100;
    canvasContext?: CanvasRenderingContext2D;

    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(props: {appModel?: TestatoClientModel})
    {
        super(props);

        props.appModel!.onTick.subscribe("animate", (e) => this.animateFrame(e))
        this.canvasDomId = "PlayCanvas" + this.props.appModel!.playerId;
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentDidMount()
    {
        this.componentDidUpdate();   
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentDidUpdate()
    {
        const canvas = document.getElementById(this.canvasDomId) as HTMLCanvasElement; 
        this.canvasContext = canvas.getContext("2d") ?? undefined;
        this.w = canvas.width; 
        this.h = canvas.height;
    }

    // -------------------------------------------------------------------
    // animateFrame - render a single animation frame to the canvas
    // -------------------------------------------------------------------
    animateFrame = (elapsed_ms: number) => {
        const {appModel} = this.props;
        if(appModel?.gameState !== TestatoClientState.Playing) return;
        if(!this.canvasContext) return;

        // Clear canvas
        this.canvasContext.fillStyle = "#000000"
        this.canvasContext.fillRect(0,0,this.w,this.h);

        // Draw something
        appModel.gameThink(elapsed_ms);
        const ball = appModel.ballData;
        this.canvasContext.fillStyle = ball.color;
        this.canvasContext.fillRect(ball.x * this.w - 30, ball.y * this.h - 30, 60, 60);
    }

    // -------------------------------------------------------------------
    // Handle taps from the user
    // -------------------------------------------------------------------
    handleClick(x: number, y:number)
    {
        const {appModel} = this.props;
        appModel!.ballData.x = x;
        appModel!.ballData.y = y;   
        appModel!.doTap(x,y)     
    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APPMODEL</div>; 

        return (
            <div>
                <h4>{appModel!.playerName}</h4>

                <div>
                    Tap the screen to set dot position   
                    <div className={styles.gameCanvasFrame} >
                        <ClusterCanvas 
                            canvasId={this.canvasDomId}
                            width={800} height={800}
                            onClick={(x,y) => this.handleClick(x,y)} />
                    </div>
                    <button className={styles.clientButton} onClick={()=>this.props.appModel!.doColorChange()}>Change Colors</button>
                    <button className={styles.clientButton} onClick={()=>this.props.appModel!.doMessage()}>Say Something</button>
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
  extends React.Component<{appModel?: TestatoClientModel, uiProperties: UIProperties}> {
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

        console.debug(`RENDERING WITH GAME STATE: ${appModel?.gameState}`)

        switch(appModel!.gameState) {
            case GeneralClientGameState.WaitingToStart:
                return (<React.Fragment>
                    <div className={styles.wait_text}>
                    Sit tight, we are waiting for the host to start the game...
                    </div>
                </React.Fragment>);  
            case TestatoClientState.Playing:
                this.alertUser();
                return <GameScreen />
            case TestatoClientState.EndOfRound:
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
                            <span className={classNames(styles.gametitle)}>Testato</span> 
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
