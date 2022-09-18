import React from "react";
import { observer } from "mobx-react";
import Slider, { SliderDriftEventParameters } from "libs/components/Slider";
import { makeObservable } from "mobx";

class QuickState {
    drift = makeObservable({momentum: {x:0, y: 0},
        delta: {x:0, y: 0},
        offset: {x:0, y: 0} });
    
}

// -------------------------------------------------------------------
// ClientComponent
// -------------------------------------------------------------------
@observer export default class QuickTestComponent extends React.Component {
    st = new QuickState();

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {

        const onDrift = (ev: SliderDriftEventParameters) => {
            this.st.drift = ev;
        }

        const toCoords = (raw: {x:number, y:number}) => {
            if(!raw) return "---"
            return `${raw.x.toFixed(2)},${raw.y.toFixed(2)}`
        }

        return (
            <div >
                <Slider
                    onDrift={onDrift}
                    style={{background: "grey"}} 
                    sliderId="Test" width={800} height={800} 
                    contentWidth={2000} contentHeight={1200}>
                    <div style={{fontSize: "40px", fontWeight: 700
                        ,width: "2000px", height:"1200px"
                        ,background: "linear-gradient(45deg, red, yellow, blue, orange)"}}>
                            <div>SRUFF</div>
                            <div>Delta: {toCoords(this.st.drift?.delta)}</div>
                            <div>Momentum: {toCoords(this.st.drift?.momentum)}</div>
                            <div>Offset: {toCoords(this.st.drift?.offset)}</div>
                        </div>
                </Slider>

            </div>
        )
    }        
}
