

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

interface ClusterFunComponentState {
    appModel?: BaseGameModel;
    UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>
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
extends React.Component<ClusterFunGameProps, ClusterFunComponentState>
{
    constructor(props: ClusterFunGameProps) {
        super(props);
        this.state = {
            UI: DummyComponent
        };
    }

    init(
        presenterType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        clientType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        derivedPresenterTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper,
        derivedClientTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper
    )
    {
        const {  gameProperties, messageThing,  onGameEnded, serverCall } = this.props;

        let appModel: BaseGameModel;
        let UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>;

        const sessionHelper = new SessionHelper(
            messageThing, 
            gameProperties.roomId, 
            gameProperties.presenterId, 
            new ClusterFunSerializer(),
            serverCall
            );

        Logger.info(`INIT ${this.props.playerName} AS ${gameProperties.role}`)

        // NOTE: The current flow for game instantiation (create a new model from the
        // type helper, then attempt to load an old model if it exists) causes multiple
        // copies of the model to be created. This means that all of the constructor logic
        // runs for each of these copies, _including event subscriptions_, and thus multiple
        // copies of the model are running at once, including copies that are connecting
        // differently to different parts of the ecosystem (e.g. one copy cannot produce
        // word suggestions)
        if(gameProperties.role === "presenter")
        {
            UI = presenterType
            appModel = instantiateGame(
                    getPresenterTypeHelper( derivedPresenterTypeHelper(sessionHelper, this.props)), this.props)
        } else {
            UI = clientType
            appModel = instantiateGame(
                    getClientTypeHelper(derivedClientTypeHelper( sessionHelper, this.props)), this.props)
        }
        modelShutdownRegistry.register(this, appModel);
    
        appModel.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => onGameEnded());
        document.title = `${gameProperties.gameName} / ClusterFun.tv`
        this.appModel!.tryLoadOldGame(this.props);
        componentFinalizer.register(this, this.appModel!);
    }

    componentWillUnmount(): void {
        this.appModel?.shutdown();
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        if (!this.state.appModel) {
            return <div>NO APP MODEL</div>
        }
        const UI = this.state.UI;
        return (
            <Provider appModel={this.state.appModel}>
                <React.Suspense fallback={<div>loading...</div>}>
                    <UI uiProperties={this.props.uiProperties}/>            
                </React.Suspense>
            </Provider>
        );
    };
}
