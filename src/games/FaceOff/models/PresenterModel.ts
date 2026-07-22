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
} from "libs";
import Logger from "js-logger";
import { GameOverEndpoint, InvalidateStateEndpoint } from "libs/messaging/basicEndpoints";
import {
  FaceOffOnboardEndpoint,
  type FaceOffOnboardRequest,
  type FaceOffOnboardResponse,
  FaceOffSubmitPhotoEndpoint,
  type FaceOffSubmitRequest,
  type FaceOffSubmitResponse,
  FaceOffVoteEndpoint,
  type FaceOffVoteRequest,
  type FaceOffVoteResponse,
  FaceOffSnapNowEndpoint,
  type FaceOffRole,
  type VotableMatchupInfo,
  type StandingInfo,
} from "./faceOffEndpoints";
import {
  CAPTURE_COLLECT_GRACE_MS,
  CAPTURE_COUNTDOWN_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POINTS_PER_VOTE,
  REVEAL_PER_MATCHUP_MS,
  ROUND_SCOREBOARD_MS,
  TOTAL_ROUNDS,
  VOTE_TIME_MS,
  WIN_BONUS,
} from "./GameSettings";
import { getPrompt, PROMPTS, type PromptInfo, toPromptInfo } from "./prompts";
import {
  findWinners,
  matchupWinners,
  pairContestants,
  scoreForEntry,
  selectPrompts,
  shuffle,
} from "./faceOffLogic";

// -------------------------------------------------------------------
// Domain objects
// -------------------------------------------------------------------

// One player's record. Per-player @observable fields drive the presenter UI, so this subclass
// MUST call makeObservable(this) — ClusterFunPlayer never does, which would otherwise leave
// these inert in MobX 6 (see the repo's MobX-player-observability gotcha).
export class FaceOffPlayer extends ClusterFunPlayer {
  @observable score = 0;
  @observable role: FaceOffRole = "judge";
  @observable hasCamera = false;
  @observable submitted = false; // has submitted THIS round

  constructor() {
    super();
    makeObservable(this);
  }
}

let entryCounter = 0;
let matchupCounter = 0;

// One contestant's photo slot in a matchup. Not serialized (holds base64), so making it
// observable is safe — it only ever lives in memory.
export class FaceOffEntry {
  entryId: string;
  playerId: string;
  playerName: string;
  avatarId: number;
  full = ""; // base64 JPEG, reveal resolution (empty until submitted)
  thumb = ""; // base64 JPEG, small
  hasPhoto = false;
  voterIds = new Set<string>(); // who voted for THIS entry (enforcement)
  @observable votes = 0; // mirror of voterIds.size for the live tally
  @observable isWinner = false;

  constructor(entryId: string, playerId: string, playerName: string, avatarId: number) {
    this.entryId = entryId;
    this.playerId = playerId;
    this.playerName = playerName;
    this.avatarId = avatarId;
    makeObservable(this);
  }
}

// A head-to-head (or 3-way) matchup: several contestants on one shared prompt. Not serialized.
export class FaceOffMatchup {
  id: string;
  promptId: string;
  prompt: PromptInfo;
  entries: FaceOffEntry[];
  voterChoice = new Map<string, string>(); // voterId -> chosen entryId (one vote per matchup)

  constructor(id: string, promptId: string, prompt: PromptInfo, entries: FaceOffEntry[]) {
    this.id = id;
    this.promptId = promptId;
    this.prompt = prompt;
    this.entries = entries;
  }
}

// -------------------------------------------------------------------
// States + events
// -------------------------------------------------------------------
export enum FaceOffGameState {
  Capturing = "Capturing", // live framing + countdown, then collect photos
  Voting = "Voting", // parallel head-to-head voting
  Revealing = "Revealing", // big screen reveals matchups one at a time
  RoundScoreboard = "RoundScoreboard", // cumulative standings between rounds
}

export enum FaceOffGameEvent {
  SnapTaken = "SnapTaken",
  PhotoSubmitted = "PhotoSubmitted",
  MatchupRevealed = "MatchupRevealed",
  ScoreChanged = "ScoreChanged",
  WinnerAnnounced = "WinnerAnnounced",
}

