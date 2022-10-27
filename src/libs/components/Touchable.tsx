import { observer } from "mobx-react";
import React from "react";
import styles from './Touchable.module.css';

class MomentumTracker
{
    x: number = 0;
    y: number = 0;
    lastTime = Date.now();
    ms_per_frame: number;
    averageFactor = 5;

    constructor(ms_per_frame: number) {
        this.ms_per_frame = ms_per_frame; 
    }

    addDelta(dx: number, dy: number)
    {
        let dt = Date.now() - this.lastTime;
        this.lastTime = Date.now();
        if(dt === 0) dt = 1;
        const steps = Math.ceil(dt/this.ms_per_frame)
        dt /= 1000;

        const dxdt = dx/dt;
        const dydt = dy/dt;
        const keepFactor = (this.averageFactor - 1) / this.averageFactor;
        const newFactor = 1 - keepFactor;

        // console.debug(`__C: ${dx.toFixed(3)},${dy.toFixed(3)},${dt.toFixed(3)} --> [${steps}] ${dxdt.toFixed(3)},${dydt.toFixed(3)}`)
        // console.debug(`     (${this.x.toFixed(3)},${this.y.toFixed(3)})`)

        for(let i = 0; i < steps; i++) {
            this.x = this.x * keepFactor + dxdt * newFactor;
            this.y = this.y * keepFactor + dydt * newFactor;
        }
        // console.debug(`     (${this.x.toFixed(3)},${this.y.toFixed(3)})`)

    }
}

const MOUSE_TOUCH_ID=-1;

class TouchTracker
{
    start: {x: number, y:number, time:number}
    moveDelta: {x: number, y:number}
    travelDistance = 0
    distanceFromStart = 0
    lastPosition: {x:number, y:number}
    momentum = new MomentumTracker(30);
    tags:string[] = []
    
    constructor(start: {x:number, y: number})
    {
        this.start= {...start,time: Date.now()};
        this.lastPosition = start
        this.moveDelta = {x:0, y:0}
    }

    hasTag = (tagName: string) => this.tags.findIndex(i => i === tagName) > -1

    addTag = (tagName: string) => this.tags.push(tagName);

    addPosition(position: {x:number, y:number}) {
        const sdx = (position.x - this.start.x);
        const sdy = (position.y - this.start.y);
        const dx = (position.x - this.lastPosition.x);
        const dy = (position.y - this.lastPosition.y);
        this.momentum.addDelta(dx,dy);
        this.lastPosition = position
        this.travelDistance += Math.sqrt(dx * dx + dy * dy)
        this.distanceFromStart = Math.sqrt(sdx * sdx + sdy * sdy)
        return {
            delta: {x:dx,y:dy}, 
            momentum: {x: this.momentum.x , y: this.momentum.y}
        }
    }

}

export interface TouchableEvent {
    touchId: number
    location: {x:number, y: number}
}
export interface TouchableDragStartEvent extends TouchableEvent {
}
export interface TouchableDragEvent extends TouchableEvent {
    delta: {x: number, y: number}
    momentum: {x:number, y: number}
}
export interface TouchableDragEndEvent extends TouchableEvent {
    momentum: {x:number, y: number}
}

interface TouchableProps {
    className?: string
    style?: any
    surfaceId: string;
    width: number;
    height: number;
    onDragStart?: (ev: TouchableDragStartEvent) => void
    onDrag?: (ev: TouchableDragEvent) => void
    onDragEnd?: (ev: TouchableDragEndEvent) => void
    children: React.ReactNode;
}

@observer
export class Touchable extends React.Component<TouchableProps>
{
    surfaceId: string;
    w: number = 100;
    h: number = 100;
    viewWidth = 100;
    viewHeight = 100;
    surfaceOffset = {left:0, top:0}
    touchSize = {width: 0, height: 0}
    
    touchTrackers = new Map<number, TouchTracker>();

    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(props: TouchableProps)
    {
        super(props);
        this.surfaceId = props.surfaceId;
    }


