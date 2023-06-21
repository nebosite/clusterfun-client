import Logger from "js-logger";
import { ISessionHelper, ClusterFunGameProps, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper } from "libs";
import { observable } from "mobx";
import { TestatoOnboardPresenterEndpoint, TestatoPushPresenterUpdateEndpoint } from "./testatoEndpoints";
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
        this.listenToEndpointFromHost(TestatoPushPresenterUpdateEndpoint, (payload) => this.processGameStateUpdate(payload));
    }

    async requestGameStateFromHost(): Promise<void> {
        const response = await this.session.requestHost(TestatoOnboardPresenterEndpoint, {});
        this.processGameStateUpdate(response);
    }

    private processGameStateUpdate(payload: { roundNumber: number, state: string, players: TestatoPlayer[] }) {
        this.roundNumber = payload.roundNumber;
        this.gameState = payload.state;

        const playerIdsToRemove = new Set(this.players.map(p => p.playerId));
        for (const incomingPlayer of payload.players) {
            const currentPlayer = this.players.find(p => p.playerId === incomingPlayer.playerId);
            if (currentPlayer) {
                Object.assign(currentPlayer, incomingPlayer);
                playerIdsToRemove.delete(currentPlayer.playerId);
            } else {
                const newPlayer = new TestatoPlayer();
                Object.assign(newPlayer, incomingPlayer);
                this.players.push(newPlayer);
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
}
