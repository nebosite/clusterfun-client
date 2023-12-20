import Logger from "js-logger";
import { ISessionHelper, ClusterFunGameProps, ClusterfunClientModel, ITelemetryLogger, IStorage, GeneralClientGameState, ITypeHelper, Vector2 } from "libs";
import { makeObservable, observable } from "mobx";
import { TestatoGameState } from "./PresenterModel";
import { TestatoColorChangeActionEndpoint, TestatoMessageActionEndpoint, TestatoOnboardClientEndpoint, TestatoTapActionEndpoint } from "./Endpoints";


// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game
// -------------------------------------------------------------------
export const getTestatoClientTypeHelper = (
    sessionHelper: ISessionHelper, 
    gameProps: ClusterFunGameProps
    ): ITypeHelper =>
 {
     return {
        rootTypeName: "TestatoClientModel",
        getTypeName(o: object) {
            switch (o.constructor) {
                case TestatoClientModel: return "TestatoClientModel";
            }
            return undefined;
        },
        constructType(typeName: string):any {
            switch(typeName)
            {
                case "TestatoClientModel":
                    return new TestatoClientModel(
                        sessionHelper,
                        gameProps.playerName || "Player",
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
// Client data and logic
// -------------------------------------------------------------------
export class TestatoClientModel extends ClusterfunClientModel  {

    ballData = {x: .5, y: .5, xm:.01, ym:.01, color: "#ffffff"}

    // -------------------------------------------------------------------
    // ctor 
    // -------------------------------------------------------------------
    constructor(sessionHelper: ISessionHelper, playerName: string, logger: ITelemetryLogger, storage: IStorage) {
        super("TestatoClient", sessionHelper, playerName, logger, storage);

        this.ballData.x = this.randomDouble(1.0);
        this.ballData.y = this.randomDouble(1.0);
        this.ballData.xm = (this.randomDouble(.01) + 0.005) * (this.randomInt(2) ? 1 : -1) ;
        this.ballData.ym = (this.randomDouble(.01) + 0.005) * (this.randomInt(2) ? 1 : -1) ;
        this.ballData.color = this.randomItem(colors);

        makeObservable(this);
    }

    // -------------------------------------------------------------------
    //  reconstitute - add code here to fix up saved game data that 
    //                 has been loaded after a refresh
    // -------------------------------------------------------------------
    reconstitute() {
        super.reconstitute();
    }

    async requestGameStateFromPresenter(): Promise<void> {
        const response = await this.session.requestPresenter(TestatoOnboardClientEndpoint, {});
        this.roundNumber = response.roundNumber;
        switch(response.state) {
            case TestatoGameState.Playing: this.gameState = TestatoGameState.Playing; break;
            case TestatoGameState.EndOfRound: this.gameState = TestatoGameState.EndOfRound; break;
            default:
                Logger.debug(`Server Updated State to: ${response.state}`)
                this.gameState = GeneralClientGameState.WaitingToStart;
                break;
        }
    }
    
    // -------------------------------------------------------------------
    //  
    // -------------------------------------------------------------------
    assignClientStateFromServerState(serverState: string) {
        // When the server sends and state update message, ensure the client puts itself in the right state.
        // This is neeeded because sometimes the client can miss messages from the server
        switch(serverState) {
            // case RetroSpectroGameState.Discussing: this.gameState = RetroSpectroClientState.Discussing; break;
            // case RetroSpectroGameState.Sorting: this.gameState = RetroSpectroClientState.Sorting; break;
            // case RetroSpectroGameState.WaitingForAnswers: this.gameState = RetroSpectroClientState.SubmittingAnswers; break;
            case TestatoGameState.Playing: this.gameState = TestatoGameState.Playing; break; 
            default:
                Logger.debug(`Server Updated State to: ${serverState}`) 
                this.gameState = GeneralClientGameState.WaitingToStart; break;
        }

    }

    // -------------------------------------------------------------------
    // Handle game logic on a frame-by-frame basis 
    // -------------------------------------------------------------------
    gameThink(elapsed_ms: number) {
        const ball = this.ballData;
        ball.x += ball.xm;
        if(ball.x > 1.0) {  ball.x = 1.0;  ball.xm *= -1; }
        if(ball.x < 0.0) {  ball.x = 0.0;  ball.xm *= -1; }
        ball.y += ball.ym;
        if(ball.y > 1.0) {  ball.y = 1.0;  ball.ym *= -1; }
        if(ball.y < 0.0) {  ball.y = 0.0;  ball.ym *= -1; }
    }

    // -------------------------------------------------------------------
    // Tell the presenter to change my color
    // -------------------------------------------------------------------
    doColorChange(){
        const hex = Array.from("0123456789ABCDEF");
        let colorStyle = "#";
        for(let i = 0; i < 6; i++) colorStyle += this.randomItem(hex);
        this.session.sendMessageToPresenter(TestatoColorChangeActionEndpoint, { colorStyle });
    }
   
    // -------------------------------------------------------------------
    // Tell the presenter to show a message for me
    // -------------------------------------------------------------------
    doMessage(){
        const messages = ["Hi!", "Bye?", "What's up?", "Oh No!", "Hoooooweeee!!", "More gum."]
        this.session.sendMessageToPresenter(TestatoMessageActionEndpoint, { message: this.randomItem(messages)});
    }
   
    // -------------------------------------------------------------------
    // Tell the presenter that I tapped somewhere
    // -------------------------------------------------------------------
    doTap(x: number, y: number){
        x = Math.floor(x * 1000)/1000;
        y = Math.floor(y * 1000)/1000;
        
        this.session.sendMessageToPresenter(TestatoTapActionEndpoint, { point: new Vector2(x, y) });
    }
}
