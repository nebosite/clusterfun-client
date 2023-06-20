import { observable } from "mobx"
import { PLAYTIME_MS } from "./GameSettings";
import { ClusterFunPlayer, ISessionHelper, ClusterFunGameProps, ClusterfunHostModel, ITelemetryLogger, IStorage, ITypeHelper, HostGameState, GeneralGameState, Vector2, HostGameEvent, GeneralClientGameState } from "libs";
import Logger from "js-logger";
import { TestatoColorChangeActionEndpoint, TestatoMessageActionEndpoint, TestatoOnboardClientEndpoint, TestatoOnboardPresenterEndpoint, TestatoTapActionEndpoint } from "./testatoEndpoints";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";
import { TestatoGameState, TestatoPlayer, TestatoPlayerStatus } from "./TestatoPlayer";

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getTestatoHostTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "TestatoHostModel",
        getTypeName(o) {
            switch (o.constructor) {
                case TestatoHostModel: return "TestatoHostModel";
                case TestatoPlayer: return "TestatoPlayer";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "TestatoHostModel": return new TestatoHostModel( sessionHelper, gameProps.logger, gameProps.storage);
                case "TestatoPlayer": return new TestatoPlayer();
                // TODO: add your custom type handlers here
            }
            return null;
        },
        shouldStringify(typeName: string, propertyName: string, object: any):boolean
        {
            if(object instanceof TestatoHostModel)
            {
                const doNotSerializeMe = 
                [
                    "Name_of_host_property_to_not_serialize",
                    // TODO:  put names of properties here that should not be part
                    //        of the saved game state  
                ]
                
                if(doNotSerializeMe.indexOf(propertyName) !== -1) return false
            }
            return true;
        },
        reconstitute(typeName: string, propertyName: string, rehydratedObject: any)
        {
            if(typeName === "TestatoHostModel")
            {
                // TODO: if there are any properties that need special treatment on 
                // deserialization, you can override it here.  e.g.:
                // switch(propertyName) {
                //     case "myOservableCollection": 
                //         return observable<ItemType>(rehydratedObject as ItemType[]); 
                // }
            }
            return rehydratedObject;
        }
     }
}

// At minimum, update the presenter every 2 seconds
// NOTE: This is the worst possible update path -
// come up with more streamlined update paths as available.
const MAX_PRESENTER_INVALIDATE_INTERVAL = 2 * 1000;


// -------------------------------------------------------------------
// host data and logic
// -------------------------------------------------------------------
export class TestatoHostModel extends ClusterfunHostModel<TestatoPlayer> {

    private _timeOfLastPresenterInvalidate: number;

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(
        sessionHelper: ISessionHelper, 
        logger: ITelemetryLogger, 
        storage: IStorage)
    {
        super("Testato", sessionHelper, logger, storage);
        Logger.info(`Constructing TestatoHostModel ${this.gameState}`)

        this.allowedJoinStates = [HostGameState.Gathering, TestatoGameState.Playing]

        this.minPlayers = 2;

        this._timeOfLastPresenterInvalidate = this.gameTime_ms;
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
        this.listenToEndpoint(TestatoOnboardClientEndpoint, this.handleOnboardClient);
        this.listenToEndpoint(TestatoOnboardPresenterEndpoint, this.handleOnboardPresenter);
        this.listenToEndpoint(TestatoColorChangeActionEndpoint, this.handleColorChangeAction);
        this.listenToEndpoint(TestatoMessageActionEndpoint, this.handleMessageAction);
        this.listenToEndpoint(TestatoTapActionEndpoint, this.handleTapAction);
        this.subscribe(HostGameEvent.PlayerJoined, "host-player-join", () => {
            this.invalidatePresenters();
        })
        this.subscribe(GeneralClientGameState.Paused, "game paused", () => {
            this.invalidatePresenters();
        })
    }


    // -------------------------------------------------------------------
    //  createFreshPlayerEntry
    // -------------------------------------------------------------------
    createFreshPlayerEntry(name: string, id: string): TestatoPlayer
    {
        const newPlayer = new TestatoPlayer();
        newPlayer.playerId = id;
        newPlayer.name = name;

        return newPlayer;
    }

    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    prepareFreshRound = () => {
    }

