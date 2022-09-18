import React from "react";

interface LabelBoxProps {
    text: string;
    onSubmit: (value:string) => void;
    labelClassName?: string;
    inputClassName?: string;

}

let boxId = 0;
// -------------------------------------------------------------------
// LabelBox - dead simple editable label
// -------------------------------------------------------------------
export default class LabelBox  extends React.Component<LabelBoxProps> {
    state: {isEditing: boolean, editText: string}

    _sawMouseDown = false;
    _id = "__labelBox_" + boxId++;


    // -------------------------------------------------------------------
    // constructor
    // -------------------------------------------------------------------
    constructor(props: LabelBoxProps) {
        super(props);
        this.state = {isEditing: false, editText: ""}
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {

        const doSubmit = () => {
            this.props.onSubmit(this.state.editText);
            this.setState({isEditing: false})  
        }
        return this.state.isEditing
            ? <input 
                id={this._id}
                className={this.props.inputClassName}
                onBlur={()=>doSubmit()}
                value={this.state.editText}
                onKeyDown={e => {
                    if(e.keyCode === 13) { doSubmit() }
                }}
                onFocus={event => event.target.select()}
                onChange={(event)=>this.setState({editText: event.target.value})}
            />
            : <div 
                className={this.props.labelClassName}
                onMouseDown={() => this._sawMouseDown = true}
                onMouseUp={() => { 
                    this.setState({isEditing: this._sawMouseDown, editText: this.props.text})
                    setTimeout(() => {document.getElementById(this._id).focus()} , 30)
                }}
            >
                {this.props.text}
            </div>                 
    }
}
