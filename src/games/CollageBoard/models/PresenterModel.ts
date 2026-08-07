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
  GeneralGameState,
  ReconnectInfo,
} from "libs";
import Logger from "js-logger";
import { InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";
import {
  CollageBoardOnboardEndpoint,
  CollageBoardOnboardResponse,
  CollageBoardClaimZoneEndpoint,
  CollageBoardClaimZoneRequest,
  CollageBoardClaimZoneResponse,
  CollageBoardReleaseZoneEndpoint,
  CollageBoardReleaseZoneRequest,
  CollageBoardCommitPhotoEndpoint,
  CollageBoardCommitPhotoRequest,
  CollageBoardCommitPhotoResponse,
  CollageBoardZonesPushEndpoint,
  CollageBoardPreviewPushEndpoint,
  CollageZoneInfo,
} from "./collageBoardEndpoints";
import {
  ZonePoint,
  ZoneBounds,
  polygonBounds,
  prepareZonePoints,
  validateZone,
  pickPlayerColor,
  expiredZoneIds,
} from "./collageBoardLogic";
import {
  PLAYER_COLORS,
  MIN_ZONE_POINTS,
  MAX_ZONE_POINTS,
  MIN_ZONE_AREA,
  SIMPLIFY_EPSILON,
  ZONE_LIFETIME_MS,
  MAX_COMMIT_IMAGE_CHARS,
  MAX_PATCHES,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  PREVIEW_QUALITY,
  PREVIEW_PUSH_MIN_INTERVAL_MS,
} from "./GameSettings";

// The presenter's record for one player.  The identity color drives the phone
// banner and every outline this player draws.
export class CollageBoardPlayer extends ClusterFunPlayer {
  @observable color = "#ffffff";
  @observable photosTaken = 0;

  constructor() {
    super();
    makeObservable(this);
  }
}

// An active claim: one player lining up a shot over one outline.
export class CollageZone {
  zoneId = "";
  playerId = "";
  points: ZonePoint[] = [];
  claimedAt = 0; // presenter gameTime_ms at claim
}

// One committed photo: a JPEG of the outline's bounding box, painted clipped
// to the polygon.  Patches accumulate in commit order (newest paints over).
export class CollagePatch {
  patchId = "";
  authorId = "";
  points: ZonePoint[] = [];
  bounds: ZoneBounds = { x: 0, y: 0, width: 0, height: 0 };
  image = ""; // JPEG data URL
}

// -------------------------------------------------------------------
// The Game state - CollageBoard is continuous: Gathering, then Playing
// until the host quits.
// -------------------------------------------------------------------
export enum CollageBoardGameState {
  Playing = "Playing",
}

// -------------------------------------------------------------------
// Game events - in-process notifications the views subscribe to,
// mostly to trigger sounds.
// -------------------------------------------------------------------
export enum CollageBoardGameEvent {
  ZoneClaimed = "ZoneClaimed",
  PhotoCommitted = "PhotoCommitted",
}

// -------------------------------------------------------------------
// Create the typehelper needed for loading and saving the game.
// Patches and zones are intentionally NOT serialized: patch images are
// base64 JPEGs that would blow the localStorage quota (PartyPix precedent),
// and claims are stale after a refresh anyway.  Players (with their colors)
// do persist.
// -------------------------------------------------------------------
export const getCollageBoardPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "CollageBoardPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case CollageBoardPresenterModel:
          return "CollageBoardPresenterModel";
        case CollageBoardPlayer:
          return "CollageBoardPlayer";
        case CollageZone:
          return "CollageZone";
        case CollagePatch:
          return "CollagePatch";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "CollageBoardPresenterModel":
          return new CollageBoardPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "CollageBoardPlayer":
          return new CollageBoardPlayer();
        case "CollageZone":
          return new CollageZone();
        case "CollagePatch":
          return new CollagePatch();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof CollageBoardPresenterModel) {
        const doNotSerializeMe = [
          "zones",
          "patches",
          "previewJpeg",
          "_patchImages",
          "_previewCanvas",
          "_previewTimer",
          "_previewRebuildQueued",
          "_lastPreviewPushTime",
        ];
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
// presenter data and logic
// The presenter owns the collage: the ordered patch list, the active
// claims, and the downscaled preview phones navigate over.
// -------------------------------------------------------------------
export class CollageBoardPresenterModel extends ClusterfunPresenterModel<CollageBoardPlayer> {
  zones = observable<CollageZone>([]);
  patches = observable<CollagePatch>([]);
  @observable previewJpeg: string | null = null;

  private _zoneSerial = 0;
  private _patchSerial = 0;

  // Compositing scratch state - browser-only, never serialized.
  private _previewCanvas: HTMLCanvasElement | null = null;
  private _patchImages = new Map<string, HTMLImageElement>();
  private _previewTimer: ReturnType<typeof setTimeout> | null = null;
  private _previewRebuildQueued = false;
  private _lastPreviewPushTime = 0;

  // -------------------------------------------------------------------
  //  onPlayerReturned - their claim is still their claim.
  //
  //  `CollageZone.playerId` and `CollagePatch.authorId` are stable player ids, and every
  //  lookup in here matches on `p.playerId === sender`, so a phone that drops mid-shot comes
  //  back still owning the outline it was lining up. Their committed patches were never in
  //  question - those are pixels on the board.
  //
  //  Known gap, left alone deliberately because it belongs to onPlayerDisconnected rather
  //  than here: a zone claimed by somebody who never comes back stays claimed, and nothing
  //  reaps it.
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: CollageBoardPlayer, _info: ReconnectInfo) {}

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("CollageBoard", sessionHelper, logger, storage);
    Logger.info(`Constructing CollageBoardPresenterModel ${this.gameState}`);

    this.allowedJoinStates = [PresenterGameState.Gathering, CollageBoardGameState.Playing];
    this.minPlayers = 1;
    this.maxPlayers = PLAYER_COLORS.length; // colors stay unique per player
    this.totalRounds = 1;
  }

  // -------------------------------------------------------------------
  //  reconstitute - wire up message listeners (runs on fresh construction
  //  AND after restoring a saved game)
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpoint(CollageBoardOnboardEndpoint, this.handleOnboard);
    this.listenToEndpoint(CollageBoardClaimZoneEndpoint, this.handleClaimZone);
    this.listenToEndpoint(CollageBoardReleaseZoneEndpoint, this.handleReleaseZone);
    this.listenToEndpoint(CollageBoardCommitPhotoEndpoint, this.handleCommitPhoto);
  }

  // -------------------------------------------------------------------
  //  createFreshPlayerEntry - assign the least-used identity color
  // -------------------------------------------------------------------
  createFreshPlayerEntry(name: string, id: string): CollageBoardPlayer {
    const newPlayer = new CollageBoardPlayer();
    newPlayer.playerId = id;
    newPlayer.name = name;
    newPlayer.color = pickPlayerColor(
      this.players.map((p) => p.color),
      PLAYER_COLORS,
    );
    return newPlayer;
  }

  // -------------------------------------------------------------------
  //  prepareFreshGame
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
    action(() => {
      this.zones.clear();
      this.patches.clear();
      this.previewJpeg = null;
    })();
    this._patchImages.clear();
    this.players.forEach((p) => (p.photosTaken = 0));
  };

  // -------------------------------------------------------------------
  //  prepareFreshRound - continuous game, nothing per-round
  // -------------------------------------------------------------------
  prepareFreshRound = () => {};

  // -------------------------------------------------------------------
  //  startNextRound - there is only one "round": Playing, forever
  // -------------------------------------------------------------------
  startNextRound = () => {
    this.currentRound = 1;
    this.gameState = CollageBoardGameState.Playing;
    this.timeOfStageEnd = Number.MAX_SAFE_INTEGER; // no stage timer
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  handleTick - expire abandoned claims
  // -------------------------------------------------------------------
  handleTick() {
    if (this.gameState !== CollageBoardGameState.Playing) return;
    const expired = expiredZoneIds(this.zones, this.gameTime_ms, ZONE_LIFETIME_MS);
    if (expired.length > 0) {
      action(() => {
        expired.forEach((id) => {
          const zone = this.zones.find((z) => z.zoneId === id);
          if (zone) this.zones.remove(zone);
        });
      })();
      this.pushZones();
    }
  }

  // -------------------------------------------------------------------
  //  zoneInfos - active claims decorated with owner name/color
  // -------------------------------------------------------------------
  zoneInfos(): CollageZoneInfo[] {
    return this.zones.map((zone) => {
      const owner = this.players.find((p) => p.playerId === zone.playerId);
      return {
        zoneId: zone.zoneId,
        playerId: zone.playerId,
        playerName: owner?.name ?? "?",
        color: owner?.color ?? "#ffffff",
        points: zone.points,
      };
    });
  }

  // -------------------------------------------------------------------
  //  handleOnboard - answer a client's request for full state
  // -------------------------------------------------------------------
  handleOnboard = (sender: string, message: unknown): CollageBoardOnboardResponse => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    const player = this.players.find((p) => p.playerId === sender);
    return {
      state: this.gameState,
      playerColor: player?.color ?? "#ffffff",
      preview: this.previewJpeg,
      zones: this.zoneInfos(),
    };
  };

  // -------------------------------------------------------------------
  //  handleClaimZone - validate the outline and register the claim.
  //  Claims are advisory: overlapping claims by different players are fine,
  //  but a player claiming again replaces their previous zone.
  // -------------------------------------------------------------------
  handleClaimZone = (
    sender: string,
    message: CollageBoardClaimZoneRequest,
  ): CollageBoardClaimZoneResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) return { granted: false, reason: "You are not in this game" };
    if (this.gameState !== CollageBoardGameState.Playing) {
      return { granted: false, reason: "The game hasn't started yet" };
    }

    const points = prepareZonePoints(message.points ?? [], SIMPLIFY_EPSILON, MAX_ZONE_POINTS);
    const verdict = validateZone(points, MIN_ZONE_POINTS, MAX_ZONE_POINTS, MIN_ZONE_AREA);
    if (!verdict.ok) return { granted: false, reason: verdict.reason };

    const zone = new CollageZone();
    zone.zoneId = `z${++this._zoneSerial}`;
    zone.playerId = sender;
    zone.points = points;
    zone.claimedAt = this.gameTime_ms;

    action(() => {
      // One active zone per player - a new claim replaces the old one
      const previous = this.zones.find((z) => z.playerId === sender);
      if (previous) this.zones.remove(previous);
      this.zones.push(zone);
    })();

    this.invokeEvent(CollageBoardGameEvent.ZoneClaimed, player);
    this.pushZones();
    return { granted: true, zoneId: zone.zoneId };
  };

  // -------------------------------------------------------------------
  //  handleReleaseZone - fire-and-forget: never throw, just log
  // -------------------------------------------------------------------
  handleReleaseZone = (sender: string, message: CollageBoardReleaseZoneRequest) => {
    const zone = this.zones.find((z) => z.zoneId === message.zoneId && z.playerId === sender);
    if (!zone) {
      Logger.debug(`Release for unknown/foreign zone ${message.zoneId} from ${sender}`);
      return;
    }
    action(() => this.zones.remove(zone))();
    this.pushZones();
  };

  // -------------------------------------------------------------------
  //  handleCommitPhoto - paint a captured image into the collage
  // -------------------------------------------------------------------
  handleCommitPhoto = (
    sender: string,
    message: CollageBoardCommitPhotoRequest,
  ): CollageBoardCommitPhotoResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) return { ok: false, reason: "You are not in this game" };

    const zone = this.zones.find((z) => z.zoneId === message.zoneId && z.playerId === sender);
    if (!zone) return { ok: false, reason: "That zone is no longer selected" };

    const image = message.image ?? "";
    if (!image.startsWith("data:image/")) return { ok: false, reason: "Bad image data" };
    if (image.length > MAX_COMMIT_IMAGE_CHARS) return { ok: false, reason: "Image is too large" };

    const patch = new CollagePatch();
    patch.patchId = `p${++this._patchSerial}`;
    patch.authorId = sender;
    patch.points = zone.points;
    patch.bounds = polygonBounds(zone.points);
    patch.image = image;

    action(() => {
      this.patches.push(patch);
      while (this.patches.length > MAX_PATCHES) {
        const oldest = this.patches[0];
        this._patchImages.delete(oldest.patchId);
        this.patches.remove(oldest);
      }
      this.zones.remove(zone);
      player.photosTaken++;
    })();

    this.invokeEvent(CollageBoardGameEvent.PhotoCommitted, player);
    this.pushZones();
    this.schedulePreviewRebuild();
    this.saveCheckpoint(); // players' photo counts persist
    return { ok: true };
  };

  // -------------------------------------------------------------------
  //  pushZones - broadcast the active claim set
  // -------------------------------------------------------------------
  private pushZones() {
    const zones = this.zoneInfos();
    this.sendToEveryone(CollageBoardZonesPushEndpoint, () => ({ zones }));
  }

  // -------------------------------------------------------------------
  //  Preview compositing.  The presenter re-renders a small composite of
  //  the collage off-screen and pushes it to phones (throttled).  Browser
  //  canvas glue - guarded so it degrades to a no-op under test/jsdom.
  // -------------------------------------------------------------------
  private schedulePreviewRebuild() {
    if (typeof document === "undefined") return;
    if (this._previewRebuildQueued) return;
    this._previewRebuildQueued = true;
    setTimeout(() => {
      this._previewRebuildQueued = false;
      this.rebuildPreview();
    }, 50);
  }

  private async rebuildPreview() {
    try {
      if (!this._previewCanvas) {
        this._previewCanvas = document.createElement("canvas");
        this._previewCanvas.width = PREVIEW_WIDTH;
        this._previewCanvas.height = PREVIEW_HEIGHT;
      }
      const ctx = this._previewCanvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#14181d";
      ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

      for (const patch of this.patches.slice()) {
        const img = await this.getPatchImage(patch);
        if (!img) continue;
        ctx.save();
        ctx.beginPath();
        patch.points.forEach((p, i) => {
          const px = p.x * PREVIEW_WIDTH;
          const py = p.y * PREVIEW_HEIGHT;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(
          img,
          patch.bounds.x * PREVIEW_WIDTH,
          patch.bounds.y * PREVIEW_HEIGHT,
          patch.bounds.width * PREVIEW_WIDTH,
          patch.bounds.height * PREVIEW_HEIGHT,
        );
        ctx.restore();
      }

      const jpeg = this._previewCanvas.toDataURL("image/jpeg", PREVIEW_QUALITY);
      action(() => {
        this.previewJpeg = jpeg;
      })();
      this.pushPreviewThrottled();
    } catch (err) {
      Logger.warn(`Preview rebuild failed: ${err}`);
    }
  }

  private getPatchImage(patch: CollagePatch): Promise<HTMLImageElement | null> {
    const cached = this._patchImages.get(patch.patchId);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this._patchImages.set(patch.patchId, img);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = patch.image;
    });
  }

  private pushPreviewThrottled() {
    const now = Date.now();
    const since = now - this._lastPreviewPushTime;
    if (since >= PREVIEW_PUSH_MIN_INTERVAL_MS) {
      this._lastPreviewPushTime = now;
      this.pushPreviewNow();
    } else if (!this._previewTimer) {
      this._previewTimer = setTimeout(() => {
        this._previewTimer = null;
        this._lastPreviewPushTime = Date.now();
        this.pushPreviewNow();
      }, PREVIEW_PUSH_MIN_INTERVAL_MS - since);
    }
  }

  private pushPreviewNow() {
    const preview = this.previewJpeg;
    if (!preview) return;
    if (this.gameState === GeneralGameState.Destroyed) return;
    this.sendToEveryone(CollageBoardPreviewPushEndpoint, () => ({ preview }));
  }
}
