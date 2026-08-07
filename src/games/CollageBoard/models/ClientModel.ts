import Logger from "js-logger";
import {
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  ITypeHelper,
  PresenterGameState,
} from "libs";
import { action, makeObservable, observable } from "mobx";
import { CollageBoardGameState } from "./PresenterModel";
import {
  CollageBoardOnboardEndpoint,
  CollageBoardClaimZoneEndpoint,
  CollageBoardReleaseZoneEndpoint,
  CollageBoardCommitPhotoEndpoint,
  CollageBoardZonesPushEndpoint,
  CollageBoardZonesPushMessage,
  CollageBoardPreviewPushEndpoint,
  CollageBoardPreviewPushMessage,
  CollageZoneInfo,
} from "./collageBoardEndpoints";
import { ZonePoint, prepareZonePoints, validateZone } from "./collageBoardLogic";
import {
  MIN_ZONE_POINTS,
  MAX_ZONE_POINTS,
  MIN_ZONE_AREA,
  SIMPLIFY_EPSILON,
  MAX_VIEW_ZOOM,
} from "./GameSettings";

// Client-side states - one per screen the player's phone can show.
export enum CollageBoardClientState {
  Playing = "Playing",
}

// Within Playing, the phone is either navigating the board or shooting.
export type CollageClientMode = "navigate" | "camera";

