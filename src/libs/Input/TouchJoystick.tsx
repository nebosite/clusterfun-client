import React from "react";
import styles from './TouchJoystick.module.css';

export interface TouchJoystickOptions
{
    onNewPosition: (x: number, y:number) => void ,
    offsetAdjustId: string,
    scaleAdjust: number   
}

// -------------------------------------------------------------------
// Touch Joystick - simulate joystick onscreen with mouse or touch
// -------------------------------------------------------------------
export class TouchJoystick  extends React.Component<TouchJoystickOptions> 
{
    isMousing = false;
    handleMouseDown = (event: React.MouseEvent) => { this.isMousing = true; }
    handleMouseUp = (event: React.MouseEvent) => { this.isMousing = false; }
    handleMouseMove = (event: React.MouseEvent) => {
        if(this.isMousing) {
            let area = event.target as HTMLElement; 
            const w = area.clientWidth;
            const h = area.clientHeight;
            let offsetX = 0;
            let offsetY = 0;
            while(area) {
                offsetX += area.offsetLeft;
                offsetY += area.offsetTop;
                console.debug(`    ${area.nodeType}  ${offsetX},${offsetY}`)
                area = area.offsetParent as HTMLElement;
            }  
            const controlx = event.clientX - offsetX;
            const controly = event.clientY - offsetY;
            console.debug(`    T: ${event.clientX},${event.clientY} -> ${controlx},${controly}`)
            const x = (controlx * this.props.scaleAdjust * 2.0 / w) -1;
            const y = (controly * this.props.scaleAdjust * 2.0 / h) -1;
            this.props.onNewPosition(x,y);
        }
    }
    
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        return (
            <div className={styles.onScreenJoystick} 
                onMouseDown={this.handleMouseDown} 
                onMouseMove={this.handleMouseMove}
                onMouseUp={this.handleMouseUp}

                id="joystickArea"
            >

            </div>);
    }
}