    // -------------------------------------------------------------------
    // componentDidUpdate
    // -------------------------------------------------------------------
    componentDidUpdate() {
        this.handleResize();
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
        const canvas = document.getElementById(this.surfaceId) as HTMLCanvasElement; 
        this.w = canvas.width; 
        this.h = canvas.height;

        var rect = canvas.getBoundingClientRect();
        this.surfaceOffset = { left: rect.left, top: rect.top}
        this.touchSize.width = rect.width;
        this.touchSize.height = rect.height;
    }


    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render()
    {
        const toPixels = (ev: {clientX: number, clientY: number}) => {
            const x = ((ev.clientX - this.surfaceOffset.left) / this.touchSize.width) * this.props.width;
            const y = ((ev.clientY - this.surfaceOffset.top) / this.touchSize.height) * this.props.height;
            return {x,y}
        }

        const handleStart = (touchId: number, ev: {clientX: number, clientY: number}) => {
            this.touchTrackers.set(touchId, new TouchTracker(toPixels(ev)))
        }

        const onMouseDown = (ev: React.MouseEvent) => {
            handleStart(MOUSE_TOUCH_ID, ev);
        }

        const onTouchStart = (ev: React.TouchEvent) => {
            Array.from(ev.touches).forEach(t =>  handleStart(t.identifier, t))
        }

        const handleMove = (touchId: number, ev: {clientX: number, clientY: number}) => {
            const tracker = this.touchTrackers.get(touchId)
            if(tracker)
            {
                const location = toPixels(ev);
                const {delta, momentum} = tracker.addPosition(location)
                if(tracker.travelDistance > 5) {
                    if(!tracker.hasTag("drag")) {
                        tracker.addTag("drag");
                        if(this.props.onDragStart) this.props.onDragStart({touchId, location})
                    }
                    if(this.props.onDrag) this.props.onDrag({touchId, delta, momentum, location})
                }
            }
        }

        const onMouseMove = (ev: React.MouseEvent) => { 
            handleMove(MOUSE_TOUCH_ID, ev);
        }

        const onTouchMove = (ev: React.TouchEvent) => {
            Array.from(ev.touches).forEach(t => { handleMove(t.identifier, t) })
        }

        const handleUp = (touchId: number, ev: {clientX: number, clientY: number} | undefined) => {
            const tracker = this.touchTrackers.get(touchId)
            if(tracker)
            {
                const location = ev ? toPixels(ev) : tracker.lastPosition;
                const {delta, momentum} = tracker.addPosition(location)
                if(tracker.hasTag("drag")) {
                    if(this.props.onDrag) this.props.onDrag({touchId,delta, momentum, location})
                    if(this.props.onDragEnd) this.props.onDragEnd({touchId, momentum, location})
                }
                this.touchTrackers.delete(touchId)
            }
        }

        const onMouseUp = (ev: React.MouseEvent) => {
            let returnValue = true;
            handleUp(MOUSE_TOUCH_ID, ev);
            return returnValue;
        }

        const onTouchEnd  = (ev: React.TouchEvent) => {
            const endedTouches = Array.from(this.touchTrackers.keys());

            // Any reported touches here are still active
            Array.from(ev.touches).forEach(t => { 
                const index = endedTouches.indexOf(t.identifier);
                if(index === -1) {
                    console.warn(`WEIRD: got a touch end for untracked touch: ${t.identifier}`)
                }
                else {
                    endedTouches.splice(index,1);
                }
            })
            endedTouches.forEach(t => { 
                handleUp(t, undefined)
            })
           
            Array.from(ev.touches).forEach(t => { handleMove(t.identifier, t) })
        }


        return <div 
            id={this.surfaceId}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}

            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}

            className={`${this.props.className} ${styles.touchableControl}`} 
            style={{...(this.props.style), touchAction: "none"}}> 
                { this.props.children }                
            </div>
    }
}  

