
import { ClusterFunSerializer } from "libs/comms"
import { ClusterFunGameProps, UIProperties, ISessionHelper, SessionHelper } from "libs";
import { BaseGameModel, GeneralGameState, instantiateGame } from "libs/models/BaseGameModel";
import { getClientTypeHelper } from "libs/models/ClusterfunClientModel";
import { getPresenterTypeHelper } from "libs/models/ClusterfunPresenterModel";
import { ITypeHelper } from "libs/storage/BruteForceSerializer";
import { Provider } from "mobx-react";
import React from "react";

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class ClusterfunGameComponent 
extends React.Component<ClusterFunGameProps>
{

    appModel: BaseGameModel;
    UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>;

    init(
        importPresenter: ()=> React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        importClient: ()=> React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        derivedPresenterTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper,
        derivedClientTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper
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

        if(gameProperties.role === "presenter")
        {
            this.UI = importPresenter();
            this.appModel = instantiateGame(
                `${gameProperties.gameName}PresenterModel`, 
                this.props, 
                getPresenterTypeHelper( derivedPresenterTypeHelper(sessionHelper, this.props)))
        } else {
            this.UI = importClient();
            this.appModel = instantiateGame(
                `${gameProperties.gameName}ClientModel`, 
                this.props, 
                getClientTypeHelper(derivedClientTypeHelper( sessionHelper, this.props)))
        }
    
        this.appModel.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => onGameEnded());

        document.title = `${gameProperties.gameName} / ClusterFun.tv`
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
