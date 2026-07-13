import Logger from "js-logger";
import {
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  ITypeHelper,
  Vector2,
} from "libs";
import { TemplateGameState } from "./PresenterModel";
import { BallState, stepBall } from "./templateLogic";
import {
  TemplateColorChangeActionEndpoint,
  TemplateMessageActionEndpoint,
  TemplateOnboardClientEndpoint,
  TemplateTapActionEndpoint,
} from "./templateEndpoints";

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game.
// Register every custom class the client model can hold.
// -------------------------------------------------------------------
export const getTemplateClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "TemplateClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case TemplateClientModel:
          return "TemplateClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "TemplateClientModel":
          return new TemplateClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      // TODO: re-wrap any MobX observable collections here, e.g.:
      // switch (propertyName) {
      //   case "myObservableCollection":
      //     return observable<number>(rehydratedObject as number[]);
      // }
      return rehydratedObject;
    },
  };
};

// Client-side states - one per screen the player's phone can show.
export enum TemplateClientState {
  Playing = "Playing",
  EndOfRound = "EndOfRound",
}

const colors = ["white", "red", "orange", "yellow", "blue", "cyan", "magenta", "gray"];

// -------------------------------------------------------------------
// Client data and logic
// The client is a thin controller: it captures input, sends it to the
// presenter, and renders only what the player needs to interact.  It
// never makes authoritative game decisions.
// -------------------------------------------------------------------
export class TemplateClientModel extends ClusterfunClientModel {
  // Purely local eye-candy state - fine to keep on the client because it
  // affects nothing authoritative.  Frame math lives in templateLogic.ts.
  ballData: BallState = { x: 0.5, y: 0.5, xm: 0.01, ym: 0.01, color: "#ffffff" };

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("TemplateClient", sessionHelper, playerName, logger, storage);

    this.ballData.x = this.randomDouble(1.0);
    this.ballData.y = this.randomDouble(1.0);
    this.ballData.xm = (this.randomDouble(0.01) + 0.005) * (this.randomInt(2) ? 1 : -1);
    this.ballData.ym = (this.randomDouble(0.01) + 0.005) * (this.randomInt(2) ? 1 : -1);
    this.ballData.color = this.randomItem(colors);
  }

  // -------------------------------------------------------------------
  //  reconstitute - runs on fresh construction AND after restoring a
  //  saved game.  Wire up presenter listeners here, e.g.:
  //  this.listenToEndpointFromPresenter(SomePushEndpoint, this.handleSomePush);
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
  }

  // -------------------------------------------------------------------
  //  requestGameStateFromPresenter - the client's ONLY state-sync path.
  //  Called on join and whenever the presenter broadcasts an invalidate,
  //  so it must fully rebuild client state from the response (clients
  //  can miss individual push messages).
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const response = await this.session.requestPresenter(TemplateOnboardClientEndpoint, {});
    this.roundNumber = response.roundNumber;
    switch (response.gameState) {
      case TemplateGameState.Playing:
        this.gameState = TemplateClientState.Playing;
        break;
      case TemplateGameState.EndOfRound:
        this.gameState = TemplateClientState.EndOfRound;
        break;
      default:
        Logger.debug(`Presenter is in state: ${response.gameState}`);
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
    }
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  // gameThink - frame-by-frame local logic (called from the view's
  // animation loop).  Arcade-style games do continuous work here;
  // turn-based games may not need it at all.
  // -------------------------------------------------------------------
  gameThink(elapsed_ms: number) {
    this.ballData = stepBall(this.ballData);
  }

  // -------------------------------------------------------------------
  // Player actions - each one sends a small typed message to the
  // presenter, which makes the authoritative change.
  // -------------------------------------------------------------------
  doColorChange() {
    const hex = Array.from("0123456789ABCDEF");
    let colorStyle = "#";
    for (let i = 0; i < 6; i++) colorStyle += this.randomItem(hex);
    this.session.sendMessageToPresenter(TemplateColorChangeActionEndpoint, { colorStyle });
  }

  doMessage() {
    const messages = ["Hi!", "Bye?", "What's up?", "Oh No!", "Hoooooweeee!!", "More gum."];
    this.session.sendMessageToPresenter(TemplateMessageActionEndpoint, {
      message: this.randomItem(messages),
    });
  }

  doTap(x: number, y: number) {
    x = Math.floor(x * 1000) / 1000;
    y = Math.floor(y * 1000) / 1000;

    this.session.sendMessageToPresenter(TemplateTapActionEndpoint, { point: new Vector2(x, y) });
  }
}