// -------------------------------------------------------------------
// Type helper (save/restore). Players + small scalars persist. `matchups` holds base64 image
// blobs (would blow the localStorage quota) AND unregistered classes (the deep serializer
// throws on those) — so it is skipped, and FaceOffEntry/FaceOffMatchup are intentionally NOT
// registered. Losing the in-flight round's photos on a presenter refresh is an accepted MVP
// tradeoff; reconstitute() restarts/advances the round (see below).
// -------------------------------------------------------------------
export const getFaceOffPresenterTypeHelper = (
  sessionHelper: ISessionHelper,
  gameProps: ClusterFunGameProps,
): ITypeHelper => {
  return {
    rootTypeName: "FaceOffPresenterModel",
    getTypeName(o) {
      switch (o.constructor) {
        case FaceOffPresenterModel:
          return "FaceOffPresenterModel";
        case FaceOffPlayer:
          return "FaceOffPlayer";
      }
      return undefined;
    },
    constructType(typeName: string): any {
      switch (typeName) {
        case "FaceOffPresenterModel":
          return new FaceOffPresenterModel(sessionHelper, gameProps.logger, gameProps.storage);
        case "FaceOffPlayer":
          return new FaceOffPlayer();
      }
      return null;
    },
    shouldStringify(typeName: string, propertyName: string, object: any): boolean {
      if (object instanceof FaceOffPresenterModel) {
        // `matchups` holds base64 images + unregistered classes — never serialize it.
        if (["matchups"].indexOf(propertyName) !== -1) return false;
      }
      return true;
    },
    reconstitute(typeName: string, propertyName: string, rehydratedObject: any) {
      return rehydratedObject;
    },
  };
};

// -------------------------------------------------------------------
// Presenter model — the single source of truth. Owns the round loop, matchups, votes, and
// scoring; pushes phase changes to phones which re-onboard.
// -------------------------------------------------------------------
export class FaceOffPresenterModel extends ClusterfunPresenterModel<FaceOffPlayer> {
  @observable matchups = observable<FaceOffMatchup>([]);
  @observable roundId = 0; // increments each capture; tags submissions so stale ones drop
  @observable revealIndex = 0; // which matchup the big screen is revealing
  @observable needCamera = false; // fewer than 2 camera-capable players → can't form a matchup
  usedPromptIds: string[] = []; // prompt history this game (small, serialized)
  private _snapFired = false; // within Capturing: has the snap been taken yet

  get winners(): FaceOffPlayer[] {
    return findWinners(this.players.slice());
  }

  get currentMatchup(): FaceOffMatchup | null {
    if (this.matchups.length === 0) return null;
    const i = Math.min(this.revealIndex, this.matchups.length - 1);
    return this.matchups[i];
  }

  // True while the capture countdown is still running (before the snap). After the snap the
  // presenter is collecting uploads. Used by the big-screen capture view.
  get isCountingDown(): boolean {
    return this.gameState === FaceOffGameState.Capturing && !this._snapFired;
  }

  get contestants(): FaceOffPlayer[] {
    return this.players.filter((p) => p.role === "contestant");
  }

  get cameraCount(): number {
    return this.players.filter((p) => p.hasCamera).length;
  }

  constructor(sessionHelper: ISessionHelper, logger: ITelemetryLogger, storage: IStorage) {
    super("FaceOff", sessionHelper, logger, storage);
    makeObservable(this);
    Logger.info(`Constructing FaceOffPresenterModel ${this.gameState}`);

    this.totalRounds = TOTAL_ROUNDS;
    this.minPlayers = MIN_PLAYERS;
    this.maxPlayers = MAX_PLAYERS;
    this.allowedJoinStates = [
      PresenterGameState.Gathering,
      FaceOffGameState.Capturing,
      FaceOffGameState.Voting,
      FaceOffGameState.Revealing,
      FaceOffGameState.RoundScoreboard,
    ];
  }

