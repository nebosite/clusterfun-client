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
import { PartyPixGameState } from "./PresenterModel";
import { START_CREDITS, UPVOTES_PER_CREDIT } from "./GameSettings";
import {
  PartyPixOnboardEndpoint,
  PartyPixUploadEndpoint,
  PartyPixVoteEndpoint,
  PartyPixSlidePushEndpoint,
  PartyPixCreditsPushEndpoint,
  PartyPixSlideInfo,
} from "./partyPixEndpoints";

export enum PartyPixClientState {
  Playing = "Playing",
}

export type ClientViewMode = "capture" | "vote";

// -------------------------------------------------------------------
// Type helper (save/restore). Persist the small scalar state; skip the
// transient/heavy bits (the pushed slide carries a base64 thumb; the vote
// memory is re-derivable) — they repopulate from the presenter on onboard.
// -------------------------------------------------------------------
export const getPartyPixClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "PartyPixClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case PartyPixClientModel:
          return "PartyPixClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "PartyPixClientModel":
          return new PartyPixClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof PartyPixClientModel) {
        if (["currentSlide", "myVotes", "myFlags"].indexOf(propertyName) !== -1) return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Client model — the phone. Captures/uploads photos and votes on the
// slideshow. The presenter is authoritative; this holds an optimistic view.
// -------------------------------------------------------------------
export class PartyPixClientModel extends ClusterfunClientModel {
  @observable credits = START_CREDITS;
  @observable totalUp = 0;
  @observable untilNextCredit = UPVOTES_PER_CREDIT;
  @observable currentSlide: PartyPixSlideInfo | null = null;
  @observable viewMode: ClientViewMode = "capture";

  // Which way this player voted each photo (to show active button state).
  myVotes = observable.map<string, "up" | "down">();
  myFlags = observable.set<string>();

  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("PartyPixClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(PartyPixSlidePushEndpoint, this.handleSlidePush);
    this.listenToEndpointFromPresenter(PartyPixCreditsPushEndpoint, this.handleCreditsPush);
  }

  async requestGameStateFromPresenter(): Promise<void> {
    const res = await this.session.requestPresenter(PartyPixOnboardEndpoint, {});
    action(() => {
      this.credits = res.credits;
      this.totalUp = res.totalUp;
      this.untilNextCredit = res.untilNextCredit;
      this.currentSlide = res.slide;
      this.assignClientStateFromServerState(res.state);
    })();
  }

  assignClientStateFromServerState(serverState: string) {
    switch (serverState) {
      case PresenterGameState.Gathering:
      case PartyPixGameState.Slideshow:
        // Players can shoot and vote the whole time the party is live.
        this.gameState = PartyPixClientState.Playing;
        break;
      default:
        Logger.debug(`PartyPix client: unmapped server state ${serverState}`);
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
    }
  }

  // -------------------------------------------------------------------
  //  View switching
  // -------------------------------------------------------------------
  setViewMode(mode: ClientViewMode) {
    action(() => {
      this.viewMode = mode;
    })();
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  Upload
  // -------------------------------------------------------------------
  async uploadPhoto(
    full: string,
    thumb: string,
  ): Promise<{ success: boolean; credits: number; error?: string }> {
    try {
      const res = await this.session.requestPresenter(PartyPixUploadEndpoint, { full, thumb });
      action(() => {
        this.credits = res.credits;
      })();
      this.saveCheckpoint();
      return res;
    } catch (err) {
      Logger.warn(`Upload failed: ${err}`);
      return { success: false, credits: this.credits, error: "Upload failed — try again." };
    }
  }

  // -------------------------------------------------------------------
  //  Voting
  // -------------------------------------------------------------------
  get myVoteForCurrent(): "up" | "down" | undefined {
    if (!this.currentSlide) return undefined;
    return this.myVotes.get(this.currentSlide.photoId);
  }

  get hasFlaggedCurrent(): boolean {
    if (!this.currentSlide) return false;
    return this.myFlags.has(this.currentSlide.photoId);
  }

  async vote(kind: "up" | "down"): Promise<void> {
    const slide = this.currentSlide;
    if (!slide || slide.youAuthored) return;
    const photoId = slide.photoId;

    action(() => {
      // Optimistic toggle mirrors the presenter's applyVote rule.
      if (this.myVotes.get(photoId) === kind) this.myVotes.delete(photoId);
      else this.myVotes.set(photoId, kind);
    })();

    try {
      const res = await this.session.requestPresenter(PartyPixVoteEndpoint, { photoId, kind });
      action(() => {
        if (this.currentSlide && this.currentSlide.photoId === photoId) {
          this.currentSlide = { ...this.currentSlide, up: res.up, down: res.down };
        }
      })();
    } catch (err) {
      Logger.warn(`Vote failed: ${err}`);
    }
  }

  async flag(): Promise<void> {
    const slide = this.currentSlide;
    if (!slide) return;
    const photoId = slide.photoId;
    action(() => {
      this.myFlags.add(photoId);
    })();
    try {
      await this.session.requestPresenter(PartyPixVoteEndpoint, { photoId, kind: "delete" });
    } catch (err) {
      Logger.warn(`Flag failed: ${err}`);
    }
  }

  // -------------------------------------------------------------------
  //  Presenter pushes
  // -------------------------------------------------------------------
  handleSlidePush = (message: { slide: PartyPixSlideInfo | null }) => {
    action(() => {
      this.currentSlide = message.slide;
    })();
  };

  handleCreditsPush = (message: { credits: number; totalUp: number; untilNextCredit: number }) => {
    action(() => {
      this.credits = message.credits;
      this.totalUp = message.totalUp;
      this.untilNextCredit = message.untilNextCredit;
    })();
  };
}
