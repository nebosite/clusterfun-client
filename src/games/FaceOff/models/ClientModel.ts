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
import { FaceOffGameState } from "./PresenterModel";
import {
  FaceOffOnboardEndpoint,
  FaceOffSubmitPhotoEndpoint,
  FaceOffVoteEndpoint,
  FaceOffSnapNowEndpoint,
  type FaceOffSnapNowMessage,
  type FaceOffRole,
  type VotableMatchupInfo,
  type StandingInfo,
} from "./faceOffEndpoints";
import type { PromptInfo } from "./prompts";

// Dev fallback: in the Test Lobby (REACT_APP_DEVMODE=development) a device with no real camera
// is still treated as camera-capable so the whole capture loop is playable on desktop and
// drivable by the headless verifier. In production this is false, honoring "no camera → judge".
const DEV = process.env.REACT_APP_DEVMODE === "development";

export enum FaceOffClientState {
  Capturing = "Capturing", // contestant: frame + snap; judge: "get ready to judge"
  Voting = "Voting", // vote the matchups you're not in
  Watching = "Watching", // reveal + scoreboard: watch the big screen
}

// -------------------------------------------------------------------
// Type helper (save/restore). Persist the small scalars; skip the transient/heavy bits —
// `votableMatchups` carries base64 thumbs (localStorage quota) and `myVotes` is a Map; both
// are re-pulled from the presenter on onboard.
// -------------------------------------------------------------------
export const getFaceOffClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "FaceOffClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case FaceOffClientModel:
          return "FaceOffClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "FaceOffClientModel":
          return new FaceOffClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof FaceOffClientModel) {
        if (["votableMatchups", "myVotes", "standings"].indexOf(propertyName) !== -1) return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Client model — the phone. Thin controller: reports camera capability, captures/submits a
// photo on the presenter's snap, and votes. The presenter is authoritative; this holds an
// optimistic view fully rebuilt from each onboard response.
// -------------------------------------------------------------------
export class FaceOffClientModel extends ClusterfunClientModel {
  @observable hasCamera = DEV; // dev default true; refined by detectCamera() for real devices
  @observable role: FaceOffRole = "judge";
  @observable round = 0;
  @observable totalRounds = 0;
  @observable roundId = 0;
  @observable prompt: PromptInfo | null = null; // my secret prompt (contestant only)
  @observable submitted = false;
  @observable needCamera = false;
  @observable votableMatchups: VotableMatchupInfo[] = [];
  @observable standings: StandingInfo[] = [];
  myVotes = observable.map<string, string>(); // matchupId -> chosen entryId
  @observable captureDeadline = 0; // epoch ms the snap countdown ends (0 = none)
  @observable snapNonce = 0; // bumped on SnapNow so the view grabs a live frame

  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("FaceOffClient", sessionHelper, playerName, logger, storage);
    makeObservable(this);
  }

  reconstitute() {
    super.reconstitute();
    this.listenToEndpointFromPresenter(FaceOffSnapNowEndpoint, this.handleSnapNow);
    void this.detectCamera();
  }

  // Detect a real camera (production gate). In dev the fallback already made hasCamera true;
  // if detection changes the value, re-onboard so the presenter has the right capability
  // before it assigns roles for the next round.
  private async detectCamera() {
    let real = false;
    try {
      const md = navigator.mediaDevices;
      if (md && md.enumerateDevices) {
        const devices = await md.enumerateDevices();
        real = devices.some((d) => d.kind === "videoinput");
      }
    } catch (err) {
      real = false;
    }
    const has = real || DEV;
    if (has !== this.hasCamera) {
      action(() => {
        this.hasCamera = has;
      })();
      await this.requestGameStateFromPresenter();
    }
  }

  // Seconds left in the snap countdown (UX only; the actual capture is presenter-triggered).
  get snapSecondsLeft(): number {
    if (this.captureDeadline <= 0) return 0;
    return Math.max(0, Math.ceil((this.captureDeadline - Date.now()) / 1000));
  }

  async requestGameStateFromPresenter(): Promise<void> {
    const res = await this.session.requestPresenter(FaceOffOnboardEndpoint, {
      hasCamera: this.hasCamera,
    });
    action(() => {
      this.round = res.round;
      this.totalRounds = res.totalRounds;
      this.role = res.role;
      this.roundId = res.roundId;
      this.prompt = res.prompt;
      this.submitted = res.submitted;
      this.needCamera = res.needCamera;
      this.votableMatchups = res.votableMatchups;
      this.standings = res.standings;
      this.myVotes.clear();
      res.myVotes.forEach((v) => this.myVotes.set(v.matchupId, v.entryId));
      this.captureDeadline = res.countdownMsLeft > 0 ? Date.now() + res.countdownMsLeft : 0;
      this.assignClientState(res.state);
    })();
    this.saveCheckpoint();
  }

  private assignClientState(serverState: string) {
    switch (serverState) {
      case FaceOffGameState.Capturing:
        this.gameState = FaceOffClientState.Capturing;
        break;
      case FaceOffGameState.Voting:
        this.gameState = FaceOffClientState.Voting;
        break;
      case FaceOffGameState.Revealing:
      case FaceOffGameState.RoundScoreboard:
        this.gameState = FaceOffClientState.Watching;
        break;
      case GeneralGameState.GameOver:
        this.gameState = GeneralGameState.GameOver;
        break;
      case PresenterGameState.Gathering:
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
      default:
        Logger.debug(`FaceOff client: unmapped server state ${serverState}`);
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
    }
  }

  // -------------------------------------------------------------------
  //  Capture
  // -------------------------------------------------------------------
  // Presenter fired the snap: bump the nonce so the contestant view grabs the current live
  // frame. Ignored if not a contestant this round, already submitted, or a stale round.
  handleSnapNow = (message: FaceOffSnapNowMessage) => {
    if (message.roundId !== this.roundId) return;
    if (this.role !== "contestant" || this.submitted) return;
    action(() => {
      this.snapNonce++;
    })();
  };

  // Submit a captured pair (from the live snap or a picked file). Optimistically marks
  // submitted; rolls back if the presenter rejects it.
  async submitPair(full: string, thumb: string): Promise<{ accepted: boolean; error?: string }> {
    if (this.submitted) return { accepted: true };
    action(() => {
      this.submitted = true;
    })();
    try {
      const res = await this.session.requestPresenter(FaceOffSubmitPhotoEndpoint, {
        roundId: this.roundId,
        full,
        thumb,
      });
      if (!res.accepted) {
        action(() => {
          this.submitted = false;
        })();
      }
      this.saveCheckpoint();
      return res;
    } catch (err) {
      Logger.warn(`Submit failed: ${err}`);
      action(() => {
        this.submitted = false;
      })();
      return { accepted: false, error: "Submit failed — try again." };
    }
  }

  // -------------------------------------------------------------------
  //  Voting
  // -------------------------------------------------------------------
  async vote(matchupId: string, entryId: string): Promise<void> {
    action(() => {
      this.myVotes.set(matchupId, entryId); // optimistic
    })();
    try {
      await this.session.requestPresenter(FaceOffVoteEndpoint, { matchupId, entryId });
    } catch (err) {
      Logger.warn(`Vote failed: ${err}`);
    }
  }
}