  reconstitute() {
    super.reconstitute();
    if (!this.matchups) this.matchups = observable<FaceOffMatchup>([]);
    this.listenToEndpoint(FaceOffOnboardEndpoint, this.handleOnboard);
    this.listenToEndpoint(FaceOffSubmitPhotoEndpoint, this.handleSubmit);
    this.listenToEndpoint(FaceOffVoteEndpoint, this.handleVote);

    // Photos are never serialized, so a presenter refresh mid-round finds `matchups` empty.
    // Capturing/Voting were not scored yet → restart that round's capture. Revealing/
    // RoundScoreboard already applied this round's scores → advance to the next round (never
    // re-award). Player scores survive via the checkpoint either way.
    if (this.matchups.length === 0) {
      const s = this.gameState;
      if (s === FaceOffGameState.Capturing || s === FaceOffGameState.Voting) {
        this.currentRound = Math.max(0, this.currentRound - 1);
        this.startNextRound();
      } else if (s === FaceOffGameState.Revealing || s === FaceOffGameState.RoundScoreboard) {
        this.startNextRound();
      }
    }
  }

  createFreshPlayerEntry(name: string, id: string): FaceOffPlayer {
    const p = new FaceOffPlayer();
    p.playerId = id;
    p.name = name;
    return p;
  }

  // -------------------------------------------------------------------
  //  Round lifecycle
  // -------------------------------------------------------------------
  prepareFreshGame = () => {
    action(() => {
      this.gameState = PresenterGameState.Gathering;
      this.currentRound = 0;
      this.revealIndex = 0;
      this.needCamera = false;
      this.usedPromptIds = [];
      this.matchups.clear();
      this.players.forEach((p) => {
        p.score = 0;
        p.role = "judge";
        p.submitted = false;
      });
    })();
  };

  prepareFreshRound = () => {
    action(() => {
      this.players.forEach((p) => (p.submitted = false));
    })();
  };

  // Called by the framework for round 1 (via startGame) and by handleTick after each round's
  // scoreboard. Increments the round, ends the game after the last, else opens capture.
  startNextRound = () => {
    if (this.currentRound >= this.totalRounds) {
      this.finishGame();
      return;
    }

    const contestants = this.players.filter((p) => p.hasCamera);
    if (contestants.length < 2) {
      // Not enough cameras to form a matchup — wait on the join screen until more arrive.
      action(() => {
        this.needCamera = true;
        this.gameState = PresenterGameState.Gathering;
      })();
      this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
      this.saveCheckpoint();
      return;
    }

    action(() => {
      this.needCamera = false;
      this.currentRound++;
    })();
    this.beginCapture(contestants);
  };

