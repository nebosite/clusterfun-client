import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState, GeneralGameState } from "libs";
import {
  MixtapePresenterModel,
  MixtapePlayer,
  MixtapeGameState,
  getMixtapePresenterTypeHelper,
} from "./PresenterModel";

// -------------------------------------------------------------------
// Drives the real presenter model through its handlers + phase methods with a recording
// session stub.  We skip reconstitute() (it starts a ticker and wires the relay); the
// handlers under test only touch the session for fire-and-forget pushes.  Mirrors
// CollageBoard/PartyPix.
// -------------------------------------------------------------------

interface SentMessage {
  route: string;
  receiverId: string;
  message: any;
}

function makeFakeSession(sent: SentMessage[]): ISessionHelper {
  const fake: Partial<ISessionHelper> = {
    roomId: "ROOM1",
    personalId: "PRESENTER",
    personalSecret: "secret",
    sendMessage: (endpoint, receiverId, message) => {
      sent.push({ route: (endpoint as any).route, receiverId, message });
    },
    listen: (() => ({ unsubscribe: () => {} })) as any,
    listenPresenter: (() => ({ unsubscribe: () => {} })) as any,
    request: (() => Promise.resolve(undefined)) as any,
    requestPresenter: (() => Promise.resolve(undefined)) as any,
    sendMessageToPresenter: () => {},
    addClosedListener: () => {},
    removeClosedListener: () => {},
    onError: () => {},
    serverCall: (() => Promise.resolve(undefined)) as any,
    stats: { sentCount: 0, bytesSent: 0, recievedCount: 0, bytesRecieved: 0 },
  };
  return fake as ISessionHelper;
}

function makeModel() {
  const sent: SentMessage[] = [];
  const session = makeFakeSession(sent);
  const logger = new MockTelemetryLogger("test");
  const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} };
  const model = new MixtapePresenterModel(session, logger, storage);
  return { model, sent };
}

function addPlayer(model: MixtapePresenterModel, id: string, name: string): MixtapePlayer {
  const p = model.createFreshPlayerEntry(name, id);
  p.playerId = id;
  runInAction(() => model.players.push(p));
  return p;
}

function submit(model: MixtapePresenterModel, id: string, videoId: string) {
  return model.handleSubmitSong(id, {
    videoId,
    title: `Song ${videoId}`,
    artist: `Artist ${videoId}`,
    thumbnailUrl: "",
    durationSec: 200,
    startSec: 30,
  });
}

// Add three players and take the game from Gathering to a fresh Selecting phase.
function startToSelecting(model: MixtapePresenterModel) {
  addPlayer(model, "A", "Alice");
  addPlayer(model, "B", "Bob");
  addPlayer(model, "C", "Carol");
  model.beginGame(); // -> PromptReveal
  model.beginSelecting(); // -> Selecting
}

describe("MixtapePresenterModel — setup", () => {
  it("requires three players and starts in Gathering", () => {
    const { model } = makeModel();
    expect(model.gameState).toBe(PresenterGameState.Gathering);
    expect(model.minPlayers).toBe(3);
  });

  it("beginGame draws a prompt and opens PromptReveal", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");
    model.beginGame();
    expect(model.gameState).toBe(MixtapeGameState.PromptReveal);
    expect(model.prompt.length).toBeGreaterThan(0);
    expect(model.currentRound).toBe(1);
  });

  it("clamps the host target score", () => {
    const { model } = makeModel();
    model.setTargetScore(999);
    expect(model.targetScore).toBe(15);
    model.setTargetScore(0);
    expect(model.targetScore).toBe(1);
  });
});

describe("MixtapePresenterModel — submitting songs", () => {
  it("accepts a song only during Selecting and clamps the start offset", () => {
    const { model } = makeModel();
    startToSelecting(model);
    const res = model.handleSubmitSong("A", {
      videoId: "v1",
      title: "Tune",
      artist: "Band",
      thumbnailUrl: "",
      durationSec: 200,
      startSec: 999, // past the end -> clamped to 170 (200-30)
    });
    expect(res.accepted).toBe(true);
    expect(res.startSec).toBe(170);
    expect(model.players.find((p) => p.playerId === "A")!.submission!.videoId).toBe("v1");
  });

  it("rejects a song when not in Selecting", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    const res = submit(model, "A", "v1");
    expect(res.accepted).toBe(false);
  });

  it("rejects an unknown sender", () => {
    const { model } = makeModel();
    startToSelecting(model);
    expect(submit(model, "ghost", "v1").accepted).toBe(false);
  });

  it("replaces a previous submission", () => {
    const { model } = makeModel();
    startToSelecting(model);
    submit(model, "A", "v1");
    submit(model, "A", "v2");
    expect(model.players.find((p) => p.playerId === "A")!.submission!.videoId).toBe("v2");
    expect(model.submittedCount).toBe(1);
  });
});

