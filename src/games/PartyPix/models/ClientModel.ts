import Logger from "js-logger";
import {
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  GeneralGameState,
  ITypeHelper,
  PresenterGameState,
} from "libs";
import { action, makeObservable, observable } from "mobx";
import { PartyPixGameState } from "./PresenterModel";
import { START_CREDITS, CREDIT_UPVOTE_MILESTONES } from "./GameSettings";
import {
  PartyPixOnboardEndpoint,
  PartyPixUploadEndpoint,
  PartyPixVoteEndpoint,
  PartyPixSlidePushEndpoint,
  PartyPixCreditsPushEndpoint,
  PartyPixNoticeEndpoint,
  PartyPixNoticeKind,
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
        if (
          ["currentSlide", "myVotes", "myFlags", "pendingFlag", "notice"].indexOf(propertyName) !==
          -1
        ) {
          return false;
        }
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
  @observable untilNextCredit = CREDIT_UPVOTE_MILESTONES[0]; // overwritten by onboard/pushes
  @observable currentSlide: PartyPixSlideInfo | null = null;
  @observable viewMode: ClientViewMode = "capture";

  // Which way this player voted each photo (to show active button state).
  myVotes = observable.map<string, "up" | "down">();
  myFlags = observable.set<string>();

  /**
   * The moment to tell this player about, if there is one. A banner rather than a number,
   * because these are things that HAPPENED - your photo was flagged, the room liked one - and
   * a number nobody was watching change communicates none of that.
   */
  @observable notice: { kind: PartyPixNoticeKind; text: string } | null = null;

  dismissNotice(): void {
    action(() => (this.notice = null))();
  }

  handleNotice = (message: { kind: PartyPixNoticeKind; authorName?: string }) => {
    // Every one of these explains the economy, because "why can I not take another photo" is
    // the question the game otherwise never answers out loud.
    const text =
      message.kind === "flagged"
        ? "Somebody flagged one of your photos, so it has left the slideshow while the host takes a look. Upvotes earn you credits for more pictures - keep shooting."
        : message.kind === "firstUpvote"
          ? "Your first upvote! Upvotes earn you credits, and credits are what let you take more pictures."
          : "Everybody upvoted your photo - that is the whole room. Upvotes earn you credits for more pictures.";
    action(() => (this.notice = { kind: message.kind, text }))();
  };

  /**
   * The flag this player has tapped but not yet confirmed - at most one at a time, because it
   * is answered in a dialog over the picture rather than queued in a list. Never sent to the
   * presenter, never checkpointed.
   *
   * It deliberately carries its own thumb and author name and OUTLIVES a slide change: the
   * show rotates every few seconds, and a confirmation that vanished out from under a player
   * mid-decision would be worse than one that keeps showing what it is about.
   */
  @observable pendingFlag: { photoId: string; thumb: string; authorName: string } | null = null;

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
    this.listenToEndpointFromPresenter(PartyPixNoticeEndpoint, this.handleNotice);

    // Coming back from the CAMERA is coming back from the background.
    //
    // Taking a photo on a phone hands the whole screen to another app. The browser is
    // suspended behind it - sockets close, pushes are missed, and on a memory-tight device
    // the page may be discarded outright. This game is the one in the set that routinely
    // sends a player away and expects them back, so it is the one that has to re-sync on
    // return rather than trusting whatever it was holding when it went away.
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.subscribe(GeneralGameState.Destroyed, "partypix visibility", () => {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    });
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    if (this.isShutdown) return;
    // Cheap and idempotent: it is the same call a fresh join makes.
    this.requestGameStateFromPresenter().catch((err) =>
      Logger.warn(`PartyPix could not re-sync after returning to the foreground: ${err}`),
    );
  };

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

  /** Tapped the flag on this photo, whether or not it has been confirmed yet. */
  get hasStagedOrFlaggedCurrent(): boolean {
    const slide = this.currentSlide;
    if (!slide) return false;
    return this.myFlags.has(slide.photoId) || this.pendingFlag?.photoId === slide.photoId;
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

  // -------------------------------------------------------------------
  //  Flagging is TWO steps, and deliberately so.
  //
  //  The flag button sits on the photo, where a thumb reaches it - which is exactly where a
  //  mis-tap lands too, and the first flag pulls a photo out of rotation for everybody. So the
  //  button only STAGES the flag; nothing goes to the presenter until the player answers the
  //  confirmation that opens over the picture.
  // -------------------------------------------------------------------
  stageFlag(): void {
    const slide = this.currentSlide;
    if (!slide) return;
    if (this.myFlags.has(slide.photoId)) return;
    if (this.pendingFlag) return; // one at a time - the dialog is answered before the next
    action(() => {
      this.pendingFlag = {
        photoId: slide.photoId,
        thumb: slide.thumb,
        authorName: slide.authorName,
      };
    })();
  }

  /** "Yes, Flag" - now it goes to the presenter. */
  async confirmFlag(photoId: string): Promise<void> {
    action(() => {
      this.myFlags.add(photoId);
      if (this.pendingFlag?.photoId === photoId) this.pendingFlag = null;
    })();
    try {
      await this.session.requestPresenter(PartyPixVoteEndpoint, { photoId, kind: "delete" });
    } catch (err) {
      Logger.warn(`Flag failed: ${err}`);
    }
  }

  /** "Whoops, No" - it never left the phone. */
  cancelFlag(): void {
    action(() => (this.pendingFlag = null))();
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
