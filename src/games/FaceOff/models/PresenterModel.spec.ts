import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState } from "libs";
import {
  FaceOffPresenterModel,
  FaceOffGameState,
  FaceOffPlayer,
  getFaceOffPresenterTypeHelper,
} from "./PresenterModel";
import { POINTS_PER_VOTE, WIN_BONUS } from "./GameSettings";

// -------------------------------------------------------------------
// A light integration test driving the real presenter through its message handlers. We skip
// reconstitute() (it starts a ticker + wires the relay); the handlers under test don't need
// it. The only collaborator they touch is the session (for the fire-and-forget pushes), so a
// recording stub is enough. Pairing uses Math.random, so tests inspect the ACTUAL matchups
// the model produced rather than assuming an order.
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
  const model = new FaceOffPresenterModel(session, logger, storage);
  return { model, sent };
}

// Add a player who has reported a camera (so they are contestant-eligible).
function addCameraPlayer(model: FaceOffPresenterModel, id: string, name: string): FaceOffPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  runInAction(() => {
    p.hasCamera = true;
    model.players.push(p);
  });
  return p;
}

const PHOTO = { full: "data:image/jpeg;base64,FULL", thumb: "data:image/jpeg;base64,THUMB" };

// Submit a photo for every contestant in every matchup (drives Capturing -> Voting).
function submitAll(model: FaceOffPresenterModel) {
  for (const m of model.matchups) {
    for (const e of m.entries) {
      model.handleSubmit(e.playerId, {
        roundId: model.roundId,
        full: PHOTO.full,
        thumb: PHOTO.thumb,
      });
    }
  }
}

// Force the current stage to be "over" and tick once, so a timed transition fires.
function forceStageOverTick(model: FaceOffPresenterModel) {
  runInAction(() => {
    model.timeOfStageEnd = -1;
  });
  model.handleTick();
}

describe("FaceOffPresenterModel — round setup", () => {
  it("pairs camera players into matchups with distinct prompts and enters Capturing", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));

    model.startNextRound();

    expect(model.gameState).toBe(FaceOffGameState.Capturing);
    expect(model.currentRound).toBe(1);
    expect(model.matchups.length).toBe(2); // 4 contestants -> 2 head-to-head matchups
    const allEntryPlayers = model.matchups.flatMap((m) => m.entries.map((e) => e.playerId));
    expect(allEntryPlayers.slice().sort()).toEqual(["A", "B", "C", "D"]);
    const prompts = model.matchups.map((m) => m.promptId);
    expect(new Set(prompts).size).toBe(2); // distinct prompt per matchup
    model.players.forEach((p) => expect(p.role).toBe("contestant"));
  });

  it("makes non-camera players judges, not contestants", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    const judge = model.createFreshPlayerEntry("Judy", "J");
    runInAction(() => model.players.push(judge)); // no camera

    model.startNextRound();

    expect(judge.role).toBe("judge");
    const contestantIds = model.matchups.flatMap((m) => m.entries.map((e) => e.playerId));
    expect(contestantIds).not.toContain("J");
  });

  it("waits on the join screen when fewer than 2 cameras are present", () => {
    const { model } = makeModel();
    addCameraPlayer(model, "A", "A");
    const judge = model.createFreshPlayerEntry("Judy", "J");
    runInAction(() => model.players.push(judge));

    model.startNextRound();

    expect(model.needCamera).toBe(true);
    expect(model.gameState).toBe(PresenterGameState.Gathering);
    expect(model.currentRound).toBe(0); // round not consumed
  });
});

describe("FaceOffPresenterModel — capture", () => {
  it("records a submitted photo and marks the contestant done", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    const entry = model.matchups[0].entries[0];

    const res = model.handleSubmit(entry.playerId, {
      roundId: model.roundId,
      full: PHOTO.full,
      thumb: PHOTO.thumb,
    });

    expect(res.accepted).toBe(true);
    expect(entry.hasPhoto).toBe(true);
    expect(entry.full).toBe(PHOTO.full);
    const player = model.players.find((p) => p.playerId === entry.playerId)!;
    expect(player.submitted).toBe(true);
  });

  it("advances to Voting once every contestant has submitted", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();

    submitAll(model);

    expect(model.gameState).toBe(FaceOffGameState.Voting);
  });

  it("rejects a submission tagged with a stale round id", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    const entry = model.matchups[0].entries[0];

    const res = model.handleSubmit(entry.playerId, { roundId: 999, full: "F", thumb: "T" });
    expect(res.accepted).toBe(false);
    expect(entry.hasPhoto).toBe(false);
  });
});