describe("MixtapePresenterModel — playback", () => {
  it("snapshots submissions into the round and walks through them", () => {
    const { model } = makeModel();
    startToSelecting(model);
    submit(model, "A", "vA");
    submit(model, "B", "vB");
    submit(model, "C", "vC");
    model.beginPlayback();
    expect(model.gameState).toBe(MixtapeGameState.Playback);
    expect(model.roundSongs.length).toBe(3);
    expect(model.currentSongIndex).toBe(0);

    model.advanceSong();
    expect(model.currentSongIndex).toBe(1);
    model.advanceSong();
    expect(model.currentSongIndex).toBe(2);
    model.advanceSong(); // past the last -> Voting
    expect(model.gameState).toBe(MixtapeGameState.Voting);
  });

  it("skips straight past playback when nobody submitted", () => {
    const { model } = makeModel();
    startToSelecting(model);
    model.beginPlayback();
    expect(model.gameState).toBe(MixtapeGameState.Scoreboard);
    expect(model.roundSongs.length).toBe(0);
  });

  it("auto-advances a song when its 30s window elapses", () => {
    const { model } = makeModel();
    startToSelecting(model);
    submit(model, "A", "vA");
    submit(model, "B", "vB");
    model.beginPlayback();
    runInAction(() => (model.gameTime_ms = model.timeOfStageEnd + 1));
    model.handleTick();
    expect(model.currentSongIndex).toBe(1);
  });
});

describe("MixtapePresenterModel — voting + tally", () => {
  // Drive a full round; craft ballots so vA wins on a first-choice majority.
  function toVoting(model: MixtapePresenterModel) {
    startToSelecting(model);
    submit(model, "A", "vA");
    submit(model, "B", "vB");
    submit(model, "C", "vC");
    model.beginPlayback();
    model.advanceSong();
    model.advanceSong();
    model.advanceSong(); // -> Voting
  }

  it("sanitizes ballots (drops own song and unknown ids)", () => {
    const { model } = makeModel();
    toVoting(model);
    const res = model.handleSubmitBallot("A", { ranking: ["vA", "zzz", "vB"] });
    expect(res.accepted).toBe(true);
    expect(res.ranking).toEqual(["vB"]); // vA is A's own, zzz unknown
  });

  it("rejects a ballot with no valid entries", () => {
    const { model } = makeModel();
    toVoting(model);
    expect(model.handleSubmitBallot("A", { ranking: ["vA"] }).accepted).toBe(false);
  });

  it("auto-tallies once everyone has voted and scores the winner", () => {
    const { model } = makeModel();
    toVoting(model);
    model.handleSubmitBallot("A", { ranking: ["vB"] });
    model.handleSubmitBallot("B", { ranking: ["vA"] });
    model.handleSubmitBallot("C", { ranking: ["vA"] }); // vA: 2 of 3 -> majority
    model.handleTick(); // allVoted -> beginTally
    expect(model.gameState).toBe(MixtapeGameState.Tally);
    expect(model.winnerVideoId).toBe("vA");

    // advance the tally timer -> scoreboard scores Alice (submitter of vA)
    runInAction(() => (model.gameTime_ms = model.timeOfStageEnd + 1));
    model.handleTick();
    expect(model.gameState).toBe(MixtapeGameState.Scoreboard);
    expect(model.players.find((p) => p.playerId === "A")!.score).toBe(1);
    expect(model.roundHistory.length).toBe(1);
    expect(model.roundHistory[0].winnerVideoId).toBe("vA");
  });

  it("does not double-score when scoreboard is entered twice", () => {
    const { model } = makeModel();
    toVoting(model);
    model.handleSubmitBallot("B", { ranking: ["vA"] });
    model.handleSubmitBallot("C", { ranking: ["vA"] });
    model.beginTally();
    model.beginScoreboard();
    model.beginScoreboard(); // idempotent
    expect(model.players.find((p) => p.playerId === "A")!.score).toBe(1);
  });
});

describe("MixtapePresenterModel — onboarding", () => {
  it("hides songs until voting, then exposes them without submitters", () => {
    const { model } = makeModel();
    startToSelecting(model);
    submit(model, "A", "vA");
    submit(model, "B", "vB");
    submit(model, "C", "vC");

    const during = model.handleOnboard("A", {});
    expect(during.gameState).toBe(MixtapeGameState.Selecting);
    expect(during.votingSongs.length).toBe(0);
    expect(during.mySubmission!.videoId).toBe("vA");

    model.beginPlayback();
    model.advanceSong();
    model.advanceSong();
    model.advanceSong(); // Voting
    const voting = model.handleOnboard("A", {});
    expect(voting.votingSongs.length).toBe(3);
    expect(voting.myOwnVideoId).toBe("vA");
    // no submitter fields leak to the client
    expect(Object.keys(voting.votingSongs[0])).toEqual([
      "videoId",
      "title",
      "artist",
      "thumbnailUrl",
    ]);
  });
});

describe("MixtapePresenterModel — checkpoint serialization", () => {
  it("round-trips through the real serializer, preserving scores and songs", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getMixtapePresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(typeHelper, logger, storage) as unknown as MixtapePresenterModel;

    runInAction(() => {
      ["A", "B", "C"].forEach((id) => {
        const p = model.createFreshPlayerEntry(`P${id}`, id);
        p.playerId = id;
        model.players.push(p);
      });
    });
    model.beginGame(); // prepareFreshGame zeroes scores...
    model.beginSelecting();
    // ...so set the scores we want to survive AFTER the fresh-game reset.
    runInAction(() => model.players.forEach((p, i) => (p.score = i)));
    submit(model, "A", "vA");
    submit(model, "B", "vB");
    submit(model, "C", "vC");
    model.beginPlayback(); // populates roundSongs

    const serializer = model.serializer!;
    let json = "";
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();

    const back = serializer.parse<MixtapePresenterModel>(json);
    expect(back.players.length).toBe(3);
    expect(back.players.map((p) => p.score).sort()).toEqual([0, 1, 2]);
    expect(back.roundSongs.length).toBe(3);
    // roundSongs must come back as a working (observable) array
    expect(typeof back.roundSongs.map).toBe("function");
    expect(back.currentSongIndex).toBe(0);
  });
});
