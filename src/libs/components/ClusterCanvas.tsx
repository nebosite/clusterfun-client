import { observer } from "mobx-react";
import React from "react";

export interface ClusterCanvasProps
{
    canvasId: string,  
    width: number, 
    height: number, 
    onClick?: (x:number, y:number) => void,    
}

// -------------------------------------------------------------------
// ClusterCanvas - mouse and scaling aware canvas component
// -------------------------------------------------------------------
@observer
export class ClusterCanvas extends React.Component<ClusterCanvasProps> 
{
    canvasId: string;
    isMousing = false;
    canvasContext?: CanvasRenderingContext2D;
    w: number = 100;
    h: number = 100;
    mouseWidth = 100;
    mouseHeight = 100;
    mouseStartX = 0;
    mouseStartY = 0;
    mouseDownTime = 0;
    moveDelta = 0;
    canvasScreenOffset = {left:0, top:0}

    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(props: ClusterCanvasProps)
    {
        super(props);
        this.canvasId = props.canvasId;
    }

    // -------------------------------------------------------------------
    // handleMouseDown
    // ------------------------------------------------------------------- 
    handleMouseDown = (event: React.MouseEvent) => 
    {
        const x = event.clientX - this.canvasScreenOffset.left;
        const y = event.clientY - this.canvasScreenOffset.top;
        this.mouseStartX = x;
        this.mouseStartY = y;
        this.mouseDownTime = Date.now();
        this.moveDelta = 0;
        this.isMousing = true; 
    }

    // -------------------------------------------------------------------
    // handleMouseUp
    // ------------------------------------------------------------------- 
    handleMouseUp = (event: React.MouseEvent) => 
    { 
        const timeDelta = Date.now() - this.mouseDownTime;
        const x = event.clientX - this.canvasScreenOffset.left;
        const y = event.clientY - this.canvasScreenOffset.top;

        if(timeDelta < 50 || this.moveDelta < 30)
        {
            //console.log(`Click: ${x.toFixed(0)},${y.toFixed(0)} <${event.clientX.toFixed(0)},${event.clientY.toFixed(0)}> [${this.canvasScreenOffset.left.toFixed(0)},${this.canvasScreenOffset.top.toFixed(0)}] (${this.mouseWidth.toFixed(0)},${this.mouseHeight.toFixed(0)})`)
            if(this.props.onClick) this.props.onClick(x/this.mouseWidth, y/this.mouseHeight);
        }

        this.isMousing = false; 
    }

    // -------------------------------------------------------------------
    // handleMouseMove
    // ------------------------------------------------------------------- 
    handleMouseMove = (event: React.MouseEvent) => {
        // if(this.isMousing) {
        //     let area = event.target as HTMLElement; 
        //     const w = area.clientWidth;
        //     const h = area.clientHeight;
        //     let offsetX = 0;
        //     let offsetY = 0;
        //     while(area) {
        //         offsetX += area.offsetLeft;
        //         offsetY += area.offsetTop;
        //         console.log(`    ${area.nodeType}  ${offsetX},${offsetY}`)
        //         area = area.offsetParent as HTMLElement;
        //     }  
        //     const controlx = event.clientX - offsetX;
        //     const controly = event.clientY - offsetY;
        //     console.log(`    T: ${event.clientX},${event.clientY} -> ${controlx},${controly}`)
        //     const x = (controlx * this.props.scaleAdjust * 2.0 / w) -1;
        //     const y = (controly * this.props.scaleAdjust * 2.0 / h) -1;
        //     this.props.onNewPosition(x,y);
        // }
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentDidMount()
    {
        window.addEventListener(`resize`, this.handleResize);
        this.handleResize();
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    componentWillUnmount()
    {
        window.removeEventListener(`resize`, this.handleResize);
    }

    // -------------------------------------------------------------------
    // When the component mounts, learn about the canvas size and location
    // -------------------------------------------------------------------
    handleResize = () =>
    {
        const canvas = document.getElementById(this.canvasId) as HTMLCanvasElement; 
        this.w = canvas.width; 
        this.h = canvas.height;

        var rect = canvas.getBoundingClientRect();
        this.canvasScreenOffset = { left: rect.left, top: rect.top}
        this.mouseWidth = rect.width;
        this.mouseHeight = rect.height;

        //console.log(`Canvas Update (${this.canvasId}): ${this.mouseWidth},${this.mouseHeight}`)
    }

    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        return <canvas 
            width={`${this.props.width}px`} height={`${this.props.height}px`} 
            id={this.canvasId}
            onMouseDown={this.handleMouseDown} 
            onMouseMove={this.handleMouseMove}
            onMouseUp={this.handleMouseUp}
        />
    };

}