describe("FaceOffPresenterModel — voting", () => {
  // Set up a Voting-phase model and return a matchup + an outside voter for it.
  function votingSetup() {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    submitAll(model); // -> Voting
    const target = model.matchups[0];
    const outside = model.matchups[1].entries[0].playerId; // not in `target`
    return { model, target, outside };
  }

  it("counts a vote from an eligible judge", () => {
    const { model, target, outside } = votingSetup();
    const entry = target.entries[0];

    const res = model.handleVote(outside, { matchupId: target.id, entryId: entry.entryId });
    expect(res.accepted).toBe(true);
    expect(entry.votes).toBe(1);
  });

  it("switching a vote moves the tally between entries", () => {
    const { model, target, outside } = votingSetup();
    const [e0, e1] = target.entries;

    model.handleVote(outside, { matchupId: target.id, entryId: e0.entryId });
    model.handleVote(outside, { matchupId: target.id, entryId: e1.entryId });

    expect(e0.votes).toBe(0);
    expect(e1.votes).toBe(1);
  });

  it("re-tapping the same entry is a no-op", () => {
    const { model, target, outside } = votingSetup();
    const e0 = target.entries[0];
    model.handleVote(outside, { matchupId: target.id, entryId: e0.entryId });
    model.handleVote(outside, { matchupId: target.id, entryId: e0.entryId });
    expect(e0.votes).toBe(1);
  });

  it("rejects voting on your own matchup", () => {
    const { model, target } = votingSetup();
    const own = target.entries[0];
    const res = model.handleVote(own.playerId, { matchupId: target.id, entryId: own.entryId });
    expect(res.accepted).toBe(false);
    expect(own.votes).toBe(0);
  });
});

describe("FaceOffPresenterModel — scoring at reveal", () => {
  it("awards votes plus the win bonus when reveal begins", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    submitAll(model); // -> Voting
    const target = model.matchups[0];
    const winner = target.entries[0];
    const outside = model.matchups[1].entries[0].playerId;
    model.handleVote(outside, { matchupId: target.id, entryId: winner.entryId });

    forceStageOverTick(model); // Voting -> Revealing (applies scores once)

    expect(model.gameState).toBe(FaceOffGameState.Revealing);
    const winnerPlayer = model.players.find((p) => p.playerId === winner.playerId)!;
    expect(winnerPlayer.score).toBe(POINTS_PER_VOTE + WIN_BONUS); // 1 vote + win bonus
    // The loser in that matchup (no votes) scored nothing.
    const loserPlayer = model.players.find((p) => p.playerId === target.entries[1].playerId)!;
    expect(loserPlayer.score).toBe(0);
  });

  it("progresses reveal -> scoreboard -> next capture round via ticks", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    submitAll(model);
    forceStageOverTick(model); // Voting -> Revealing (2 matchups)
    forceStageOverTick(model); // reveal matchup 1 -> matchup 2
    forceStageOverTick(model); // last reveal -> RoundScoreboard
    expect(model.gameState).toBe(FaceOffGameState.RoundScoreboard);
    forceStageOverTick(model); // -> next round's Capturing
    expect(model.gameState).toBe(FaceOffGameState.Capturing);
    expect(model.currentRound).toBe(2);
  });
});

describe("FaceOffPresenterModel — onboarding", () => {
  it("hands a contestant their secret prompt and role", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    const contestantId = model.matchups[0].entries[0].playerId;

    const res = model.handleOnboard(contestantId, { hasCamera: true });
    expect(res.role).toBe("contestant");
    expect(res.prompt).not.toBeNull();
    expect(res.state).toBe(FaceOffGameState.Capturing);
  });

  it("records camera capability and reports votable matchups only while Voting", () => {
    const { model } = makeModel();
    ["A", "B", "C", "D"].forEach((id) => addCameraPlayer(model, id, id));
    model.startNextRound();
    submitAll(model); // -> Voting
    const voterId = model.matchups[1].entries[0].playerId;

    const res = model.handleOnboard(voterId, { hasCamera: true });
    // The voter is a contestant in matchup[1], so they can vote only on matchup[0].
    expect(res.votableMatchups.length).toBe(1);
    expect(res.votableMatchups[0].matchupId).toBe(model.matchups[0].id);
    // Anonymized: entries carry no player identity.
    expect(res.votableMatchups[0].entries[0]).not.toHaveProperty("playerId");
  });
});

describe("FaceOffPresenterModel — checkpoint serialization", () => {
  // Guards that the non-serializable `matchups` (base64 images + unregistered classes) is
  // skipped: otherwise the deep serializer would throw and silently kill ALL checkpoints
  // (player scores would stop surviving a refresh). Build the serializer the production way.
  it("round-trips through the real serializer, preserving players and skipping matchups", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getFaceOffPresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(typeHelper, logger, storage) as unknown as FaceOffPresenterModel;

    runInAction(() => {
      ["A", "B", "C", "D"].forEach((id) => {
        const p = model.createFreshPlayerEntry(id, id);
        p.hasCamera = true;
        p.score = 250;
        model.players.push(p);
      });
    });
    model.startNextRound(); // builds matchups
    submitAll(model); // fills entries with base64 images

    const serializer = model.serializer!;
    let json = "";
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();

    const back = serializer.parse<FaceOffPresenterModel>(json);
    expect(back.players.length).toBe(4);
    expect(back.players[0].score).toBe(250); // player state survives a checkpoint
    expect(back.matchups.length).toBe(0); // matchups (with images) intentionally not serialized
  });
});
