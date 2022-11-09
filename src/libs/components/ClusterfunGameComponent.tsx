

import { BaseGameModel, ISessionHelper, ITypeHelper, 
    SessionHelper, ClusterFunSerializer, 
    instantiateGame, getPresenterTypeHelper, 
    getClientTypeHelper, GeneralGameState, 
    GameInstanceProperties, IMessageThing, 
    IStorage, ITelemetryLogger } from "../../libs";
import { UIProperties } from "libs/types/UIProperties";
import { observer, Provider } from "mobx-react";
import React from "react";
import Logger from "js-logger";

// -------------------------------------------------------------------
// ClusterFunGameProps
// -------------------------------------------------------------------
export interface ClusterFunGameProps {
    playerName?: string;
    gameProperties: GameInstanceProperties;
    uiProperties: UIProperties;
    messageThing: IMessageThing;
    logger: ITelemetryLogger;
    storage: IStorage;
    onGameEnded: () => void;
    serverCall: <T>(url: string, payload: any) => Promise<T>
}

class DummyComponent extends React.Component<{ appModel?: any, uiProperties: UIProperties }>
{
    render() { return <div>DUMDUMDUM</div>}
}


// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
@observer
export class ClusterfunGameComponent 
extends React.Component<ClusterFunGameProps>
{

    appModel?: BaseGameModel;
    UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }> = DummyComponent

    init(
        presenterType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        clientType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
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

        Logger.info(`INIT ${this.props.playerName}`)

        // NOTE: The current flow for game instantiation (create a new model from the
        // type helper, then attempt to load an old model if it exists) causes multiple
        // copies of the model to be created. This means that all of the constructor logic
        // runs for each of these copies, _including event subscriptions_, and thus multiple
        // copies of the model are running at once, including copies that are connecting
        // differently to different parts of the ecosystem (e.g. one copy cannot produce
        // word suggestions)
        if(gameProperties.role === "presenter")
        {
            this.UI = presenterType;
            this.appModel = instantiateGame(
                getPresenterTypeHelper( derivedPresenterTypeHelper(sessionHelper, this.props)), this.props)
        } else {
            this.UI = clientType;
            this.appModel = instantiateGame(
                getClientTypeHelper(derivedClientTypeHelper( sessionHelper, this.props)), this.props)
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
