// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css"
import classNames from "classnames";
import { StressatoVersion } from "../models/GameSettings";
import { MediaHelper, UIProperties, HostGameState, DevUI, UINormalizer, Row } from "libs";
import { StressatoHostModel, StressatoGameState } from "../models/HostModel";

@inject("appModel") @observer class MonitoringPage 
    extends React.Component<{appModel?: StressatoHostModel }> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: StressatoHostModel, media: MediaHelper }>) {
        super(props);

        props.appModel!.onTick.subscribe("animate", (e) => this.animateFrame(e)) 
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
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel}= this.props;
        if (!appModel) return <div>NO APP MODEL</div>;
        const serverSent = appModel.serverHealth?.summary?.find(i => i.label === "MessageSend")?.data ?? {count: 0, sum: 0}
        const serverReceive = appModel.serverHealth?.summary?.find(i => i.label === "MessageReceive")?.data ?? {count: 0, sum: 0}
        return (
            <div>
                <Row>
                    <div>Players: </div>
                    {appModel.players.map(player => (<div className={styles.nameBox} key={player.playerId}>{player.name}</div>))}
                </Row>
                <div>Game Stats:</div>
                <div>Messages Sent: {appModel.session.stats.sentCount} ({appModel.session.stats.bytesSent} B)</div>
                <div>Messages Received: {appModel.session.stats.recievedCount} ({appModel.session.stats.bytesRecieved} B)</div>
                <div><b>Server Stats:</b></div>
                <div style={{marginLeft: "20px"}}>
                    <div>Rooms: {appModel.serverHealth?.rooms?.roomCount}  Active: {appModel.serverHealth?.rooms?.activeRooms}  Users:{appModel.serverHealth?.rooms?.activeUsers}</div>
                    <div>Messages Sent: {serverSent.count} ({(serverSent.sum/1000).toFixed(2)} KB)</div>
                    <div>Messages Received: {serverReceive.count} ({(serverReceive.sum/1000).toFixed(2)} KB)</div>
                    <div>CPU Utilization: {(appModel.serverHealth?.cpuUsage?.user * 100).toFixed(2)}%</div>
                    <div>Memory Utilization: {(appModel.serverHealth?.memoryUsage?.rss / 1000000).toFixed(2)} MB</div>                    
                </div>

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
extends React.Component<{appModel?: StressatoHostModel, uiProperties: UIProperties}> {

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ appModel?: StressatoHostModel; uiProperties: UIProperties; }>) {
        super(props);

        const {appModel} = this.props;

        let timeAlertLoaded = false;
        appModel?.onTick.subscribe("Timer Watcher", ()=>{
            if(appModel!.secondsLeftInStage > 10) timeAlertLoaded = true; 
            if( (appModel!.gameState === StressatoGameState.Playing)
                && timeAlertLoaded 
                && appModel!.secondsLeftInStage <= 10) {
                timeAlertLoaded = false 
            }
        })

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
                    disabled={appModel.gameState === HostGameState.Gathering}
                    style={{marginRight: "30px"}}
                    onClick={()=>appModel.pauseGame()}>
                        Pause
                </button>
                <div className={classNames(styles.roomCode)}>Room Code: {appModel.roomId}</div>
                <DevUI context={appModel} children={<div></div>} />
                <div style={{marginLeft: "50px"}}>v{StressatoVersion}</div>
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
                        <MonitoringPage />
                    </div>
            </UINormalizer>
        );
    };
}
