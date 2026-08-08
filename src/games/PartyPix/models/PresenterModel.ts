import { action, makeObservable, observable } from "mobx";
import {
  ClusterFunPlayer,
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunPresenterModel,
  ReconnectInfo,
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
  PartyPixNoticeEndpoint,
  PartyPixSlideInfo,
} from "./partyPixEndpoints";
import {
  SLIDE_INTERVAL_MS,
  START_CREDITS,
  UPLOAD_COST,
  PARTY_RESUME_WINDOW_MS,
  FOLDER_PREVIEW_COUNT,
} from "./GameSettings";
import {
  applyVote,
  applyDeleteRequest,
  canUpload,
  clampIndex,
  creditsForUpvoteCount,
  grantCredits,
  imageHash,
  nextSlideIndex,
  shouldOfferResume,
  shouldPullFromRotation,
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

  // Content fingerprint used to block re-uploading a banned photo.
  hash: string;
  // Once the presenter "OK"s a flagged photo it returns to rotation but then
  // needs FLAG_THRESHOLD_APPROVED flags to be pulled again.
  @observable approved = false;
  // Names of everyone who flagged this photo (id -> name), for the review UI.
  flaggerNames = new Map<string, string>();

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
    this.hash = imageHash(full);
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
          "flaggedPhotos",
          "bannedHashes",
          "photoStore",
          "folderStatus",
          "folderName",
          "includeExistingChoice",
          "folderPreviewOpen",
          "folderPreview",
          "folderPreviewTotal",
          // Re-derived from the folder on every start; never trusted from the checkpoint.
          "resumeOffer",
        ];
        // `lastPartyAt` is deliberately NOT skipped - it is the one thing that has to
        // outlive the presenter being killed, since it is what decides whether the
        // photos still in the folder belong to a party worth offering to continue.
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

  // Photos a flag has pulled out of rotation but that are kept for the host to
  // review (see the "Flagged" review UI). Not serialized (base64 blobs).
  @observable flaggedPhotos = observable<PartyPixPhoto>([]);
  // Content hashes of permanently-banned photos, to block re-uploads. Session-
  // scoped (not persisted): a banned photo's file is deleted so it won't reload.
  private bannedHashes = new Set<string>();

  // On-disk photo folder (optional; File System Access API). Kept out of
  // serialization — the folder handle is remembered separately in IndexedDB by
  // PhotoStore, so a same-session refresh reconnects silently.
  private photoStore = new PhotoStore();
  @observable folderStatus: "unsupported" | "none" | "needsReconnect" | "connected" = "none";

  /**
   * Whether the host has settled the photo folder question, one way or the other.
   *
   * The setup screen will not hand over to the slideshow until this is true. Photos live in
   * that folder: start without one and the party's pictures exist only in the presenter tab,
   * and the first refresh takes them all. "unsupported" counts as settled - on a browser
   * without the File System Access API there is no folder to choose, and blocking there would
   * make the game unplayable rather than careful.
   */
  get folderDecided(): boolean {
    return this.folderStatus === "connected" || this.folderStatus === "unsupported";
  }
  @observable folderName = "";
  @observable includeExistingChoice = true;
  // Preview of image files found in a just-picked folder (before starting).
  @observable folderPreviewOpen = false;
  @observable folderPreview: { fileName: string; thumb: string; managed: boolean }[] = [];
  @observable folderPreviewTotal = 0;

  /**
   * When the last photo of the last party landed. Serialized, because it has to survive the
   * presenter being killed - that is the whole case this exists for.
   */
  @observable lastPartyAt = 0;

  /**
   * A party from the last PARTY_RESUME_WINDOW_MS that is still sitting in the connected
   * folder, offered on the setup screen as "Continue the last party". Null means start clean,
   * which is also what a stale party gets.
   */
  @observable resumeOffer: { photoCount: number; lastPartyAt: number } | null = null;

  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("PartyPix", sessionHelper, logger, storage);
    makeObservable(this);

    this.minPlayers = 1; // a party of one can still play
    this.maxPlayers = 50;
    this.allowedJoinStates = [PresenterGameState.Gathering, PartyPixGameState.Slideshow];
  }

  reconstitute() {
    super.reconstitute();
    // ALWAYS the setup screen. Photos are never serialized, so this model always comes back
    // with none - but a remembered folder used to be reconnected and its photos loaded during
    // startup, which flipped straight to the slideshow and skipped setup entirely. Starting a
    // party is a decision the host makes; the folder no longer makes it for them.
    this.gameState = PresenterGameState.Gathering;
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
    // NOT loadPhotosFromDisk(). A remembered folder means the host may want to CONTINUE a
    // party, which is a question, not an answer.
    if (perm === "granted") await this.evaluateResumeOffer();
  };

  /**
   * Decide whether the connected folder holds a party worth offering to continue.
   *
   * Three things have to be true: the folder is connected, it actually holds photos, and the
   * last one landed inside PARTY_RESUME_WINDOW_MS. Older than that and the pictures are
   * somebody's saved album rather than a party that got interrupted, so the offer is withheld
   * and the host starts clean. Nothing on disk is touched either way.
   */
  private evaluateResumeOffer = async () => {
    if (this.folderStatus !== "connected") {
      action(() => {
        this.resumeOffer = null;
        this.folderPreview = [];
        this.folderPreviewTotal = 0;
      })();
      return;
    }
    // One row of thumbnails as well as the count. A remembered folder used to be a bare name,
    // which tells the host nothing about whether it is the folder they meant - the pictures do.
    const { items, total } = await this.photoStore.listImageThumbs(FOLDER_PREVIEW_COUNT);
    const offer = shouldOfferResume(total, this.lastPartyAt, Date.now(), PARTY_RESUME_WINDOW_MS);
    action(() => {
      this.folderPreview = items;
      this.folderPreviewTotal = total;
      this.resumeOffer = offer ? { photoCount: total, lastPartyAt: this.lastPartyAt } : null;
    })();
  };

  /** "Continue the last party" - load the folder back in and pick up where it left off. */
  continueLastParty = async () => {
    action(() => (this.resumeOffer = null))();
    await this.loadPhotosFromDisk();
  };

  /** "Start a new party" - keep the folder, leave its files alone, begin with an empty show. */
  dismissResumeOffer = () => {
    action(() => (this.resumeOffer = null))();
  };

  setIncludeExistingChoice(value: boolean) {
    action(() => {
      this.includeExistingChoice = value;
    })();
    // Persist for the eventual load (no-op until a folder is picked).
    void this.photoStore.setIncludeExisting(value);
  }

  // Pick a folder, then PREVIEW the image files on disk (thumbnails + count)
  // without starting the show — the host sees what's there, adjusts the include
  // choice, and presses Start (startFromFolder). reconnect/restore skip the
  // preview and resume directly.
  chooseFolder = async () => {
    const ok = await this.photoStore.pickFolder(this.includeExistingChoice);
    if (!ok) return;
    action(() => {
      this.folderStatus = "connected";
      this.folderName = this.photoStore.folderName;
      this.folderPreviewOpen = true;
      this.folderPreview = [];
      this.folderPreviewTotal = 0;
    })();
    const { items, total } = await this.photoStore.listImageThumbs(FOLDER_PREVIEW_COUNT);
    action(() => {
      this.folderPreview = items;
      this.folderPreviewTotal = total;
    })();
  };

  startFromFolder = async () => {
    action(() => {
      this.folderPreviewOpen = false;
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
    // Reconnecting re-grants access to the folder; it does not decide what to do with what is
    // in it. If a recent party is there, the setup screen now offers to continue it.
    await this.evaluateResumeOffer();
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
      this.flaggedPhotos.clear(); // flag/approve state is session-only
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
        this.photos.length > 0 && this.folderDecided
          ? PartyPixGameState.Slideshow
          : PresenterGameState.Gathering;
    })();
    this.pushSlide();
  };

  createFreshPlayerEntry(name: string, id: string): PartyPixPlayer {
    const p = new PartyPixPlayer();
    p.playerId = id;
    p.name = name;
    return p;
  }

  // -------------------------------------------------------------------
  //  onPlayerReturned - their photos are still theirs.
  //
  //  `photo.authorId` is a player id, and player ids are stable across a
  //  reconnect, so authorship, credits and the "you took this one" flag all
  //  survive untouched.  The phone pulls its whole state back through the
  //  Onboard request on join, so there is nothing to push at it here.
  //
  //  (This used to be broken: a reconnect handed out a new id, so a
  //  returning player stopped being credited for their own photos and
  //  `youAuthored` went false for pictures they had taken.)
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: PartyPixPlayer, _info: ReconnectInfo) {}

  // -------------------------------------------------------------------
  //  onPlayerDisconnected - nothing to do.  Their photos stay in the show
  //  and keep earning them credits while they are away, which is what you
  //  would want: the slideshow is the party, not the phone.
  // -------------------------------------------------------------------
  protected onPlayerDisconnected(_player: PartyPixPlayer) {}

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
    if (this.bannedHashes.has(imageHash(message.full))) {
      return { success: false, credits: player.credits, error: "The host removed that photo." };
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
      // Stamps the party as live NOW. Checkpointed, so if this presenter is killed the next
      // one can tell whether the folder holds tonight's party or last month's.
      this.lastPartyAt = photo.createdAt;
      if (this.gameState === PresenterGameState.Gathering) {
        if (this.folderDecided) this.gameState = PartyPixGameState.Slideshow;
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
    let firstUpvote = false;
    let swept = false;

    action(() => {
      const result = applyVote(photo, sender, photo.authorId, kind);
      if (!result.ok) return;
      photo.syncCounts();

      // Everybody who COULD upvote this photo has - its author cannot vote on their own, so
      // the ceiling is one less than the room. Worth saying out loud; it never happens twice
      // for the same photo because the count only reaches the ceiling once.
      if (kind === "up" && this.players.length > 1 && photo.up === this.players.length - 1) {
        swept = true;
      }

      if (result.countsForCredit && author) {
        const prev = author.totalUp;
        if (prev === 0) firstUpvote = true;
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
      // The sweep is the louder news, so it wins if both land on the same vote.
      if (swept) this.sendToPlayer(PartyPixNoticeEndpoint, author, { kind: "sweep" });
      else if (firstUpvote) {
        this.sendToPlayer(PartyPixNoticeEndpoint, author, { kind: "firstUpvote" });
      }
    }
    if (photo === this.currentPhoto) this.pushSlide();
    this.saveCheckpoint();
    return { ok: true, up: photo.up, down: photo.down };
  };

  // A flag pulls a photo out of rotation into the flagged holding area (1 flag
  // by default, or FLAG_THRESHOLD_APPROVED once the host has "OK"d it). The photo
  // is remembered for the host to review — not deleted.
  handleDeleteRequest = (sender: string, photo: PartyPixPhoto) => {
    let pull = false;
    action(() => {
      const res = applyDeleteRequest(photo, sender);
      if (res.added) {
        photo.syncCounts();
        const flagger = this.players.find((p) => p.playerId === sender);
        if (flagger) photo.flaggerNames.set(sender, flagger.name);
      }
      if (shouldPullFromRotation(photo.deleteVoters.size, photo.approved)) pull = true;
    })();

    if (pull) this.pullToFlagged(photo);
    else this.saveCheckpoint();
  };

  // Remove a photo from the active rotation, fixing up the slide index. Must be
  // called from inside an action.
  private spliceFromActive(photo: PartyPixPhoto) {
    const idx = this.photos.indexOf(photo);
    if (idx < 0) return;
    this.photos.splice(idx, 1);
    // Keep pointing at the same on-screen photo when an EARLIER one leaves;
    // removing the current one lands the index on what is now the next photo.
    if (idx < this.currentIndex) this.currentIndex -= 1;
    this.currentIndex = clampIndex(this.currentIndex, this.photos.length);
    this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
    if (this.photos.length === 0) this.gameState = PresenterGameState.Gathering;
  }

  pullToFlagged = (photo: PartyPixPhoto) => {
    // Tell the author. Their photo has just left the slideshow and, without this, the only
    // evidence is that it stopped coming round - which reads as a bug, not as moderation.
    const author = this.players.find((p) => p.playerId === photo.authorId);
    if (author) this.sendToPlayer(PartyPixNoticeEndpoint, author, { kind: "flagged" });

    action(() => {
      this.spliceFromActive(photo);
      if (!this.flaggedPhotos.includes(photo)) this.flaggedPhotos.push(photo);
    })();
    this.invokeEvent(PartyPixGameEvent.PhotoDeleted, photo);
    this.pushSlide();
    this.saveCheckpoint();
  };

  // Host moderation: "OK" a flagged photo — it returns to rotation and now needs
  // FLAG_THRESHOLD_APPROVED flags to be pulled again.
  moderateOk = (photo: PartyPixPhoto) => {
    action(() => {
      photo.approved = true;
      this.flaggedPhotos.remove(photo);
      if (!this.photos.includes(photo)) this.photos.push(photo);
      if (this.gameState === PresenterGameState.Gathering && this.photos.length > 0) {
        if (this.folderDecided) this.gameState = PartyPixGameState.Slideshow;
      }
    })();
    this.pushSlide();
    this.saveCheckpoint();
  };

  // Host moderation: permanently ban a photo — removed everywhere, its file
  // deleted, and its content hash blocked so it can't be re-uploaded.
  moderateBan = (photo: PartyPixPhoto) => {
    photo.removed = true; // a still-in-flight disk write will clean up after itself
    action(() => {
      this.bannedHashes.add(photo.hash);
      this.flaggedPhotos.remove(photo);
      this.spliceFromActive(photo);
    })();
    if (photo.fileName && this.photoStore.hasFolder()) {
      void this.photoStore.forget(photo.fileName);
    }
    this.invokeEvent(PartyPixGameEvent.PhotoDeleted, photo);
    this.pushSlide();
    this.saveCheckpoint();
  };

  // Jump the slideshow to a specific active photo and resume from there.
  jumpToPhoto = (photo: PartyPixPhoto) => {
    const idx = this.photos.indexOf(photo);
    if (idx < 0) return;
    action(() => {
      this.currentIndex = idx;
      this._nextSlideAt = this.gameTime_ms + SLIDE_INTERVAL_MS;
    })();
    this.pushSlide();
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
