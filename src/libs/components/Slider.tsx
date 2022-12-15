import { Vector2 } from "../../libs";
import { action, makeObservable, observable } from "mobx";
import { observer } from "mobx-react";
import React from "react"
import styles from './Slider.module.css';
import  { Touchable, TouchableDragStartEvent, TouchableDragEvent, TouchableDragEndEvent } from "./Touchable";
import Logger from "js-logger";


export interface SliderDriftEventParameters {
    momentum: {x:number, y: number}
    delta: {x:number, y: number}
    offset: {x:number, y: number}
}
export interface SliderProps
{
    className?: string
    style?: any
    sliderId: string
    width: number
    height: number
    contentWidth: number
    contentHeight: number
    dragStartDistance?: number
    startLocation?: Vector2
    onDrift?: (ev: SliderDriftEventParameters) => void
    onDragStart?: () => void;
    onDragEnd?: () => void;
    children: React.ReactNode;
}

class SliderState {
    @observable private _offsetX = 0;
    get offsetX() { return this._offsetX}
    set offsetX(value: number) { action(()=>this._offsetX = value)()}

    @observable private _offsetY = 0;
    get offsetY() { return this._offsetY}
    set offsetY(value: number) { action(()=>this._offsetY = value)()}

    constructor(){
        makeObservable(this);
    }
}


@observer
export class Slider extends React.Component<SliderProps>
{
    @observable st = new SliderState();
    touching = false;

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: SliderProps) {
        super(props);
        this.st = new SliderState();
        if(props.startLocation) {
            this.st.offsetX = props.startLocation.x;
            this.st.offsetY = props.startLocation.y;
        }
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render()
    {
        const fixOffset = () => {
            const {width, height, contentWidth, contentHeight} = this.props;
            const rightBound = width * .4;
            const bottomBound = height * .4;
            const leftBound = -contentWidth + width * .6
            const topBound = -contentHeight + height * .6

            if(this.st.offsetX < leftBound) this.st.offsetX = leftBound;
            if(this.st.offsetY < topBound) this.st.offsetY = topBound;
            if(this.st.offsetX > rightBound) this.st.offsetX = rightBound;
            if(this.st.offsetY > bottomBound) this.st.offsetY = bottomBound;

        }

        const onDragStart = (ev: TouchableDragStartEvent) => {
            this.touching = true;
            if(this.props.onDragStart) {
                this.props.onDragStart();
            }
        }

        const onDrag = (ev: TouchableDragEvent) => {
            // While moving, just pin the child to the movement
            this.st.offsetX += ev.delta.x;
            this.st.offsetY += ev.delta.y;
            fixOffset();
            //Logger.debug(`move: ${this.st.offsetX.toFixed(0)} ${this.st.offsetY.toFixed(0)}`)

        }

        const onDragEnd = (ev: TouchableDragEndEvent) => {
            this.touching = false;
            if(this.props.onDragEnd) {
                this.props.onDragEnd();
            }
           
            const momentum = {x: ev.momentum.x, y: ev.momentum.y}

            //Logger.debug(`Momentum: ${momentum.x} ${momentum.y}`)

            // Now let the child float a little bit
            const decay = -2 // this percentage should be left after 1 millisecond
            let lastFrameTime = window.performance.now() / 1000;

            const drift = () => {
                const thisFrameTime = window.performance.now() / 1000;
                const delta = thisFrameTime - lastFrameTime;
                lastFrameTime = thisFrameTime;

                momentum.x *= Math.exp(decay * delta)
                momentum.y *= Math.exp(decay * delta)

                const frameMomentum = {
                    x: momentum.x * delta,
                    y: momentum.y * delta
                }

                const frameMagnitude = Math.sqrt(frameMomentum.x * frameMomentum.x + frameMomentum.y * frameMomentum.y)

                if(frameMagnitude > (this.props.dragStartDistance ?? 1) ){
                    action(() => {
                        const dx = frameMomentum.x 
                        const dy = frameMomentum.y 
                        this.st.offsetX += dx
                        this.st.offsetY += dy

                        fixOffset();
                        if(this.props.onDrift) {
                            this.props.onDrift({momentum: frameMomentum, delta: {x:dx, y:dy}, offset: {x: this.st.offsetX, y:this.st.offsetY}})
                        }
                        //Logger.debug(`drift: ${this.st.offsetX.toFixed(0)} ${this.st.offsetY.toFixed(0)} -- ${dx.toFixed(2)} ${dy.toFixed(2)} -- delta: ${delta}`)

                    })()
                    if(!this.touching) requestAnimationFrame(drift)
                }
            }
            requestAnimationFrame(drift);
        }

        const style = {
            ...this.props.style,
            width: `${this.props.width}px`,
            height: `${this.props.height}px`
        }

        const childStyle = {
            transform: `translate(${this.st.offsetX}px, ${this.st.offsetY}px)`
        }

        return (
            <Touchable 
                onDragStart={onDragStart}
                onDrag={onDrag}
                onDragEnd={onDragEnd}
                surfaceId={this.props.sliderId}
                width={this.props.width}
                height={this.props.height}
                className={`${styles.sliderControl} ${this.props.className}`} 
                style={style}> 

                    <div className={styles.sliderChild} style={childStyle}>
                        {
                            this.props.children
                        }                
                    </div>
            </Touchable> 
        )   
    }
}