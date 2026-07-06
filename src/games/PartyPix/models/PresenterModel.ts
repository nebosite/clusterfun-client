import { action, makeObservable, observable } from "mobx";
import {
  ClusterFunPlayer,
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunPresenterModel,
  ITelemetryLogger,
  IStorage,
  ITypeHelper,
  PresenterGameState,
} from "libs";
import Logger from "js-logger";
import {
  PartyPixOnboardEndpoint,
  PartyPixUploadEndpoint,
  PartyPixVoteEndpoint,
  PartyPixSlidePushEndpoint,
  PartyPixCreditsPushEndpoint,
  PartyPixSlideInfo,
} from "./partyPixEndpoints";
import { SLIDE_INTERVAL_MS, START_CREDITS, UPLOAD_COST } from "./GameSettings";
import {
  applyVote,
  applyDeleteRequest,
  canUpload,
  clampIndex,
  creditsForUpvoteCount,
  grantCredits,
  nextSlideIndex,
  shouldAutoDelete,
  upvotesUntilNextCredit,
} from "./partyPixLogic";

// -------------------------------------------------------------------
// Player + photo domain objects
// -------------------------------------------------------------------
export class PartyPixPlayer extends ClusterFunPlayer {
  @observable credits = START_CREDITS;
  @observable uploads = 0;
  @observable totalUp = 0; // lifetime upvotes received (monotonic; drives credits)
}

let photoCounter = 0;

// A single uploaded photo. Vote membership is tracked in plain Sets (for
// enforcement) with mirrored observable counts so the presenter's live tally
// re-renders. Photos are NOT serialized (see the type helper) — the base64
// image data would blow the localStorage checkpoint quota.
export class PartyPixPhoto {
  id: string;
  authorId: string;
  authorName: string;
  full: string; // base64 data URL, full slideshow resolution
  thumb: string; // base64 data URL, small (phone "now showing")
  createdAt: number;

  upVoters = new Set<string>();
  downVoters = new Set<string>();
  deleteVoters = new Set<string>();
  creditedVoters = new Set<string>();

  @observable up = 0;
  @observable down = 0;
  @observable deleteCount = 0;

  constructor(
    id: string,
    authorId: string,
    authorName: string,
    full: string,
    thumb: string,
    createdAt: number,
  ) {
    this.id = id;
    this.authorId = authorId;
    this.authorName = authorName;
    this.full = full;
    this.thumb = thumb;
    this.createdAt = createdAt;
    makeObservable(this);
  }

  syncCounts() {
    this.up = this.upVoters.size;
    this.down = this.downVoters.size;
    this.deleteCount = this.deleteVoters.size;
  }
}

// -------------------------------------------------------------------
// Game states + events
// -------------------------------------------------------------------
export enum PartyPixGameState {
  Slideshow = "Slideshow",
}

export enum PartyPixGameEvent {
  PhotoUploaded = "PhotoUploaded",
  CreditGranted = "CreditGranted",
  PhotoDeleted = "PhotoDeleted",
}

