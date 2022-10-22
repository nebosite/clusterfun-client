// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LobbyMode, LobbyModel } from "../models/LobbyModel";
import classNames from "classnames";
import { GLOBALS } from '../../Globals';
import { LobbyAssets } from "../../lobby/assets/LobbyAssets";
import styles from './LobbyComponent.module.css';
import { UIProperties, GameDescriptor, getGames, UINormalizer } from "../../libs";
import TestatoAssets from "testLobby/TestGame/assets/Assets";

@inject("lobbyModel")
@observer
class PresenterComponent
    extends React.Component<{ lobbyModel?: LobbyModel, games: GameDescriptor[] }> {

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    render() {
        const { lobbyModel, games } = this.props;

        if(!lobbyModel) return <div>Loading client...</div>

        const startGameClick = (gameName: string) => {
            //console.log("Attempting to start " + gameName);
            this.props.lobbyModel?.startGame(gameName);
        }

        return (
            <div className={styles.gmMenu}>
            <div className={styles.gmContainer}> <img src={LobbyAssets.images.logos.clusterFun} alt="" /> </div>
            <h3 className={styles.gmTitle}>PICK A GAME!</h3>
            <ul className={styles.btnMenu}>
                {games?.map(game =>
                    <li key={game.name}>
                        <div className={styles.btnContainer}>
                            <img alt={`Start ${game.name}`}
                                src={game.logoName}
                                className={styles.gmButton}
                                onClick={() => startGameClick(game.name)} />
                            <div className={styles.gameLogoLabel}>{game.name}</div>
                            {game.tags.indexOf("beta") > -1 
                                ? <div>(beta)</div>
                                : null}
                            {game.tags.indexOf("alpha") > -1 
                                ? <div>(alpha)</div>
                                : null}
                            {game.tags.indexOf("debug") > -1 
                                ? <div>(debug)</div>
                                : null}
                        </div>
                    </li>)}
            </ul>
            <button className={styles.joinGameButton} onClick={()=>lobbyModel.userChosenMode = LobbyMode.Client} >I have a room code</button>
            <div className={styles.version}>v{GLOBALS.Version}</div>

        </div>

        )
    }
}

@inject("lobbyModel")
@observer
class GameClientComponent
    extends React.Component<{ lobbyModel?: LobbyModel}> {

    //--------------------------------------------------------------------------------------
    // 
    //--------------------------------------------------------------------------------------
    render() {
        const { lobbyModel } = this.props;

        if(!lobbyModel) return <div>Loading lobby...</div>

        const handleJoinGameClick = () => {
            //console.log("Attempting to join room " + this.props.lobbyModel.roomId);
            this.props.lobbyModel?.joinGame();
        }

        return (
            <div className={classNames(styles.lobby)}>
                {lobbyModel.lobbyErrorMessage ? <div className={classNames(styles.errorMessage)}>{lobbyModel.lobbyErrorMessage} </div> : null}
                <div className={classNames(styles.divRow)}>
                    <div className={styles.lobby}>
                        <div className={styles.logo}>
                            <img src={LobbyAssets.images.logos.clusterFun} alt="logo" className={styles.img}></img>
                        </div>
                        <div className={styles.input_background}>
                            <input
                                placeholder="Room Code"
                                type="text"
                                value={lobbyModel.roomId}
                                className={classNames(styles.room_code, styles.userJointextinput)}
                                style={{
                                    textTransform: "uppercase"
                                }}
                                onChange={(ev) => lobbyModel.roomId = ev.target.value.toUpperCase()} />
                            <input
                                placeholder="Nickname"
                                type="text"
                                className={styles.nickname}
                                value={lobbyModel.playerName}

                                onChange={(ev) => lobbyModel.playerName = ev.target.value} />
                        </div>
                        <div className={styles.container}>
                            <button
                                disabled={!lobbyModel.canJoin}
                                className={styles.joinButton}
                                onClick={() => handleJoinGameClick()}
                            >&#10004;</button>
                        </div>
                        <div className={styles.container}>
                            <button className={styles.joinGameButton} onClick={()=>lobbyModel.userChosenMode = LobbyMode.Presenter} >I want to host a game</button>
                            <div className={styles.version}>v{GLOBALS.Version}</div>
                        </div>
                    </div>

                </div>
            </div>
        )
    }
}


// -------------------------------------------------------------------
// LobbyComponent
// -------------------------------------------------------------------
@inject("lobbyModel")
@observer
export class LobbyComponent
    extends React.Component<{ lobbyModel?: LobbyModel, uiProperties: UIProperties }> {
    private _urlParams: URLSearchParams = new URLSearchParams(window.location.search);
    private _games?: GameDescriptor[]

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: { lobbyModel?: LobbyModel, uiProperties: UIProperties })
    {
        super(props);
        const showParam = this._urlParams.get("show");
        const showTags = ["production", "beta"];
        if(showParam) showParam.split(',').forEach(p => showTags.push(p));
        this._games = getGames(showTags)
    } 

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const { lobbyModel, uiProperties } = this.props;
        if(!lobbyModel) return <div>NO LOBBY MODEL???</div>;
        
        const isPortrait = uiProperties.containerHeight > uiProperties.containerWidth;
        let displayMode = lobbyModel.userChosenMode;
        if(displayMode === LobbyMode.Unchosen){
            displayMode = isPortrait ? LobbyMode.Client : LobbyMode.Presenter;
            lobbyModel.userChosenMode = displayMode;
            if(displayMode === LobbyMode.Client && GLOBALS.IsMobile) {
                setTimeout(()=>{
                    document.body.style.transform = 'scale(1)';     // General
                    window.document.documentElement.requestFullscreen();
                },300)
            }
        }

        const games: GameDescriptor[] = [
            {
                name: "Testato1",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato2",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato3",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato4",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato5",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato6",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato7",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato8",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato9",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato10",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },
            {
                name: "Testato11",
                logoName: TestatoAssets.images.logo,
                tags: [],
            },

        ]

        return  displayMode === LobbyMode.Presenter
            ? ( <UINormalizer uiProperties={uiProperties} virtualWidth={1920} virtualHeight={1080}>
                    <PresenterComponent games={games}/>
                </UINormalizer> )
            : ( <UINormalizer uiProperties={uiProperties} virtualWidth={1080} virtualHeight={1920}>
                    <GameClientComponent />
                </UINormalizer> )
    };

}
