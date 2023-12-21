

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
import { action, makeObservable, observable } from "mobx";

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
    model.shutdown();
})

class GameComponentState {
    @observable  private _ready = false;
    get ready() {return this._ready}
    set ready(value) {action(()=>{this._ready = value})()}
    
    constructor() {
        makeObservable(this);
    }
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
    myState = new GameComponentState();

    _initPromise?: Promise<void> ;

    constructor(props: ClusterFunGameProps) {
        super(props);
        this.state = {
            UI: DummyComponent
        }
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    init(
        presenterType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        clientType: React.ComponentType<{ appModel?: any, uiProperties: UIProperties }>,
        derivedPresenterTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper,
        derivedClientTypeHelper: ( sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper
    )
    {
        const {  gameProperties, messageThing, serverCall } = this.props;

        this._initPromise = new Promise<void>(resolve => {
            // Delay the init logic here because React will create and destroy components
            // as it is fiddling around. 
            setTimeout(()=> {
                Logger.info(`INIT ${this.props.playerName}`)

                const sessionHelper = new SessionHelper(
                    messageThing, 
                    gameProperties.roomId, 
                    gameProperties.presenterId,
                    serverCall
                    );

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
                this.myState.ready = true;
                resolve();                   
            },200)
    
        })


    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    async componentDidMount() {
        await this._initPromise;
        this.appModel!.subscribe(GeneralGameState.Destroyed, "GameOverCleanup", () => this.props.onGameEnded());
        this.appModel!.reconstitute();
    }

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    componentWillUnmount(): void {
        this.appModel?.shutdown();
    }
    

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        if(!this.myState.ready) {
            return <div>Loading...</div>
        }

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
