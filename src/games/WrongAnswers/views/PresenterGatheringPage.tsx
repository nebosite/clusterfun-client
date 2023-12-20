// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css"
import { WrongAnswersPresenterModel } from "../models/PresenterModel";
import { PresenterGameState } from "libs";


@inject("appModel") @observer
export class PresenterGatheringPage  extends React.Component<{appModel?: WrongAnswersPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        return (
            <div>
                <h3>Welcome to {appModel.name}</h3>
                <p>... a game where it is right to be wrong!</p>
                <p>To Join: go to http://{ window.location.host} and enter this room code: {appModel.roomId}</p>
                {
                    appModel.players.length > 0
                    ?   <div><p style={{fontWeight: 600}}>Joined team members:</p>
                            <div className={styles.divRow}>
                                {appModel.players.map(player => (<div className={styles.nameBox} key={player.playerId}>{player.name}</div>))}
                            </div>
                        </div>
                    : null 
                }
                
                {appModel.players.length < appModel.minPlayers
                    ? <div>{`Waiting for at least ${appModel.minPlayers} players to join ...`}</div>
                    : <button className={styles.presenterButton} onClick={() => appModel.gameState = PresenterGameState.Instructions}> Click here to start! </button>
                }               
            </div>
        );

    }
}
