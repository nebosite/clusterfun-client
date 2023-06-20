

import { BaseGameModel, ISessionHelper, ITypeHelper, 
    SessionHelper, 
    instantiateGame, 
    getClientTypeHelper, GeneralGameState } from "../../libs";
import { UIProperties } from "libs/types/UIProperties";
import { observer, Provider } from "mobx-react";
import React from "react";
import Logger from "js-logger";
import { GameRole } from "libs/config/GameRole";
import { ClusterFunGameAndUIProps, ClusterFunGameProps } from "libs/config/ClusterFunGameProps";
import { getPresenterTypeHelper } from "libs/GameModel/ClusterfunPresenterModel";
import * as Comlink from "comlink";
import { IClusterfunHostLifecycleController } from "libs/worker/IClusterfunHostLifecycleController";


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
extends React.Component<ClusterFunGameAndUIProps>
{

    appModel?: BaseGameModel;
    UI: React.ComponentType<{ appModel?: any, uiProperties: UIProperties, hostController?: Comlink.Remote<IClusterfunHostLifecycleController> }> = DummyComponent
    derivedTypeHelper?: ITypeHelper;

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
            gameProperties.hostId,
            serverCall
            );

        Logger.info(`INIT ${this.props.playerName}`)

        if(gameProperties.role === GameRole.Presenter)
        {
            this.UI = presenterType;
            this.derivedTypeHelper = derivedPresenterTypeHelper(sessionHelper, this.props)
        } else if (gameProperties.role === GameRole.Client) {
            this.UI = clientType;
            this.derivedTypeHelper = derivedClientTypeHelper(sessionHelper, this.props);
        } else {
            throw new Error("Unhandled role " + gameProperties.role)
        }

        document.title = `${gameProperties.gameName} / ClusterFun.tv`
    }

    async componentDidMount(): Promise<void> {
        this.appModel = await instantiateGame(
            getPresenterTypeHelper(this.derivedTypeHelper!), 
            this.props.logger, 
            this.props.storage);
        this.appModel!.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => this.props.onGameEnded());
        this.appModel!.reconstitute();
        componentFinalizer.register(this, this.appModel!);
        this.forceUpdate();
    }

    componentWillUnmount(): void {
        this.appModel?.shutdown();
    }
    

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const UI = this.UI;
        if (!this.appModel) {
            return (<DummyComponent uiProperties={this.props.uiProperties}></DummyComponent>)
        } else {
            return (
                <Provider appModel={this.appModel}>
                    <React.Suspense fallback={<div>loading...</div>}>
                        <UI uiProperties={this.props.uiProperties} hostController={this.props.hostController || undefined}/>
                    </React.Suspense>
                </Provider>
            );            
        }
    };
}
