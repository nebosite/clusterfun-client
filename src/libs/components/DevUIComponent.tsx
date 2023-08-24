import { observer } from "mobx-react";
import React, { CSSProperties } from "react";
import { DevOnly } from "./DevOnly";

export interface DevUIOptions {
    context?: {devFast: boolean, devPause: boolean}
    style?: CSSProperties
    children?: React.ReactNode;
}
@observer
export class DevUI 
    extends React.Component<DevUIOptions> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {context} = this.props;
        if(!context) return null;
        return <DevOnly style={{paddingLeft: "150x", background: "black", ...this.props.style}}>
                    <button 
                        style={{marginRight: "20px", padding: "5px", marginLeft: "20px", background: (context.devFast ? "yellow" : "darkGray")}}
                        onClick={()=>context.devFast = !context.devFast}>
                            Go FAST
                    </button>    
                    <button 
                        style={{marginRight: "20px", padding: "5px", background: (context.devPause ?"yellow": "darkGray" )}}
                        onClick={()=>context.devPause = !context.devPause}>
                            DEV Pause
                    </button>                       
                    {this.props.children}
            </DevOnly>
    }
}
