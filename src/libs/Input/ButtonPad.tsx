import { observable } from "mobx";
import React from "react";
import styles from './ButtonPad.module.css';

export interface ButtonPadOptions
{
    onNewPosition: (x: number, y:number) => void
}

// -------------------------------------------------------------------
// ButtonPad - simulate buttonpad onscreen with mouse or touch
// -------------------------------------------------------------------
export class ButtonPad  extends React.Component<ButtonPadOptions> 
{
    isMousing = false;
    @observable xDirection = 0;
    @observable yDirection = 0;
    
    handleMoveButtonDown = (x: number, y: number) => { this.props.onNewPosition(x,y)}
    handleMoveButtonUp = () => {this.props.onNewPosition(0,0) }
    
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const renderButton = (x: number, y: number, content: any) => {
            return <div 
                        className={styles.controlButton}  
                        onMouseDown={() => this.handleMoveButtonDown(x,y)}  
                        onMouseUp={this.handleMoveButtonUp}>
                            {content}
                    </div>}

        return (
            <div>
                <div className={styles.controlRow}>
                    {renderButton(-1,-1,"↖")}
                    {renderButton(0,-1,"⬆")}
                    {renderButton(1,-1,"↗")}
                </div>

                <div className={styles.controlRow}>
                    {renderButton(-1,0,"-")}
                    {renderButton(0,0,"-")}
                    {renderButton(1,0,"-")}
                </div>

                <div className={styles.controlRow}>
                    {renderButton(-1,1,"-")}
                    {renderButton(0,1,"-")}
                    {renderButton(1,1,"-")}
                </div>

            </div>);
    }
}
