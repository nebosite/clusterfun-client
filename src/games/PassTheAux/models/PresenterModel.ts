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
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";
import {
  PassTheAuxOnboardClientEndpoint,
  PassTheAuxOnboardResponse,
  PassTheAuxSubmitSongEndpoint,
  PassTheAuxSubmitSongRequest,
  PassTheAuxSubmitSongResponse,
  PassTheAuxSubmitBallotEndpoint,
  PassTheAuxSubmitBallotRequest,
  PassTheAuxSubmitBallotResponse,
} from "./passTheAuxEndpoints";
import {
  clampStartSec,
  sanitizeRanking,
  runInstantRunoff,
  findWinnersByScore,
  hasReachedTarget,
  shuffled,
  IRVOutcome,
  Ballot,
} from "./passTheAuxLogic";
import { PASS_THE_AUX_PROMPTS } from "./prompts";
import {
  DEFAULT_TARGET_SCORE,
  MIN_TARGET_SCORE,
  MAX_TARGET_SCORE,
  SONG_PLAY_MS,
  TALLY_STEP_MS,
  TALLY_TAIL_MS,
  MAX_BALLOT,
} from "./GameSettings";

// A player's cued-up song for the current round (plain object, small, safe to serialize).
export interface PlayerSubmission {
  videoId: string;
  title: string;
  artist: string;
  thumbnailUrl: string;
  durationSec: number;
  startSec: number;
}

// A submission snapshotted into the round's playback/voting order, tagged with its author.
export interface RoundSong extends PlayerSubmission {
  submitterId: string;
}

// One finished round, kept for the GameOver "links" screen.
export interface PassTheAuxRoundLink {
  prompt: string;
  songs: { videoId: string; title: string; artist: string; submitterName: string }[];
  winnerVideoId: string;
}

// The presenter's record for one player.  @observable fields drive the presenter UI.
// ClusterFunPlayer does NOT call makeObservable, so this subclass MUST (else these fields
// are inert in MobX 6 and the presenter shows stale scores/submitted-status).
export class PassTheAuxPlayer extends ClusterFunPlayer {
  @observable score = 0;
  @observable submission: PlayerSubmission | null = null;
  @observable ballot: string[] = []; // ordered videoIds, this round

  constructor() {
    super();
    makeObservable(this);
  }
}

// -------------------------------------------------------------------
// The per-round presenter phases.  (Gathering / Paused / GameOver come
// from the framework enums.)
// -------------------------------------------------------------------
export enum PassTheAuxGameState {
  PromptReveal = "PromptReveal",
  Selecting = "Selecting",
  Playback = "Playback",
  Voting = "Voting",
  Tally = "Tally",
  Scoreboard = "Scoreboard",
}

// In-process notifications the views subscribe to (mostly to trigger sounds).
export enum PassTheAuxGameEvent {
  SongSubmitted = "SongSubmitted",
  BallotReceived = "BallotReceived",
  PlaybackStarted = "PlaybackStarted",
  SongAdvanced = "SongAdvanced",
  TallyStarted = "TallyStarted",
  RoundWinner = "RoundWinner",
  ScoreChanged = "ScoreChanged",
  WinnerAnnounced = "WinnerAnnounced",
}

// -------------------------------------------------------------------
// Type helper for save/restore.  PassTheAuxPlayer is the only custom class
// (submissions / round records are plain objects).  Nothing here is large
// (thumbnails are URLs, not base64), so everything is serialized; roundSongs
// is re-wrapped as a MobX observable array on the way back in.
// -------------------------------------------------------------------
export const getPassTheAuxPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "PassTheAuxPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case PassTheAuxPresenterModel:
          return "PassTheAuxPresenterModel";
        case PassTheAuxPlayer:
          return "PassTheAuxPlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "PassTheAuxPresenterModel":
          return new PassTheAuxPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "PassTheAuxPlayer":
          return new PassTheAuxPlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      if (typeName === "PassTheAuxPresenterModel" && propertyName === "roundSongs") {
        return observable<RoundSong>((rehydratedObject as RoundSong[]) ?? []);
      }
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Presenter — the single source of truth.  Owns the prompt deck, the
// round's songs, the jukebox timeline, the IRV tally, and the scores.
// -------------------------------------------------------------------
export class PassTheAuxPresenterModel extends ClusterfunPresenterModel<PassTheAuxPlayer> {
  @observable targetScore = DEFAULT_TARGET_SCORE;
  @observable prompt = "";
  @observable currentSongIndex = -1;
  @observable winnerVideoId: string | null = null;
  @observable roundScored = false;

