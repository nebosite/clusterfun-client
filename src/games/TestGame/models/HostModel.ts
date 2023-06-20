import { PLAYTIME_MS } from "./GameSettings";
import { ISessionHelper, ClusterFunGameProps, ClusterfunHostModel, ITelemetryLogger, IStorage, ITypeHelper, HostGameState, GeneralGameState, Vector2, HostGameEvent, GeneralClientGameState } from "libs";
import Logger from "js-logger";
import { TestatoColorChangeActionEndpoint, TestatoMessageActionEndpoint, TestatoOnboardClientEndpoint, TestatoOnboardPresenterEndpoint, TestatoPushPresenterUpdateEndpoint, TestatoTapActionEndpoint } from "./testatoEndpoints";
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

// -------------------------------------------------------------------
// host data and logic
// -------------------------------------------------------------------
export class TestatoHostModel extends ClusterfunHostModel<TestatoPlayer> {

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
            this.updatePresenters();
        })
        this.subscribe(GeneralClientGameState.Paused, "game paused", () => {
            this.updatePresenters();
        })
        this.subscribe(TestatoGameState.Playing, "game started or resumed", () => {
            this.updatePresenters();
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
    }

    // -------------------------------------------------------------------
    //  updatePresenters
    // -------------------------------------------------------------------
    private updatePresenters() {
        // Update the presenters by pushing the whole display state.
        // Note that it is usually better to do gradual updates,
        // but this works fine for small amounts of data.
        this.requestAllPresentersAndForget(TestatoPushPresenterUpdateEndpoint, this.generatePresenterState())
    }

    // -------------------------------------------------------------------
    //  invalidatePresenters
    // -------------------------------------------------------------------
    private invalidatePresenters() {
        this.requestAllPresentersAndForget(InvalidateStateEndpoint, {})
    }

    // -------------------------------------------------------------------
    //  generatePresenterState
    // -------------------------------------------------------------------
    private generatePresenterState() {
        return {
            roundNumber: this.currentRound,
            state: this.gameState,
            players: this.players.map(p => structuredClone(p))
        }
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
        return this.generatePresenterState();
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
        this.updatePresenters();
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
        this.updatePresenters();
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
        this.updatePresenters();
    }

}
