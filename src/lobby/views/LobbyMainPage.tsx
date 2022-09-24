// App Navigation handled here
import React from "react";
import { observer, Provider } from "mobx-react";
import {  LobbyState, LobbyModel } from "../models/LobbyModel";
import LobbyComponent from "../Components/LobbyComponent";
import { getGameComponent } from "../../libs";

// -------------------------------------------------------------------
// MainPage
// -------------------------------------------------------------------
@observer
export default class LobbyMainPage 
  extends React.Component<{
      lobbyModel: LobbyModel, 
      size?: () => {width: number, height: number}}, 
      {size: {width: number, height: number}}>{

    getSize: () => {width: number, height: number};

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: Readonly<{ lobbyModel: LobbyModel; size: () => {width: number, height: number};}>)
    {
        super(props);
        if(!props.size) {
            this.getSize = () => { return {width: window.innerWidth - 3, height: window.innerHeight - 3}};
        }
        else {
            this.getSize = props.size;
        }
        this.state = {size: this.getSize()};
        props.lobbyModel.onUserChoseAMode.subscribe("resize on mode change", () => this.sizeChangeHandler())
    }

    // -------------------------------------------------------------------
    // hook up size change event
    // -------------------------------------------------------------------
    componentDidMount() { window.addEventListener('resize', this.sizeChangeHandler); }
    componentWillUnmount() { window.removeEventListener('resize', this.sizeChangeHandler); }
    private sizeChangeHandler = () => { 
        if(this.getSize) { 
            const size = this.getSize(); 
            setTimeout(()=>{
                this.setState({size}); 
                this.forceUpdate(); 
            },0)
    }} 

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {lobbyModel} = this.props;
        let innerChild: any;
        const uiProperties = {
            containerWidth: this.state.size.width,
            containerHeight: this.state.size.height,
            containerId: `LobbyContainer_${lobbyModel.id}`
        }

        try {
            switch(lobbyModel.lobbyState)
            {
                case LobbyState.Fresh:
                    innerChild = <LobbyComponent uiProperties={uiProperties}/>;
                    break;
                case LobbyState.ReadyToPlay:
                    innerChild = getGameComponent(lobbyModel.gameProperties!.gameName, lobbyModel.getGameConfig(uiProperties))
                    break;
            }
        }
        catch (err) {
            console.log("LobbyMainPage error: " + (err as any).message)
            innerChild = (<React.Fragment><div style={{background: "white", fontSize: "30px"}}>There was an error: {(err as any).message}</div></React.Fragment>)
        }

        return (
            <Provider lobbyModel={lobbyModel}>
                <div className={`lobby`} key={lobbyModel.id}>
                    {innerChild}
                </div>                  
            </Provider>
        )
    };
}