  // Plain data (not decorator-observable): the shuffled prompt deck and the finished-round
  // history for the GameOver links screen.  Read on state transitions, so plain is fine.
  promptDeck: string[] = [];
  roundHistory: PassTheAuxRoundLink[] = [];
  tallyOutcome: IRVOutcome | null = null;

  // The round's songs in playback == voting order (observable so the jukebox re-renders).
  roundSongs = observable<RoundSong>([]);

  // -------------------------------------------------------------------
  //  onPlayerReturned - nothing to migrate, and that is the answer.
  //
  //  Everything this game keeps about a player - `score`, this round's `submission`, and
  //  their `ballot` - lives on the PassTheAuxPlayer object, which stays in `players` with
  //  its state while they are gone and keeps its permanent `playerId`. So a phone coming
  //  back is still the same player to every part of the game.
  //
  //  The phone pulls the round, the songs and its own ballot back through
  //  PassTheAuxOnboardClientEndpoint on rejoin, so there is nothing to push at it here.
  // -------------------------------------------------------------------
  protected onPlayerReturned(_player: PassTheAuxPlayer, _info: ReconnectInfo) {}

  // -------------------------------------------------------------------
  // Derived views over the state.
  // -------------------------------------------------------------------
  get winners(): PassTheAuxPlayer[] {
    return findWinnersByScore(this.players.slice());
  }
  get currentSong(): RoundSong | null {
    return this.roundSongs[this.currentSongIndex] ?? null;
  }
  get presentCount(): number {
    return this.players.length;
  }
  get submittedCount(): number {
    return this.players.filter((p) => p.submission).length;
  }
  get votedCount(): number {
    return this.players.filter((p) => p.ballot.length > 0).length;
  }
  get allSubmitted(): boolean {
    return this.players.length > 0 && this.players.every((p) => p.submission);
  }
  get allVoted(): boolean {
    return this.players.length > 0 && this.players.every((p) => p.ballot.length > 0);
  }
  get gameOverPending(): boolean {
    return hasReachedTarget(this.players, this.targetScore);
  }
  submitterName(id: string): string {
    return this.players.find((p) => p.playerId === id)?.name ?? "?";
  }

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("PassTheAux", sessionHelper, logger, storage);
    Logger.info(`Constructing PassTheAuxPresenterModel ${this.gameState}`);

    this.allowedJoinStates = [
      PresenterGameState.Gathering,
      PassTheAuxGameState.PromptReveal,
      PassTheAuxGameState.Selecting,
      PassTheAuxGameState.Playback,
      PassTheAuxGameState.Voting,
      PassTheAuxGameState.Tally,
      PassTheAuxGameState.Scoreboard,
    ];
    this.minPlayers = 3;
    this.maxPlayers = 8;
    // This subclass adds @observable fields (targetScore, currentSongIndex, winnerVideoId,
    // prompt…) that change in isolation (e.g. the target-score stepper), so it must call
    // makeObservable or MobX 6 leaves them inert.  The base only annotates its own fields.
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  //  reconstitute - wire message listeners (fresh AND restored games)
  // -------------------------------------------------------------------
  reconstitute() {
    super.reconstitute();
    this.listenToEndpoint(PassTheAuxOnboardClientEndpoint, this.handleOnboard);
    this.listenToEndpoint(PassTheAuxSubmitSongEndpoint, this.handleSubmitSong);
    this.listenToEndpoint(PassTheAuxSubmitBallotEndpoint, this.handleSubmitBallot);
  }

  createFreshPlayerEntry(name: string, id: string): PassTheAuxPlayer {
    const p = new PassTheAuxPlayer();
    p.playerId = id;
    p.name = name;
    return p;
  }

  // -------------------------------------------------------------------
  //  Setup / round lifecycle
  // -------------------------------------------------------------------
  setTargetScore(n: number) {
    const clamped = Math.max(MIN_TARGET_SCORE, Math.min(MAX_TARGET_SCORE, Math.round(n)));
    action(() => (this.targetScore = clamped))();
    this.saveCheckpoint();
  }

  // The Gathering "start" button: reset everything, then run the normal start.
  beginGame = () => {
    this.prepareFreshGame();
    this.startGame();
  };

  prepareFreshGame = () => {
    this.gameState = PresenterGameState.Gathering;
    this.currentRound = 0;
    action(() => {
      this.prompt = "";
      this.promptDeck = shuffled(PASS_THE_AUX_PROMPTS);
      this.roundHistory = [];
      this.clearRoundState();
      this.players.forEach((p) => (p.score = 0));
    })();
  };