// -------------------------------------------------------------------
// Type helper (save/restore). Players persist (small); photos do NOT — the
// image blobs would overflow localStorage, and losing the slideshow across a
// presenter refresh is an acceptable MVP tradeoff.
// -------------------------------------------------------------------
export const getPartyPixPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "PartyPixPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case PartyPixPresenterModel:
          return "PartyPixPresenterModel";
        case PartyPixPlayer:
          return "PartyPixPlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "PartyPixPresenterModel":
          return new PartyPixPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "PartyPixPlayer":
          return new PartyPixPlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof PartyPixPresenterModel) {
        // Never serialize the in-memory photo blobs (they'd blow the
        // localStorage checkpoint). Because `photos` is skipped, PartyPixPhoto
        // is deliberately NOT registered in getTypeName/constructType above —
        // if you ever serialize a photo (e.g. drop this skip or add a
        // serialized field holding a photo ref), the deep serializer will throw
        // until PartyPixPhoto is registered too.
        if (propertyName === "photos") return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Presenter model — owns all photos, runs the slideshow, tallies votes,
// grants credits, and pushes updates to phones.
// -------------------------------------------------------------------
export class PartyPixPresenterModel extends ClusterfunPresenterModel<PartyPixPlayer> {
  @observable photos = observable<PartyPixPhoto>([]);
  @observable currentIndex = 0;
  private _nextSlideAt = 0;

  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("PartyPix", sessionHelper, logger, storage);
    makeObservable(this);

    this.minPlayers = 1; // a party of one can still play
    this.maxPlayers = 50;
    this.allowedJoinStates = [PresenterGameState.Gathering, PartyPixGameState.Slideshow];
  }

  reconstitute() {
    super.reconstitute();
    // Photos aren't persisted; if we reloaded into an empty show, drop back to
    // the join screen.
    if (this.photos.length === 0) this.gameState = PresenterGameState.Gathering;
    this.listenToEndpoint(PartyPixOnboardEndpoint, this.handleOnboard);
    this.listenToEndpoint(PartyPixUploadEndpoint, this.handleUpload);
    this.listenToEndpoint(PartyPixVoteEndpoint, this.handleVote);
  }

  createFreshPlayerEntry(name: string, id: string): PartyPixPlayer {
    const p = new PartyPixPlayer();
    p.playerId = id;
    p.name = name;
    return p;
  }

  prepareFreshGame = () => {
    action(() => {
      this.gameState = PresenterGameState.Gathering;
      this.photos.clear();
      this.currentIndex = 0;
    })();
  };

  prepareFreshRound = () => {};
  startNextRound = () => {}; // PartyPix has no rounds; the slideshow just runs

  // -------------------------------------------------------------------
  //  Slideshow
  // -------------------------------------------------------------------
  get currentPhoto(): PartyPixPhoto | null {
    if (this.photos.length === 0) return null;
    return this.photos[clampIndex(this.currentIndex, this.photos.length)];
  }

  handleTick() {
    if (this.gameState !== PartyPixGameState.Slideshow) return;
    if (this.photos.length === 0) return;
    if (this.gameTime_ms >= this._nextSlideAt) this.advanceSlide();
  }

  advanceSlide = () => {
    action(() => {
      this.currentIndex = nextSlideIndex(
        clampIndex(this.currentIndex, this.photos.length),
        this.photos.length,
      );
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
    })();
    this.pushSlide();
  };

  // -------------------------------------------------------------------
  //  Upload
  // -------------------------------------------------------------------
  handleUpload = (
    sender: string,
    message: { full: string; thumb: string },
  ): { success: boolean; credits: number; error?: string } => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) {
      Logger.warn(`Upload from unknown player ${sender}`);
      return { success: false, credits: 0, error: "You are not in this game." };
    }
    if (!message.full || !message.thumb) {
      return { success: false, credits: player.credits, error: "That photo didn't come through." };
    }
    if (!canUpload(player.credits)) {
      return { success: false, credits: player.credits, error: "You're out of credits." };
    }

    action(() => {
      player.credits -= UPLOAD_COST;
      player.uploads += 1;
      const photo = new PartyPixPhoto(
        `photo-${++photoCounter}`,
        player.playerId,
        player.name,
        message.full,
        message.thumb,
        Date.now(),
      );
      this.photos.push(photo);
      this.currentIndex = this.photos.length - 1; // show the newcomer right away
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
      if (this.gameState === PresenterGameState.Gathering) {
        this.gameState = PartyPixGameState.Slideshow;
      }
    })();

    this.telemetryLogger.logEvent("Presenter", "PhotoUploaded");
    this.invokeEvent(PartyPixGameEvent.PhotoUploaded, player);
    this.pushSlide();
    this.saveCheckpoint();
    return { success: true, credits: player.credits };
  };

  // -------------------------------------------------------------------
  //  Voting
  // -------------------------------------------------------------------
  handleVote = (
    sender: string,
    message: { photoId: string; kind: "up" | "down" | "delete" },
  ): { ok: boolean; up: number; down: number } => {
    const photo = this.photos.find((p) => p.id === message.photoId);
    if (!photo) return { ok: false, up: 0, down: 0 };

    if (message.kind === "delete") {
      this.handleDeleteRequest(sender, photo);
      return { ok: true, up: photo.up, down: photo.down };
    }

    // Capture the narrowed kind — TS widens `message.kind` back to the full
    // union inside the nested action() closure below.
    const kind = message.kind;
    const author = this.players.find((p) => p.playerId === photo.authorId);
    let creditGranted = false;

    action(() => {
      const result = applyVote(photo, sender, photo.authorId, kind);
      if (!result.ok) return;
      photo.syncCounts();

      if (result.countsForCredit && author) {
        const prev = author.totalUp;
        author.totalUp += 1;
        const earned = creditsForUpvoteCount(prev, author.totalUp);
        if (earned > 0) {
          author.credits = grantCredits(author.credits, earned);
          creditGranted = true;
        }
      }
    })();

    if (author) {
      this.pushCredits();
      if (creditGranted) this.invokeEvent(PartyPixGameEvent.CreditGranted, author);
    }
    if (photo === this.currentPhoto) this.pushSlide();
    this.saveCheckpoint();
    return { ok: true, up: photo.up, down: photo.down };
  };

  handleDeleteRequest = (sender: string, photo: PartyPixPhoto) => {
    let remove = false;
    action(() => {
      const res = applyDeleteRequest(photo, sender);
      if (res.added) photo.syncCounts();
      if (sender === photo.authorId) {
        remove = true; // the author can always pull their own photo
      } else if (shouldAutoDelete(photo.deleteVoters.size, this.players.length)) {
        remove = true;
      }
    })();

    if (remove) this.removePhoto(photo);
    else this.saveCheckpoint();
  };

  removePhoto = (photo: PartyPixPhoto) => {
    action(() => {
      const idx = this.photos.indexOf(photo);
      if (idx >= 0) {
        this.photos.splice(idx, 1);
        // Keep pointing at the same on-screen photo when an EARLIER one is
        // removed; removing the current one leaves the index on what is now the
        // next photo (i.e. advances).
        if (idx < this.currentIndex) this.currentIndex -= 1;
      }
      this.currentIndex = clampIndex(this.currentIndex, this.photos.length);
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
      if (this.photos.length === 0) this.gameState = PresenterGameState.Gathering;
    })();
    this.invokeEvent(PartyPixGameEvent.PhotoDeleted, photo);
    this.pushSlide();
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  Onboarding + pushes
  // -------------------------------------------------------------------
  handleOnboard = (sender: string) => {
    const player = this.players.find((p) => p.playerId === sender);
    const credits = player ? player.credits : 0;
    const totalUp = player ? player.totalUp : 0;
    return {
      state: this.gameState,
      credits,
      totalUp,
      untilNextCredit: upvotesUntilNextCredit(totalUp),
      slide: this.slideInfoFor(player),
    };
  };

  slideInfoFor(player: PartyPixPlayer | undefined): PartyPixSlideInfo | null {
    const photo = this.currentPhoto;
    if (!photo) return null;
    return {
      photoId: photo.id,
      thumb: photo.thumb,
      authorId: photo.authorId,
      authorName: photo.authorName,
      up: photo.up,
      down: photo.down,
      index: clampIndex(this.currentIndex, this.photos.length) + 1,
      count: this.photos.length,
      youAuthored: player ? photo.authorId === player.playerId : false,
    };
  }

  pushSlide() {
    this.sendToEveryone(PartyPixSlidePushEndpoint, (player) => ({
      slide: this.slideInfoFor(player),
    }));
  }

  pushCredits() {
    this.sendToEveryone(PartyPixCreditsPushEndpoint, (player) => ({
      credits: player.credits,
      totalUp: player.totalUp,
      untilNextCredit: upvotesUntilNextCredit(player.totalUp),
    }));
  }
}
