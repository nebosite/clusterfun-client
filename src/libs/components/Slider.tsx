import { Vector2 } from "../../libs";
import { action, observable } from "mobx";
import { observer } from "mobx-react";
import React from "react"
import styles from './Slider.module.css';
import  { Touchable, TouchableDragStartEvent, TouchableDragEvent, TouchableDragEndEvent } from "./Touchable";


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
}


@observer
export class Slider extends React.Component<SliderProps>
{
    st = new SliderState();
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
            //console.log(`move: ${this.st.offsetX.toFixed(0)} ${this.st.offsetY.toFixed(0)}`)

        }

        const onDragEnd = (ev: TouchableDragEndEvent) => {
            this.touching = false;
            const animationRate_fps = 30;
            if(this.props.onDragEnd) {
                this.props.onDragEnd();
            }
           
            const momentum = {
                x: ev.momentum.x / animationRate_fps, 
                y: ev.momentum.y / animationRate_fps}

            //console.log(`Momentum: ${momentum.x} ${momentum.y}`)

            // Now let the child float a little bit
            const decay = 0.90
            const drift = () => {
                if(this.props.onDrift) {
                    this.props.onDrift({momentum, delta: {x:0, y:0}, offset: {x: this.st.offsetX, y:this.st.offsetY}})
                }

                momentum.x *= decay
                momentum.y *= decay
                const magnitude = (Math.abs(momentum.x) + Math.abs(momentum.y))

                if(magnitude > (this.props.dragStartDistance ?? 15) ){
                    action(() => {
                        const dx = momentum.x 
                        const dy = momentum.y 
                        this.st.offsetX += dx
                        this.st.offsetY += dy

                        fixOffset();
                        if(this.props.onDrift) {
                            this.props.onDrift({momentum, delta: {x:dx, y:dy}, offset: {x: this.st.offsetX, y:this.st.offsetY}})
                        }
                        //console.log(`drift: ${this.st.offsetX.toFixed(0)} ${this.st.offsetY.toFixed(0)} -- ${dx.toFixed(2)} ${dy.toFixed(2)}`)

                    })()
                    if(!this.touching)  setTimeout(drift, 1000 / animationRate_fps)
                }
            }
            drift();

        }

        const style = {
            ...this.props.style,
            width: `${this.props.width}px`,
            height: `${this.props.height}px`
        }

        const childStyle = {
            left: `${this.st.offsetX}px`,
            top: `${this.st.offsetY}px`,
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