  prepareFreshRound = () => {
    action(() => this.clearRoundState())();
  };

  private clearRoundState() {
    this.roundSongs.clear();
    this.currentSongIndex = -1;
    this.winnerVideoId = null;
    this.tallyOutcome = null;
    this.roundScored = false;
    this.players.forEach((p) => {
      p.submission = null;
      p.ballot = [];
    });
  }

  startNextRound = () => {
    this.prepareFreshRound();
    this.currentRound++;
    if (this.promptDeck.length === 0) this.promptDeck = shuffled(PASS_THE_AUX_PROMPTS);
    action(() => (this.prompt = this.promptDeck.shift() ?? "Play a song you love"))();
    this.gameState = PassTheAuxGameState.PromptReveal;
    this.timeOfStageEnd = Number.MAX_SAFE_INTEGER; // host-paced
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  Host-driven phase transitions
  // -------------------------------------------------------------------
  beginSelecting = () => {
    if (this.gameState !== PassTheAuxGameState.PromptReveal) return;
    this.gameState = PassTheAuxGameState.Selecting;
    this.timeOfStageEnd = Number.MAX_SAFE_INTEGER;
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  beginPlayback = () => {
    if (this.gameState !== PassTheAuxGameState.Selecting) return;
    const subs: RoundSong[] = this.players
      .filter((p) => p.submission)
      .map((p) => ({ ...(p.submission as PlayerSubmission), submitterId: p.playerId }));

    if (subs.length === 0) {
      // Nobody submitted - skip straight to a no-winner scoreboard.
      this.beginScoreboard();
      return;
    }

    action(() => {
      this.roundSongs.replace(shuffled(subs));
      this.currentSongIndex = 0;
    })();
    this.gameState = PassTheAuxGameState.Playback;
    this.timeOfStageEnd = this.gameTime_ms + SONG_PLAY_MS;
    this.invokeEvent(PassTheAuxGameEvent.PlaybackStarted, this.currentSong);
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  // Advance to the next song (auto at 30s, or via the host Skip button).
  advanceSong = () => {
    if (this.gameState !== PassTheAuxGameState.Playback) return;
    const next = this.currentSongIndex + 1;
    if (next >= this.roundSongs.length) {
      this.beginVoting();
      return;
    }
    action(() => (this.currentSongIndex = next))();
    this.timeOfStageEnd = this.gameTime_ms + SONG_PLAY_MS;
    this.invokeEvent(PassTheAuxGameEvent.SongAdvanced, this.currentSong);
    this.saveCheckpoint();
  };

  beginVoting = () => {
    this.gameState = PassTheAuxGameState.Voting;
    this.timeOfStageEnd = Number.MAX_SAFE_INTEGER;
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  beginTally = () => {
    if (this.gameState !== PassTheAuxGameState.Voting) return;
    const songIds = this.roundSongs.map((s) => s.videoId);
    const ballots: Ballot[] = this.players
      .filter((p) => p.ballot.length > 0)
      .map((p) => ({ voterId: p.playerId, ranking: p.ballot.slice() }));
    // Round-song order is a stable total order, so the tally (and its animation) is
    // deterministic and replays identically after a mid-tally refresh.
    const outcome = runInstantRunoff(songIds, ballots, songIds);
    action(() => {
      this.tallyOutcome = outcome;
      this.winnerVideoId = outcome.winners[0] ?? null;
    })();
    this.gameState = PassTheAuxGameState.Tally;
    this.timeOfStageEnd = this.gameTime_ms + outcome.steps.length * TALLY_STEP_MS + TALLY_TAIL_MS;
    this.invokeEvent(PassTheAuxGameEvent.TallyStarted, outcome);
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  beginScoreboard = () => {
    if (!this.roundScored) {
      action(() => {
        this.roundScored = true;
        const winnerSong = this.roundSongs.find((s) => s.videoId === this.winnerVideoId);
        const winner = winnerSong
          ? this.players.find((p) => p.playerId === winnerSong.submitterId)
          : undefined;
        if (winner) {
          winner.score++;
          this.invokeEvent(PassTheAuxGameEvent.RoundWinner, winner);
          this.invokeEvent(PassTheAuxGameEvent.ScoreChanged, winner);
        }
        this.roundHistory.push({
          prompt: this.prompt,
          songs: this.roundSongs.map((s) => ({
            videoId: s.videoId,
            title: s.title,
            artist: s.artist,
            submitterName: this.submitterName(s.submitterId),
          })),
          winnerVideoId: this.winnerVideoId ?? "",
        });
      })();
    }
    this.gameState = PassTheAuxGameState.Scoreboard;
    this.timeOfStageEnd = Number.MAX_SAFE_INTEGER;
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  finishGame = () => {
    this.gameState = GeneralGameState.GameOver;
    this.invokeEvent(PassTheAuxGameEvent.WinnerAnnounced, this.winners);
    this.requestEveryone(GameOverEndpoint, () => ({}));
    this.saveCheckpoint();
  };

  // -------------------------------------------------------------------
  //  handleTick - time/threshold-based transitions
  // -------------------------------------------------------------------
  handleTick() {
    switch (this.gameState) {
      case PassTheAuxGameState.Playback:
        if (this.isStageOver) this.advanceSong();
        break;
      case PassTheAuxGameState.Voting:
        if (this.allVoted) this.beginTally();
        break;
      case PassTheAuxGameState.Tally:
        if (this.isStageOver) this.beginScoreboard();
        break;
    }
  }

  // -------------------------------------------------------------------
  //  handleOnboard - full state for a (re)joining / refreshed client
  // -------------------------------------------------------------------
  handleOnboard = (sender: string, message: unknown): PassTheAuxOnboardResponse => {
    this.telemetryLogger.logEvent("Presenter", "Onboard Client");
    const me = this.players.find((p) => p.playerId === sender);
    const reveal =
      this.gameState === PassTheAuxGameState.Voting ||
      this.gameState === PassTheAuxGameState.Tally ||
      this.gameState === PassTheAuxGameState.Scoreboard ||
      this.gameState === GeneralGameState.GameOver;

    return {
      gameState: this.gameState,
      roundNumber: this.currentRound,
      prompt: this.prompt,
      targetScore: this.targetScore,
      scores: this.players.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        avatarId: p.avatarId,
        score: p.score,
      })),
      presentCount: this.presentCount,
      submittedCount: this.submittedCount,
      votedCount: this.votedCount,
      mySubmission: me?.submission ? { ...me.submission } : null,
      votingSongs: reveal
        ? this.roundSongs.map((s) => ({
            videoId: s.videoId,
            title: s.title,
            artist: s.artist,
            thumbnailUrl: s.thumbnailUrl,
          }))
        : [],
      myOwnVideoId: me?.submission?.videoId ?? null,
      myBallot: me?.ballot.slice() ?? [],
    };
  };

  // -------------------------------------------------------------------
  //  handleSubmitSong - a player cues (or replaces) their track
  // -------------------------------------------------------------------
  handleSubmitSong = (
    sender: string,
    message: PassTheAuxSubmitSongRequest,
  ): PassTheAuxSubmitSongResponse => {
    const me = this.players.find((p) => p.playerId === sender);
    if (!me) return { accepted: false, reason: "You are not in this game" };
    if (this.gameState !== PassTheAuxGameState.Selecting) {
      return { accepted: false, reason: "Not accepting songs right now" };
    }
    if (!message.videoId || !message.title) {
      return { accepted: false, reason: "Pick a song first" };
    }
    const startSec = clampStartSec(message.startSec, message.durationSec);
    action(() => {
      me.submission = {
        videoId: message.videoId,
        title: message.title,
        artist: message.artist ?? "",
        thumbnailUrl: message.thumbnailUrl ?? "",
        durationSec: message.durationSec ?? 0,
        startSec,
      };
    })();
    this.invokeEvent(PassTheAuxGameEvent.SongSubmitted, me);
    this.saveCheckpoint();
    return { accepted: true, startSec };
  };

  // -------------------------------------------------------------------
  //  handleSubmitBallot - a player ranks their top choices
  // -------------------------------------------------------------------
  handleSubmitBallot = (
    sender: string,
    message: PassTheAuxSubmitBallotRequest,
  ): PassTheAuxSubmitBallotResponse => {
    const me = this.players.find((p) => p.playerId === sender);
    if (!me) return { accepted: false, reason: "You are not in this game" };
    if (this.gameState !== PassTheAuxGameState.Voting) {
      return { accepted: false, reason: "Voting is closed" };
    }
    const validIds = this.roundSongs.map((s) => s.videoId);
    const ranking = sanitizeRanking(message.ranking, validIds, me.submission?.videoId, MAX_BALLOT);
    if (ranking.length < 1) {
      return { accepted: false, reason: "Rank at least one song" };
    }
    action(() => (me.ballot = ranking))();
    this.invokeEvent(PassTheAuxGameEvent.BallotReceived, me);
    this.saveCheckpoint();
    return { accepted: true, ranking };
  };
}
