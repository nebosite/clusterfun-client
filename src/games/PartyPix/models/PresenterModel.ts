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
import { PhotoStore } from "./PhotoStore";

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

  // On-disk backing (when a folder is connected). `managed` = PartyPix created
  // the file, so it may be deleted; pre-existing files are only ever hidden.
  // `removed` guards the upload→save race: if the photo is deleted before its
  // async disk write finishes, the write's callback cleans the orphaned file up.
  fileName?: string;
  managed = true;
  removed = false;

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
        // Skip these on the presenter model:
        //  - `photos`: the base64 blobs would blow the localStorage checkpoint
        //    (and PartyPixPhoto is intentionally unregistered — see below).
        //  - `photoStore`: a PhotoStore instance; the deep serializer throws on
        //    any unregistered class, so leaving it in would break EVERY
        //    checkpoint (killing player credit/totalUp persistence). The folder
        //    handle is remembered separately in IndexedDB by PhotoStore.
        //  - folder UI scalars: transient; re-derived by initPhotoStore on load.
        // Because `photos` is skipped, PartyPixPhoto is deliberately NOT
        // registered in getTypeName/constructType above.
        const skip = [
          "photos",
          "photoStore",
          "folderStatus",
          "folderName",
          "includeExistingChoice",
        ];
        if (skip.indexOf(propertyName) !== -1) return false;
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

  // On-disk photo folder (optional; File System Access API). Kept out of
  // serialization — the folder handle is remembered separately in IndexedDB by
  // PhotoStore, so a same-session refresh reconnects silently.
  private photoStore = new PhotoStore();
  @observable folderStatus: "unsupported" | "none" | "needsReconnect" | "connected" = "none";
  @observable folderName = "";
  @observable includeExistingChoice = true;

  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("PartyPix", sessionHelper, logger, storage);
    makeObservable(this);

    this.minPlayers = 1; // a party of one can still play
    this.maxPlayers = 50;
    this.allowedJoinStates = [PresenterGameState.Gathering, PartyPixGameState.Slideshow];
  }

  reconstitute() {
    super.reconstitute();
    // Photos live on disk (if a folder is connected) or in memory only. Start on
    // the join screen; initPhotoStore() will reconnect a remembered folder and
    // reload its photos, flipping to the slideshow if any exist.
    if (this.photos.length === 0) this.gameState = PresenterGameState.Gathering;
    this.listenToEndpoint(PartyPixOnboardEndpoint, this.handleOnboard);
    this.listenToEndpoint(PartyPixUploadEndpoint, this.handleUpload);
    this.listenToEndpoint(PartyPixVoteEndpoint, this.handleVote);
    void this.initPhotoStore();
  }

  // -------------------------------------------------------------------
  //  Photo folder (persistence). The pick/reconnect calls need a user
  //  gesture, so the view triggers them from a button; restore does not.
  // -------------------------------------------------------------------
  private initPhotoStore = async () => {
    const perm = await this.photoStore.restore();
    action(() => {
      if (perm === "unsupported") this.folderStatus = "unsupported";
      else if (perm === "none") this.folderStatus = "none";
      else if (perm === "granted") {
        this.folderStatus = "connected";
        this.folderName = this.photoStore.folderName;
      } else {
        // "prompt" / "denied": remembered, but needs a one-click re-grant.
        this.folderStatus = "needsReconnect";
        this.folderName = this.photoStore.folderName;
      }
    })();
    if (perm === "granted") await this.loadPhotosFromDisk();
  };

  setIncludeExistingChoice(value: boolean) {
    action(() => {
      this.includeExistingChoice = value;
    })();
  }

  chooseFolder = async () => {
    const ok = await this.photoStore.pickFolder(this.includeExistingChoice);
    if (!ok) return;
    action(() => {
      this.folderStatus = "connected";
      this.folderName = this.photoStore.folderName;
    })();
    await this.loadPhotosFromDisk();
  };

  reconnectFolder = async () => {
    const ok = await this.photoStore.requestPermission();
    if (!ok) return;
    action(() => {
      this.folderStatus = "connected";
      this.folderName = this.photoStore.folderName;
    })();
    await this.loadPhotosFromDisk();
  };

  private loadPhotosFromDisk = async () => {
    // Persist any in-memory photos taken before the folder was connected (e.g.
    // uploads that happened while a remembered folder awaited a one-click
    // reconnect) so rebuilding from disk below doesn't drop them.
    const unsaved = this.photos.filter((p) => p.managed && !p.fileName && !p.removed);
    for (const p of unsaved) {
      const fileName = await this.photoStore.savePhoto(p.full, p.authorName, p.createdAt);
      if (fileName) action(() => (p.fileName = fileName))();
    }

    const loaded = await this.photoStore.listPhotos();
    action(() => {
      this.photos.clear();
      for (const lp of loaded) {
        const photo = new PartyPixPhoto(
          `disk-${lp.fileName}`,
          "", // no live player owns a photo loaded from disk
          lp.author,
          lp.full,
          lp.thumb,
          lp.createdAt,
        );
        photo.fileName = lp.fileName;
        photo.managed = lp.managed;
        this.photos.push(photo);
      }
      this.currentIndex = 0;
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
      this.gameState =
        this.photos.length > 0 ? PartyPixGameState.Slideshow : PresenterGameState.Gathering;
    })();
    this.pushSlide();
  };

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

    const photo = new PartyPixPhoto(
      `photo-${++photoCounter}`,
      player.playerId,
      player.name,
      message.full,
      message.thumb,
      Date.now(),
    );
    action(() => {
      player.credits -= UPLOAD_COST;
      player.uploads += 1;
      this.photos.push(photo);
      this.currentIndex = this.photos.length - 1; // show the newcomer right away
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
      if (this.gameState === PresenterGameState.Gathering) {
        this.gameState = PartyPixGameState.Slideshow;
      }
    })();

    // Persist to the chosen folder (best-effort, off the response path). Record
    // the file name on the photo so it can be deleted later. If the photo was
    // already removed while the write was in flight, delete the orphan now.
    if (this.photoStore.hasFolder()) {
      this.photoStore.savePhoto(photo.full, photo.authorName, photo.createdAt).then((fileName) => {
        if (!fileName) return;
        action(() => (photo.fileName = fileName))();
        if (photo.removed) void this.photoStore.forget(fileName);
      });
    }

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
    photo.removed = true; // a still-in-flight disk write will clean up after itself
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
    // Remove from disk too (deletes only our own files; pre-existing images are
    // hidden, never destroyed — see PhotoStore.forget / photoStoreLogic).
    if (photo.fileName && this.photoStore.hasFolder()) {
      void this.photoStore.forget(photo.fileName);
    }
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