// -------------------------------------------------------------------
// Type helper (save/restore).  Pushed state (preview, zones, the claim)
// is transient and re-pulled from the presenter on onboard; only the
// small scalar bits persist.
// -------------------------------------------------------------------
export const getCollageBoardClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "CollageBoardClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case CollageBoardClientModel:
          return "CollageBoardClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "CollageBoardClientModel":
          return new CollageBoardClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof CollageBoardClientModel) {
        const doNotSerializeMe = ["preview", "zones", "claimedZone", "mode", "claimError"];
        if (doNotSerializeMe.indexOf(propertyName) !== -1) return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Client data and logic
// The client is a thin controller: navigate the board, propose a zone,
// shoot into it.  The presenter owns the collage; this model holds a
// mirrored view (preview + zones) refreshed by pushes and onboard.
// -------------------------------------------------------------------
export class CollageBoardClientModel extends ClusterfunClientModel {
  @observable myColor = "#ffffff";
  @observable preview: string | null = null;
  zones = observable<CollageZoneInfo>([]);
  @observable mode: CollageClientMode = "navigate";
  @observable claimedZone: CollageZoneInfo | null = null;
  @observable claimError: string | null = null;

  // Board navigation viewport: the visible region starts at (viewX, viewY)
  // and spans 1/viewScale of the board.  Persisted so a refresh keeps your spot.
  @observable viewScale = 1;
  @observable viewX = 0;
  @observable viewY = 0;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("CollageBoardClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  //  reconstitute - wire up presenter push listeners
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(CollageBoardZonesPushEndpoint, this.handleZonesPush);
    this.listenToEndpointFromPresenter(CollageBoardPreviewPushEndpoint, this.handlePreviewPush);
  }

  // -------------------------------------------------------------------
  //  requestGameStateFromPresenter - fully rebuild phone state from the
  //  onboard response (clients can miss individual push messages).
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const response = await this.session.requestPresenter(CollageBoardOnboardEndpoint, {});
    action(() => {
      this.myColor = response.playerColor;
      this.preview = response.preview;
      this.zones.replace(response.zones);

      switch (response.state) {
        case CollageBoardGameState.Playing:
          this.gameState = CollageBoardClientState.Playing;
          break;
        case PresenterGameState.Gathering:
          this.gameState = GeneralClientGameState.WaitingToStart;
          break;
        default:
          Logger.debug(`Presenter is in state: ${response.state}`);
          this.gameState = GeneralClientGameState.WaitingToStart;
          break;
      }

      // If the presenter still holds a claim of ours (refresh mid-shot),
      // re-adopt it; otherwise make sure we're back in navigation.
      const mine = response.zones.find((z) => z.playerId === this.playerId) ?? null;
      this.claimedZone = mine;
      this.mode = mine ? "camera" : "navigate";
    })();
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  Presenter pushes
  // -------------------------------------------------------------------
  handleZonesPush = (message: CollageBoardZonesPushMessage) => {
    action(() => {
      this.zones.replace(message.zones);
      // Our claim can expire out from under us - fall back to navigation
      if (this.claimedZone && !message.zones.find((z) => z.zoneId === this.claimedZone!.zoneId)) {
        if (this.mode === "camera") {
          this.claimedZone = null;
          this.mode = "navigate";
          this.claimError = "Your zone expired - draw a new one";
        }
      }
    })();
  };

  handlePreviewPush = (message: CollageBoardPreviewPushMessage) => {
    action(() => {
      this.preview = message.preview;
    })();
  };

  // -------------------------------------------------------------------
  //  Board navigation (viewport shared between screens so a mode switch
  //  returns you to the same spot)
  // -------------------------------------------------------------------
  setView(scale: number, x: number, y: number) {
    action(() => {
      this.viewScale = Math.min(MAX_VIEW_ZOOM, Math.max(1, scale));
      const span = 1 / this.viewScale;
      this.viewX = Math.min(1 - span, Math.max(0, x));
      this.viewY = Math.min(1 - span, Math.max(0, y));
    })();
  }

  // -------------------------------------------------------------------
  //  claimZone - propose an outline; on grant, move to the camera
  // -------------------------------------------------------------------
  async claimZone(rawPoints: ZonePoint[]): Promise<boolean> {
    const points = prepareZonePoints(rawPoints, SIMPLIFY_EPSILON, MAX_ZONE_POINTS);
    const verdict = validateZone(points, MIN_ZONE_POINTS, MAX_ZONE_POINTS, MIN_ZONE_AREA);
    if (!verdict.ok) {
      action(() => {
        this.claimError = verdict.reason ?? "That outline won't work";
      })();
      return false;
    }

    try {
      const response = await this.session.requestPresenter(CollageBoardClaimZoneEndpoint, {
        points,
      });
      action(() => {
        if (response.granted && response.zoneId) {
          this.claimedZone = {
            zoneId: response.zoneId,
            playerId: this.playerId,
            playerName: this.playerName,
            color: this.myColor,
            points,
          };
          this.mode = "camera";
          this.claimError = null;
        } else {
          this.claimError = response.reason ?? "Claim was refused";
        }
      })();
      this.saveCheckpoint();
      return response.granted;
    } catch (err) {
      Logger.warn(`Claim failed: ${err}`);
      action(() => {
        this.claimError = "Claim failed - try again";
      })();
      return false;
    }
  }

  // -------------------------------------------------------------------
  //  cancelClaim - back out of the camera without shooting
  // -------------------------------------------------------------------
  cancelClaim() {
    const zone = this.claimedZone;
    if (zone) {
      this.session.sendMessageToPresenter(CollageBoardReleaseZoneEndpoint, {
        zoneId: zone.zoneId,
      });
    }
    action(() => {
      this.claimedZone = null;
      this.mode = "navigate";
    })();
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  commitPhoto - send the captured bbox JPEG for the claimed zone
  // -------------------------------------------------------------------
  async commitPhoto(image: string): Promise<{ ok: boolean; reason?: string }> {
    const zone = this.claimedZone;
    if (!zone) return { ok: false, reason: "No zone selected" };
    try {
      const response = await this.session.requestPresenter(CollageBoardCommitPhotoEndpoint, {
        zoneId: zone.zoneId,
        image,
      });
      if (response.ok) {
        action(() => {
          this.claimedZone = null;
          this.mode = "navigate";
          this.claimError = null;
        })();
        this.saveCheckpoint();
      } else {
        action(() => {
          this.claimError = response.reason ?? "The photo didn't land";
        })();
      }
      return response;
    } catch (err) {
      Logger.warn(`Commit failed: ${err}`);
      return { ok: false, reason: "Upload failed - try again" };
    }
  }
}
