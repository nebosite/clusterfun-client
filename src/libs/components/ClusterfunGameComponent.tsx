

import { BaseGameModel, ISessionHelper, ITypeHelper, SessionHelper, ClusterFunSerializer, 
    instantiateGame, getPresenterTypeHelper, getClientTypeHelper, GeneralGameState } from "../../libs";
import { UIProperties } from "libs/types/UIProperties";
import { observer, Provider } from "mobx-react";
import React from "react";
import * as GameChooser from "./GameChooser";

class DummyComponent extends React.Component<{ appModel?: any, uiProperties: UIProperties }>
{
    render() { return <div>DUMDUMDUM</div>}
}


// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
@observer
export class ClusterfunGameComponent 
extends React.Component<GameChooser.ClusterFunGameProps>
{

    appModel?: BaseGameModel;
    UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }> = DummyComponent

    init(
        presenterType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        clientType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        derivedPresenterTypeHelper: ( sessionHelper: ISessionHelper, gameProps: GameChooser.ClusterFunGameProps) => ITypeHelper,
        derivedClientTypeHelper: ( sessionHelper: ISessionHelper, gameProps: GameChooser.ClusterFunGameProps) => ITypeHelper
    )
    {
        const {  gameProperties, messageThing,  onGameEnded, serverCall } = this.props;

        const sessionHelper = new SessionHelper(
            messageThing, 
            gameProperties.roomId, 
            gameProperties.presenterId, 
            new ClusterFunSerializer(),
            serverCall
            );

        console.log(`INIT ${this.props.playerName}`)

        if(gameProperties.role === "presenter")
        {
            this.UI = presenterType;
            this.appModel = instantiateGame(
                getPresenterTypeHelper( derivedPresenterTypeHelper(sessionHelper, this.props)))
        } else {
            this.UI = clientType;
            this.appModel = instantiateGame(
                getClientTypeHelper(derivedClientTypeHelper( sessionHelper, this.props)))
        }
    
        this.appModel.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => onGameEnded());

        document.title = `${gameProperties.gameName} / ClusterFun.tv`

        // Do this async so that we don't trip state dependencies during construction
        setTimeout(()=>{
            this.appModel!.tryLoadOldGame(this.props);
        },50)
    }
    

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const UI = this.UI;
        return (
            <Provider appModel={this.appModel}>
                <React.Suspense fallback={<div>loading...</div>}>
                    <UI uiProperties={this.props.uiProperties}/>            
                </React.Suspense>
            </Provider>
        );
    };
}
