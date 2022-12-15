import React from "react";
import { observer } from "mobx-react";
import { GameTestModel } from "../models/GameTestModel";
import { LobbyMainPage } from "../../lobby/views/LobbyMainPage";
import { LobbyModel } from "../../lobby/models/LobbyModel";
import styles from './GameTestComponent.module.css';
import { GameDescriptor } from "games/lists/GameDescriptor";
import { action, makeAutoObservable } from "mobx";

const HD_RATIO = 1080/1920;

// -------------------------------------------------------------------
// ClientComponent
// -------------------------------------------------------------------
@observer class ClientComponent extends React.Component<
    {gameTestModel: GameTestModel, clientModel: LobbyModel, games: GameDescriptor[], clientNumber: number, sizeAdjust: number}
    ,{childKey: string}> {

    keyId = 0;
    get newKey() { return `client_${this.props.clientNumber}_${this.keyId++}`}

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: any){
        super(props);
        this.state = {childKey: this.newKey};
    }

    // -------------------------------------------------------------------
    // getClientSize
    // -------------------------------------------------------------------
    getClientSize= (ratio: number) =>
    {
        const {gameTestModel} = this.props;
        const width = gameTestModel.presenterSize/4.5;
        return {width: width, height: width * ratio};    
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {gameTestModel, clientModel, games, clientNumber, sizeAdjust} = this.props;

        const width = gameTestModel.presenterSize/4.5;

        const handleRefresh = () => {
            this.setState({childKey: this.newKey})
        }

        return (
            <div className={styles.clientBox} key={this.state.childKey}>
                <div className={styles.divRow}>
                    <span>{`C${clientNumber}: ${clientModel.playerName}`} </span>
                    <button className={styles.utilityButton} onClick={handleRefresh}>Refresh</button>
                </div>
                <div className={styles.clientArea} style={{
                    width: width,
                    height: width * sizeAdjust}}>
                        <LobbyMainPage 
                            lobbyModel={clientModel} 
                            games={games}
                            size={() => { return this.getClientSize(sizeAdjust)}}/> 
                </div> 
            </div>)
    }        
}

export interface GameTestComponentProps {
    gameTestModel: GameTestModel
    games: GameDescriptor[]
}

// -------------------------------------------------------------------
// GameTestComponent
// -------------------------------------------------------------------
@observer
export class GameTestComponent extends React.Component<GameTestComponentProps> {

    myState: {presenterKey: string} 
    keyCounter = 0;

    constructor(props: GameTestComponentProps) {
        super(props);

        const state = {
            presenterKey: "testPresenterKey"
        }

        makeAutoObservable(state);
        this.myState = state;
    }

    private sizeChangeHandler = () => {
        this.updatePresenterSize(window.innerWidth);
        this.forceUpdate();
    };

    UNSAFE_componentWillMount() {
        window.addEventListener('resize', this.sizeChangeHandler);
    }

    UNSAFE_componentWillUnmount() {
        window.removeEventListener('resize', this.sizeChangeHandler);
    }

    // -------------------------------------------------------------------
    // updatePresenterSize
    // -------------------------------------------------------------------
    updatePresenterSize(newSize: number){
        this.props.gameTestModel.presenterSize = Math.max(100, newSize-3);
    }

    // -------------------------------------------------------------------
    // getPresenterSize
    // -------------------------------------------------------------------
    getPresenterSize= () =>
    {
        const {gameTestModel} = this.props;
        return {width: gameTestModel.presenterSize, height:gameTestModel.presenterSize * HD_RATIO };
    }


    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {gameTestModel, games} = this.props;
        if(gameTestModel.presenterSize === 0) this.updatePresenterSize(window.innerWidth);

        const handlePresenterRefresh = () => {
            action(this.myState.presenterKey = "testPresenterKey" + this.keyCounter++)
        }

        return (
            <div>
                <div className={styles.rTable} style={{border: "2px black", backgroundColor: "#eee"}}>
                    <div className={styles.rTableBody}>
                        <div className={styles.rTableRow}>
                            { gameTestModel.clientModels.map((m, index) =>  
                                <div className={styles.rTableCell} key={m.id} id={`LobbyContainer_${m.id}`}> 
                                    <ClientComponent 
                                        gameTestModel={gameTestModel} 
                                        clientModel={m}
                                        games={games}
                                        clientNumber={index}
                                        sizeAdjust={2.2 - index *.25} />
                                </div> )}
                        </div>
                    </div>
                </div>
                <div style={{paddingTop: "10px", paddingBottom: "5px", fontSize: "10px"}}>
                    PRESENTER:  Size (width) = {gameTestModel.presenterSize} 

                    <button 
                        className={styles.utilityButton}
                        style={{marginLeft:"20px"}} 
                        onClick={()=> { sessionStorage.clear(); window.location.reload()}}>
                            Clear ALL Memory
                    </button>
                    <button 
                        className={styles.utilityButton}
                        style={{marginLeft:"20px"}} 
                        onClick={handlePresenterRefresh}>
                            Refresh
                    </button>
                </div>

                <div 
                    key={this.myState.presenterKey}
                    style={{
                        background: "lightgray", 
                        height: `${gameTestModel.presenterSize * 1080 / 1920}px`, 
                        width: `${gameTestModel.presenterSize}px`}}>
                    <LobbyMainPage 
                        lobbyModel={gameTestModel.presenterModel} 
                        games={games}
                        size={() => {return this.getPresenterSize()}} /> 
                </div>
            </div>
        );
    }
}
