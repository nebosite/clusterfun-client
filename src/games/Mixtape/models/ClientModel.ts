import Logger from "js-logger";
import { action, makeObservable, observable } from "mobx";
import {
  ISessionHelper,
  ClusterFunGameProps,
  ClusterfunClientModel,
  ITelemetryLogger,
  IStorage,
  GeneralClientGameState,
  GeneralGameState,
  ITypeHelper,
} from "libs";
import { MixtapeGameState } from "./PresenterModel";
import {
  MixtapeOnboardClientEndpoint,
  MixtapeSubmitSongEndpoint,
  MixtapeSubmitBallotEndpoint,
  MixtapeScoreInfo,
  MixtapeVoteSong,
  MixtapeSubmissionInfo,
} from "./mixtapeEndpoints";
import { getMusicProvider, MusicProvider, Track } from "./musicProvider";
import { clampStartSec, sanitizeRanking } from "./mixtapeLogic";
import { MAX_BALLOT } from "./GameSettings";

// -------------------------------------------------------------------
// Type helper for save/restore.  The music provider and the transient
// search UI state are NOT serialized (the provider is an unregistered
// class instance; the search results are a throwaway cache).  The ctor
// recreates the provider, and shouldStringify=false leaves it untouched
// on restore, so a refreshed phone keeps a working provider.
// -------------------------------------------------------------------
export const getMixtapeClientTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "MixtapeClientModel",
    getTypeName(o: object) {
      switch (o.constructor) {
        case MixtapeClientModel:
          return "MixtapeClientModel";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "MixtapeClientModel":
          return new MixtapeClientModel(
            sessionHelper,
            gameProps.playerName || "Player",
            gameProps.logger,
            gameProps.storage,
          );
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof MixtapeClientModel) {
        const doNotSerializeMe = [
          "provider",
          "searchResults",
          "searching",
          "searchError",
          "selectedTrack",
          "pendingStartSec",
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

// Client-side states.  Selecting / Voting have real input UI; everything else the phone
// just watches the big screen (Watching).
export enum MixtapeClientState {
  Selecting = "Selecting",
  Voting = "Voting",
  Watching = "Watching",
}

// -------------------------------------------------------------------
// Client - a thin controller.  It searches for songs (directly against
// the MusicProvider, never the relay), cues one up, and ranks the
// round's songs.  The presenter owns every authoritative decision.
// -------------------------------------------------------------------
export class MixtapeClientModel extends ClusterfunClientModel {
  // Authoritative state, rebuilt from each onboard response.
  @observable prompt = "";
  @observable targetScore = 0;
  @observable scores: MixtapeScoreInfo[] = [];
  @observable mySubmission: MixtapeSubmissionInfo | null = null;
  @observable votingSongs: MixtapeVoteSong[] = [];
  @observable myOwnVideoId: string | null = null;
  @observable myBallot: string[] = [];
  @observable presentCount = 0;
  @observable submittedCount = 0;
  @observable votedCount = 0;
  // True once this player has submitted a ballot this round.  Drives the "Change your vote?"
  // affordance: the submit button fades out and, when tapped, re-opens editing for a re-submit.
  @observable voteSubmitted = false;

  // Transient search/cue UI state (never serialized - see the type helper).
  provider: MusicProvider = getMusicProvider();
  searchResults = observable<Track>([]);
  @observable searching = false;
  @observable searchError = "";
  @observable selectedTrack: Track | null = null;
  @observable pendingStartSec = 0;

  get providerKind(): "youtube" | "mock" {
    return this.provider.kind;
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    sessionHelper: ISessionHelper,
    playerName: string,
    logger: ITelemetryLogger,
    storage: IStorage,
  ) {
    super("MixtapeClient", sessionHelper, playerName, logger, storage);
    // Each subclass with its own @observable fields must call makeObservable, or those
    // fields are inert in MobX 6 (the view never re-renders on an isolated change like
    // selecting a track).  The base classes only annotate their own fields.
    makeObservable(this);
  }

  reconstitute() {
    super.reconstitute();
  }

  // -------------------------------------------------------------------
  //  requestGameStateFromPresenter - the ONLY state-sync path.  Fully
  //  rebuilds phone state from the onboard response (pushes can be missed).
  // -------------------------------------------------------------------
  async requestGameStateFromPresenter(): Promise<void> {
    const r = await this.session.requestPresenter(MixtapeOnboardClientEndpoint, {});
    action(() => {
      this.prompt = r.prompt;
      this.targetScore = r.targetScore;
      this.scores = r.scores;
      this.mySubmission = r.mySubmission;
      this.votingSongs = r.votingSongs;
      this.myOwnVideoId = r.myOwnVideoId;
      this.myBallot = r.myBallot ?? [];
      this.presentCount = r.presentCount;
      this.submittedCount = r.submittedCount;
      this.votedCount = r.votedCount;
    })();

    switch (r.gameState) {
      case MixtapeGameState.Selecting:
        this.gameState = MixtapeClientState.Selecting;
        break;
      case MixtapeGameState.Voting:
        // A ballot already on the presenter (e.g. after a refresh) shows as "submitted".
        action(() => (this.voteSubmitted = (r.myBallot ?? []).length > 0))();
        this.gameState = MixtapeClientState.Voting;
        break;
      case MixtapeGameState.PromptReveal:
      case MixtapeGameState.Playback:
      case MixtapeGameState.Tally:
      case MixtapeGameState.Scoreboard:
        this.gameState = MixtapeClientState.Watching;
        break;
      case GeneralGameState.GameOver:
        this.gameState = GeneralGameState.GameOver;
        break;
      default:
        Logger.debug(`Presenter is in state: ${r.gameState}`);
        this.gameState = GeneralClientGameState.WaitingToStart;
        break;
    }
    this.saveCheckpoint();
  }

  // -------------------------------------------------------------------
  //  Search + cue (Selecting)
  // -------------------------------------------------------------------
  async doSearch(query: string): Promise<void> {
    action(() => {
      this.searching = true;
      this.searchError = "";
    })();
    try {
      const results = await this.provider.search(query);
      action(() => this.searchResults.replace(results))();
    } catch (err) {
      Logger.warn(`Mixtape search failed: ${err}`);
      action(() => {
        this.searchError = "Search failed - try again";
        this.searchResults.clear();
      })();
    } finally {
      action(() => (this.searching = false))();
    }
  }

  selectTrack(track: Track) {
    action(() => {
      this.selectedTrack = track;
      this.pendingStartSec = 0;
    })();
  }

  clearSelection() {
    action(() => (this.selectedTrack = null))();
  }

  setStartSec(sec: number) {
    const dur = this.selectedTrack?.durationSec ?? 0;
    action(() => (this.pendingStartSec = clampStartSec(sec, dur)))();
  }

  async submitSelected(): Promise<boolean> {
    const t = this.selectedTrack;
    if (!t) return false;
    const res = await this.session.requestPresenter(MixtapeSubmitSongEndpoint, {
      videoId: t.videoId,
      title: t.title,
      artist: t.artist,
      thumbnailUrl: t.thumbnailUrl,
      durationSec: t.durationSec,
      startSec: this.pendingStartSec,
    });
    if (res.accepted) {
      action(() => {
        this.mySubmission = {
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          thumbnailUrl: t.thumbnailUrl,
          durationSec: t.durationSec,
          startSec: res.startSec ?? this.pendingStartSec,
        };
        this.selectedTrack = null;
      })();
      this.saveCheckpoint();
    }
    return res.accepted;
  }

  // -------------------------------------------------------------------
  //  Ranking (Voting).  Tapping a song toggles it in/out of the ballot;
  //  a new tap appends at the next rank (up to MAX_BALLOT).  The player's
  //  own song is never rankable.
  // -------------------------------------------------------------------
  rankOf(videoId: string): number {
    const i = this.myBallot.indexOf(videoId);
    return i < 0 ? 0 : i + 1;
  }

  toggleRank(videoId: string) {
    if (videoId === this.myOwnVideoId) return;
    if (this.voteSubmitted) return; // locked until the player chooses to change their vote
    const current = this.myBallot.slice();
    const i = current.indexOf(videoId);
    if (i >= 0) {
      current.splice(i, 1);
    } else if (current.length < MAX_BALLOT) {
      current.push(videoId);
    }
    action(() => (this.myBallot = current))();
  }

  // Re-open the ballot after submitting so the player can adjust and re-submit.
  undoVote() {
    action(() => (this.voteSubmitted = false))();
  }

  async submitBallot(): Promise<boolean> {
    const validIds = this.votingSongs.map((s) => s.videoId);
    const ranking = sanitizeRanking(this.myBallot, validIds, this.myOwnVideoId, MAX_BALLOT);
    if (ranking.length < 1) return false;
    const res = await this.session.requestPresenter(MixtapeSubmitBallotEndpoint, { ranking });
    if (res.accepted && res.ranking) {
      action(() => {
        this.myBallot = res.ranking as string[];
        this.voteSubmitted = true;
      })();
      this.saveCheckpoint();
    }
    return res.accepted;
  }
}