  private beginCapture(contestants: FaceOffPlayer[]) {
    const ids = shuffle(contestants.map((p) => p.playerId));
    const groups = pairContestants(ids);
    const pool = shuffle(PROMPTS.map((p) => p.id));
    const { chosen, nextUsed } = selectPrompts(pool, this.usedPromptIds, groups.length);

    const built: FaceOffMatchup[] = groups.map((group, gi) => {
      const promptId = chosen[gi];
      const prompt = toPromptInfo(getPrompt(promptId)!);
      const entries = group.map((pid) => {
        const pl = this.players.find((p) => p.playerId === pid)!;
        return new FaceOffEntry(`e${++entryCounter}`, pid, pl.name, pl.avatarId);
      });
      return new FaceOffMatchup(`m${++matchupCounter}`, promptId, prompt, entries);
    });

    const contestantIds = new Set(ids);
    action(() => {
      this.usedPromptIds = nextUsed;
      this.roundId++;
      this._snapFired = false;
      this.revealIndex = 0;
      this.matchups.replace(built);
      this.players.forEach((p) => {
        p.role = contestantIds.has(p.playerId) ? "contestant" : "judge";
        p.submitted = false;
      });
      this.gameState = FaceOffGameState.Capturing;
      this.timeOfStageEnd = this.gameTime_ms + CAPTURE_COUNTDOWN_MS;
    })();
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private fireSnap() {
    action(() => {
      this._snapFired = true;
      this.timeOfStageEnd = this.gameTime_ms + CAPTURE_COLLECT_GRACE_MS;
    })();
    this.sendToEveryone(FaceOffSnapNowEndpoint, () => ({ roundId: this.roundId }));
    this.invokeEvent(FaceOffGameEvent.SnapTaken, undefined);
    this.saveCheckpoint();
  }

  private beginVoting() {
    action(() => {
      this.gameState = FaceOffGameState.Voting;
      this.timeOfStageEnd = this.gameTime_ms + VOTE_TIME_MS;
    })();
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private beginRevealing() {
    // Finalize scoring ONCE, when reveal starts, so standings are consistent; the big screen
    // then reveals matchups one at a time (revealIndex) while the score sound plays per reveal.
    action(() => {
      for (const m of this.matchups) {
        const winners = new Set(
          matchupWinners(m.entries.map((e) => ({ entryId: e.entryId, votes: e.votes }))),
        );
        for (const e of m.entries) {
          e.isWinner = winners.has(e.entryId);
          const pts = scoreForEntry(e.votes, e.isWinner, POINTS_PER_VOTE, WIN_BONUS);
          if (pts > 0) {
            const pl = this.players.find((p) => p.playerId === e.playerId);
            if (pl) pl.score += pts;
          }
        }
      }
      this.revealIndex = 0;
      this.gameState = FaceOffGameState.Revealing;
      this.timeOfStageEnd = this.gameTime_ms + REVEAL_PER_MATCHUP_MS;
    })();
    this.invokeEvent(FaceOffGameEvent.MatchupRevealed, this.currentMatchup);
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private advanceReveal() {
    if (this.revealIndex < this.matchups.length - 1) {
      action(() => {
        this.revealIndex++;
        this.timeOfStageEnd = this.gameTime_ms + REVEAL_PER_MATCHUP_MS;
      })();
      this.invokeEvent(FaceOffGameEvent.MatchupRevealed, this.currentMatchup);
      this.saveCheckpoint();
    } else {
      this.beginRoundScoreboard();
    }
  }

  private beginRoundScoreboard() {
    action(() => {
      this.gameState = FaceOffGameState.RoundScoreboard;
      this.timeOfStageEnd = this.gameTime_ms + ROUND_SCOREBOARD_MS;
    })();
    this.sendToEveryone(InvalidateStateEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private finishGame() {
    action(() => {
      this.gameState = GeneralGameState.GameOver;
    })();
    this.invokeEvent(FaceOffGameEvent.WinnerAnnounced, this.winners);
    this.requestEveryone(GameOverEndpoint, () => ({}));
    this.saveCheckpoint();
  }

  private allContestantsSubmitted(): boolean {
    const contestants = this.players.filter((p) => p.role === "contestant");
    return contestants.length > 0 && contestants.every((p) => p.submitted);
  }

  // -------------------------------------------------------------------
  //  Tick — time-driven phase transitions
  // -------------------------------------------------------------------
  handleTick() {
    switch (this.gameState) {
      case FaceOffGameState.Capturing:
        if (this.isStageOver) {
          if (!this._snapFired) this.fireSnap();
          else this.beginVoting();
        }
        break;
      case FaceOffGameState.Voting:
        if (this.isStageOver) this.beginRevealing();
        break;
      case FaceOffGameState.Revealing:
        if (this.isStageOver) this.advanceReveal();
        break;
      case FaceOffGameState.RoundScoreboard:
        if (this.isStageOver) this.startNextRound();
        break;
    }
  }

  // -------------------------------------------------------------------
  //  Message handlers
  // -------------------------------------------------------------------
  handleOnboard = (sender: string, message: FaceOffOnboardRequest): FaceOffOnboardResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (player) {
      action(() => {
        player.hasCamera = message.hasCamera;
      })();
    }
    this.telemetryLogger.logEvent("Presenter", "Onboard");
    return this.buildOnboard(player);
  };

  private buildOnboard(player: FaceOffPlayer | undefined): FaceOffOnboardResponse {
    const role: FaceOffRole = player?.role ?? "judge";
    const myMatchup = player
      ? this.matchups.find((m) => m.entries.some((e) => e.playerId === player.playerId))
      : undefined;
    const prompt: PromptInfo | null = role === "contestant" && myMatchup ? myMatchup.prompt : null;

    return {
      state: this.gameState,
      round: this.currentRound,
      totalRounds: this.totalRounds,
      role,
      roundId: this.roundId,
      prompt,
      submitted: player?.submitted ?? false,
      votableMatchups: player ? this.votableMatchupsFor(player) : [],
      myVotes: player ? this.myVotesFor(player) : [],
      countdownMsLeft:
        this.gameState === FaceOffGameState.Capturing && !this._snapFired
          ? Math.max(0, this.timeOfStageEnd - this.gameTime_ms)
          : 0,
      standings: this.standings(),
      needCamera: this.needCamera,
    };
  }

  // Matchups this player may vote on: only during Voting, and never one they are a contestant
  // in. Entries are anonymized (entryId + thumb only) so votes are cast on the mimic.
  private votableMatchupsFor(player: FaceOffPlayer): VotableMatchupInfo[] {
    if (this.gameState !== FaceOffGameState.Voting) return [];
    return this.matchups
      .filter((m) => !m.entries.some((e) => e.playerId === player.playerId))
      .map((m) => ({
        matchupId: m.id,
        prompt: m.prompt,
        entries: m.entries.map((e) => ({ entryId: e.entryId, thumb: e.thumb })),
      }));
  }

  private myVotesFor(player: FaceOffPlayer): { matchupId: string; entryId: string }[] {
    if (this.gameState !== FaceOffGameState.Voting) return [];
    const out: { matchupId: string; entryId: string }[] = [];
    for (const m of this.matchups) {
      const choice = m.voterChoice.get(player.playerId);
      if (choice) out.push({ matchupId: m.id, entryId: choice });
    }
    return out;
  }

  private standings(): StandingInfo[] {
    return this.players
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ playerId: p.playerId, name: p.name, avatarId: p.avatarId, score: p.score }));
  }

  handleSubmit = (sender: string, message: FaceOffSubmitRequest): FaceOffSubmitResponse => {
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) return { accepted: false, error: "You are not in this game." };
    if (this.gameState !== FaceOffGameState.Capturing) {
      return { accepted: false, error: "The snap is closed." };
    }
    if (message.roundId !== this.roundId) return { accepted: false, error: "That round is over." };
    if (!message.full || !message.thumb)
      return { accepted: false, error: "No photo came through." };

    const matchup = this.matchups.find((m) => m.entries.some((e) => e.playerId === sender));
    if (!matchup) return { accepted: false, error: "You're not a contestant this round." };
    const entry = matchup.entries.find((e) => e.playerId === sender)!;

    action(() => {
      entry.full = message.full;
      entry.thumb = message.thumb;
      entry.hasPhoto = true;
      player.submitted = true;
    })();
    this.invokeEvent(FaceOffGameEvent.PhotoSubmitted, player);

    if (this.allContestantsSubmitted()) this.beginVoting();
    else this.saveCheckpoint();
    return { accepted: true };
  };

