// App Navigation handled here
import React from "react";
import { UIProperties } from "../types/UIProperties";

interface UINormalizerProps {
    className?: string;
    style?: { [k: string]: any };
    uiProperties: UIProperties;
    virtualWidth: number;
    virtualHeight: number;
    children: any; // TODO: what is the actual type here
    id?: string;
    onScaleCalc?: (scale:number)=> void;
}

// -------------------------------------------------------------------
// UINormalizer - This allows us to have a constant virtual resolution
// for simplifying layouts.
// -------------------------------------------------------------------
export class UINormalizer 
extends React.Component<UINormalizerProps> {

    translateX: number = 0;
    translateY: number = 0;
    yOvershoot: number = 0;
    scale: number = 1;
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props:UINormalizerProps) {
        super(props);
        this.reScale();
    }

    // -------------------------------------------------------------------
    // componentDidUpdate
    // -------------------------------------------------------------------
    componentDidUpdate() {
        this.reScale();
        if(this.props.onScaleCalc) this.props.onScaleCalc(this.scale);
    }
    
    // -------------------------------------------------------------------
    // reScale
    // -------------------------------------------------------------------
    reScale() {
        // Calucalte scaling and translation to fit contents into this window
        const { containerWidth, containerHeight } = this.props.uiProperties;
        const { virtualWidth, virtualHeight } = this.props;

        const constrainBoth = true;
        const widthScale = containerWidth / virtualWidth;
        const heightScale = containerHeight / virtualHeight;
        this.scale = widthScale; 
        if(constrainBoth) this.scale = Math.min(widthScale, heightScale);
        this.translateX = (containerWidth - virtualWidth) / 2;
        this.translateY = (containerHeight - virtualHeight) / 2;

        const newHeight = virtualHeight * this.scale;
        this.yOvershoot = (containerHeight - newHeight)/2;
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const { containerWidth, containerHeight } = this.props.uiProperties;
        const { virtualWidth, virtualHeight, style, className } = this.props;

        return (
            <div 
                id={this.props.id} 
                className={className} 
                style={{ 
                    width: `${containerWidth}px`, 
                    height: `${containerHeight}px`,
                    overflow: "hidden",
                    ...(style || {})
                }} >
                    <div style={{transform: `translateY(${-this.yOvershoot}px)`}}>
                        <div style={
                            { 
                                width: `${virtualWidth}px`, 
                                height: `${virtualHeight}px`, 
                                transform: `translateX(${this.translateX}px) translateY(${this.translateY}px) scale(${this.scale})`
                            }
                        }>
                            {this.props.children}
                        </div>                        
                    </div>

            </div>
        )
    };
}
