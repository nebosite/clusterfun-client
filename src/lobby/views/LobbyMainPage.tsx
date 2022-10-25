// App Navigation handled here
import React from "react";
import { observer, Provider } from "mobx-react";
import {  LobbyState, LobbyModel } from "../models/LobbyModel";
import { LobbyComponent } from "../Components/LobbyComponent";
import { GameDescriptor, getGameComponent } from "../../GameChooser";

export interface LobbyMainPageProps {
    games: GameDescriptor[],
    lobbyModel: LobbyModel, 
    size?: () => {width: number, height: number}
}

// -------------------------------------------------------------------
// MainPage
// -------------------------------------------------------------------
@observer
export class LobbyMainPage 
  extends React.Component<LobbyMainPageProps, {size: {width: number, height: number}}>{

    getSize: () => {width: number, height: number};

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: LobbyMainPageProps)
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
        const {lobbyModel, games} = this.props;
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
                    innerChild = <LobbyComponent uiProperties={uiProperties} games={this.props.games} />;
                    break;
                case LobbyState.ReadyToPlay:
                    const gameName = lobbyModel.gameProperties!.gameName
                    const descriptor = games.find(i => i.name === gameName)
                    if(!descriptor) throw Error(`Could not find game '${gameName}'`)
                    innerChild = getGameComponent(descriptor!, lobbyModel.getGameConfig(uiProperties))
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
