import Logger from "js-logger";
import { ISessionHelper, ClusterFunGameProps, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper, HostGameEvent } from "libs";
import { observable } from "mobx";
import { TestatoOnboardPresenterEndpoint } from "./testatoEndpoints";
import { ClusterfunPresenterModel } from "libs/GameModel/ClusterfunPresenterModel";
import { TestatoGameState, TestatoPlayer } from "./TestatoPlayer";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getTestatoPresenterTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "TestatoPresenterModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case TestatoPresenterModel: return "TestatoPresenterModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "TestatoPresenterModel":
                    return new TestatoPresenterModel(
                        sessionHelper,
                        gameProps.logger,
                        gameProps.storage);
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            switch(propertyName)
            {
                case "votedAnswerIndices": 
                case "unvotedAnswerIndices": return observable<number>(rehydratedObject as number[]); 
            } 

            return rehydratedObject;
        }
     }
}

export enum TestatoClientState {
    Playing = "Playing",
    EndOfRound = "EndOfRound",
}

const colors = ["white", "red", "orange", "yellow", "blue", "cyan", "magenta", "gray"]

// -------------------------------------------------------------------
// Presenter data and logic
// -------------------------------------------------------------------
export class TestatoPresenterModel extends ClusterfunPresenterModel<TestatoPlayer>  {

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
        super("TestatoPresenter", sessionHelper, logger, storage);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
    }

    async requestGameStateFromHost(): Promise<void> {
        const response = await this.session.requestHost(TestatoOnboardPresenterEndpoint, {});
        this.roundNumber = response.roundNumber;
        this.gameState = response.state;

        const playerIdsToRemove = new Set(this.players.map(p => p.playerId));
        for (const incomingPlayer of response.players) {
            const currentPlayer = this.players.find(p => p.playerId === incomingPlayer.playerId);
            if (currentPlayer) {
                Object.assign(currentPlayer, incomingPlayer);
                playerIdsToRemove.add(currentPlayer.playerId);
            } else {
                const newPlayer = new TestatoPlayer();
                Object.assign(newPlayer, incomingPlayer);
            }
        }
        for (let i = 0; i < this.players.length;) {
            if (playerIdsToRemove.has(this.players[i].playerId)) {
                this.players.splice(i, 1);
            } else {
                i++;
            }
        }
    }
    
    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    assignClientStateFromServerState(serverState: string) {
        // When the server sends and state update message, ensure the client puts itself in the right state.
        // This is neeeded because sometimes the client can miss messages from the server
        switch(serverState) {
            case TestatoGameState.Playing: this.gameState = TestatoGameState.Playing; break; 
            default:
                Logger.debug(`Server Updated State to: ${serverState}`) 
                this.gameState = GeneralClientGameState.WaitingToStart; break;
        }

    }
}
