// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { StressatoClientModel } from "../models/ClientModel";
import styles from './Client.module.css';
import classNames from "classnames";
import { UIProperties, UINormalizer, ErrorBoundary, Row} from "libs";

interface NumberAdjusterProps {
    value: number
    min: number
    max: number
    increments: number[]
    absolutes: number[]
    title: string
    onValueChange: (newValue: number) => void
}



class NumberAdjuster extends React.Component<NumberAdjusterProps> 
{
    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {value, min, max, increments, absolutes, title, onValueChange} = this.props;

        const set= (newValue: number) => {
            if(newValue < min) newValue = min;
            if(newValue > max) newValue = max;
            onValueChange(newValue);
        }

        return (
            <div>
                <Row>
                    <div>{title}</div>
                    <div className={styles.valueBox}>{value}</div>
                    {increments.map(i => <Row key={i}>
                        <button onClick={()=>set(value - i)}>-{i}</button>
                        <button onClick={()=>set(value + i)}>+{i}</button>
                        </Row>)}
                </Row>
                <Row>
                    {absolutes.map(i => <Row key={i}>
                        <button onClick={()=>set(i)}>{i}</button>
                    </Row>)}
                </Row>                
            </div>

            
        );
    };
}

// -------------------------------------------------------------------
// Game Screen -  Client play UI
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameScreen extends React.Component<{appModel?: StressatoClientModel}> 
{
    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APPMODEL</div>; 

        return (
            <div>
                <h4>{appModel!.playerName}</h4>
                <NumberAdjuster 
                        title="Send messages/min:"
                        min={0}
                        max={120}
                        increments={[1]}
                        absolutes={[0,1,6,30,60,120]}
                        value={appModel.sendRate}
                        onValueChange={(v) => appModel.sendRate = v}
                        />
                <NumberAdjuster 
                        title="Message Size (B):"
                        min={0}
                        max={10000}
                        increments={[1,10,100]}
                        absolutes={[0,100,1000,5000,10000]}
                        value={appModel.messageSize}
                        onValueChange={(v) => appModel.messageSize = v}
                        />
                <NumberAdjuster 
                        title="Return Size (B):"
                        min={0}
                        max={1000}
                        increments={[1,10]}
                        absolutes={[0,100,300,1000]}
                        value={appModel.returnMessageSize}
                        onValueChange={(v) => appModel.returnMessageSize = v}
                        />

                <div>Messages Sent: {appModel.session.stats.sentCount}</div>  
                <div>Bytes Sent: {appModel.session.stats.bytesSent}</div>    
                <div>Messages Recieved: {appModel.session.stats.recievedCount}</div>  
                <div>Bytes Received: {appModel.session.stats.bytesRecieved}</div>    
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
  extends React.Component<{appModel?: StressatoClientModel, uiProperties: UIProperties}> {
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
                            <span className={classNames(styles.gametitle)}>Stressato</span> 
                            <span>{appModel?.playerName}</span>
                            <button className={classNames(styles.quitbutton)} onClick={()=>appModel?.quitApp()}>X</button>
                        </div>
                        <div style={{margin: "10px"}}>
                            <ErrorBoundary>
                                <GameScreen />
                            </ErrorBoundary>
                        </div>
                    </div>
                </UINormalizer>
            </div>
        );
    }
}