    // -------------------------------------------------------------------
    //  prepareFreshGame
    // -------------------------------------------------------------------
    prepareFreshGame = () => {
        this.gameState = HostGameState.Gathering;
        this.currentRound = 0;
    }

    // -------------------------------------------------------------------
    //  run a method to check for a state transition
    // -------------------------------------------------------------------
    handleTick()
    {
        if (this.isStageOver) {
            switch(this.gameState) {
                case TestatoGameState.Playing: 
                    this.finishPlayingRound(); 
                    this.saveCheckpoint();
                    break;
            }
        }
        // TODO: This interval technique, in addition to not being the most efficient,
        // does _not_ tick down while pausing!
        if ((this.gameTime_ms - this._timeOfLastPresenterInvalidate) > MAX_PRESENTER_INVALIDATE_INTERVAL) {
            this.invalidatePresenters();
        }
    }

    // -------------------------------------------------------------------
    //  invalidatePresenters
    // -------------------------------------------------------------------
    private invalidatePresenters() {
        this.requestAllPresentersAndForget(InvalidateStateEndpoint, {})
        this._timeOfLastPresenterInvalidate = this.gameTime_ms;
    }
    
    // -------------------------------------------------------------------
    //  finishPlayingRound
    // -------------------------------------------------------------------
    finishPlayingRound() {
        this.gameState = TestatoGameState.EndOfRound;
        this.requestAllClientsAndForget(InvalidateStateEndpoint, (p,ie) => ({}))
    }

    // -------------------------------------------------------------------
    //  startNextRound
    // -------------------------------------------------------------------
    startNextRound = () =>
    {
        this.gameState = TestatoGameState.Playing;
        this.timeOfStageEnd = this.gameTime_ms + PLAYTIME_MS;
        this.currentRound++;

        this.players.forEach((p,i) => {
            p.status = TestatoPlayerStatus.WaitingForStart;
            p.message = "";
            p.colorStyle = "white";
            p.x = .1;
            p.y = i * .1 + .1;
        })

        if(this.currentRound > this.totalRounds) {
            this.gameState = GeneralGameState.GameOver;
            this.requestAllClients(GameOverEndpoint, (p,ie) => ({}))
            this.requestAllPresenters(GameOverEndpoint, {})
            this.saveCheckpoint();
        }    
        else {
            this.gameState = TestatoGameState.Playing;
            this.requestAllClientsAndForget(InvalidateStateEndpoint, (p,ie) => ({}))
            this.invalidatePresenters();
            this.saveCheckpoint();
        }

    }

    handleOnboardClient = (sender: string, message: unknown): { roundNumber: number, customText: string, state: string } => {
        this.telemetryLogger.logEvent("Host", "Onboard Client")
        return {
            roundNumber: this.currentRound,
            customText: "Hi There",
            state: this.gameState
        }
    }

    handleOnboardPresenter = (sender: string, message: unknown): { roundNumber: number, state: string, players: TestatoPlayer[] } => {
        this.telemetryLogger.logEvent("Host", "Onboard Presenter")
        return {
            roundNumber: this.currentRound,
            state: this.gameState,
            players: this.players.map(p => structuredClone(p))
        }
    }

    handleColorChangeAction = (sender: string, message: { colorStyle: string }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Host", "AnswerMessage", "Deny");
            return;
        }
        player.colorStyle = message.colorStyle;
        this.saveCheckpoint();
        this.invalidatePresenters();
    }

    handleMessageAction = (sender: string, message: { message: string }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Host", "AnswerMessage", "Deny");
            return;
        }
        player.message = message.message;
        this.saveCheckpoint();
        this.invalidatePresenters();
    }

    handleTapAction = (sender: string, message: { point: Vector2 }) => {
        const player = this.players.find(p => p.playerId === sender);
        if(!player) {
            Logger.warn("No player found for message: " + JSON.stringify(message));
            this.telemetryLogger.logEvent("Host", "AnswerMessage", "Deny");
            return;
        }
        player.x = message.point.x;
        player.y = message.point.y;
        this.saveCheckpoint();
        this.invalidatePresenters();
    }

}