  handleVote = (sender: string, message: FaceOffVoteRequest): FaceOffVoteResponse => {
    if (this.gameState !== FaceOffGameState.Voting)
      return { accepted: false, error: "Voting is closed." };
    const player = this.players.find((p) => p.playerId === sender);
    if (!player) return { accepted: false, error: "You are not in this game." };
    const matchup = this.matchups.find((m) => m.id === message.matchupId);
    if (!matchup) return { accepted: false, error: "No such matchup." };
    if (matchup.entries.some((e) => e.playerId === sender)) {
      return { accepted: false, error: "You can't vote on your own matchup." };
    }
    const entry = matchup.entries.find((e) => e.entryId === message.entryId);
    if (!entry) return { accepted: false, error: "No such entry." };

    action(() => {
      const prev = matchup.voterChoice.get(sender);
      if (prev === entry.entryId) return; // re-tapping the same choice is a no-op
      if (prev) {
        const prevEntry = matchup.entries.find((e) => e.entryId === prev);
        if (prevEntry) {
          prevEntry.voterIds.delete(sender);
          prevEntry.votes = prevEntry.voterIds.size;
        }
      }
      entry.voterIds.add(sender);
      entry.votes = entry.voterIds.size;
      matchup.voterChoice.set(sender, entry.entryId);
    })();
    return { accepted: true };
  };
}
