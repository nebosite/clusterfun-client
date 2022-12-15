

import { BaseGameModel, ISessionHelper, ITypeHelper, 
    SessionHelper, 
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

const componentFinalizer = new FinalizationRegistry((model: BaseGameModel) => {
    if (!model.isShutdown) {
        Logger.warn("Component was finalized before model was shut down");
        model.shutdown();
    }
})


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
        const {  gameProperties, messageThing, serverCall } = this.props;

        const sessionHelper = new SessionHelper(
            messageThing, 
            gameProperties.roomId, 
            gameProperties.presenterId,
            serverCall
            );

        Logger.info(`INIT ${this.props.playerName}`)

        if(gameProperties.role === "presenter")
        {
            this.UI = presenterType;
            this.appModel = instantiateGame(
                getPresenterTypeHelper(derivedPresenterTypeHelper(sessionHelper, this.props)), 
                this.props.logger, 
                this.props.storage)
        } else {
            this.UI = clientType;
            this.appModel = instantiateGame(
                getClientTypeHelper(derivedClientTypeHelper( sessionHelper, this.props)), 
                this.props.logger, 
                this.props.storage)
        }

        document.title = `${gameProperties.gameName} / ClusterFun.tv`
        componentFinalizer.register(this, this.appModel!);
    }

    componentDidMount(): void {
        this.appModel!.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => this.props.onGameEnded());
        this.appModel!.reconstitute();
    }

    componentWillUnmount(): void {
        this.appModel?.shutdown();
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
