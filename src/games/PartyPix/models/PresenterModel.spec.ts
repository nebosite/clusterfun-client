import { runInAction } from "mobx";
import { ISessionHelper, instantiateGame, getPresenterTypeHelper } from "libs";
import { MockTelemetryLogger } from "libs/telemetry/MockTelemetryLogger";
import { PresenterGameState } from "libs";
import {
  PartyPixPresenterModel,
  PartyPixGameState,
  PartyPixPlayer,
  getPartyPixPresenterTypeHelper,
} from "./PresenterModel";
import { START_CREDITS } from "./GameSettings";

// -------------------------------------------------------------------
// A light integration test that drives the real presenter model through its
// message handlers. We deliberately skip reconstitute() (it starts a
// setInterval ticker and wires the relay listeners); the handlers under test
// don't depend on it. The only collaborator they touch is the session (for the
// fire-and-forget pushes), so a recording stub is enough — no heavy mocking.
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
    // Not exercised by the handlers under test, but present so the interface
    // is satisfied if something incidental reaches for them.
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
  const storage = {
    set: () => {},
    get: () => null,
    remove: () => {},
    clear: () => {},
  };
  const model = new PartyPixPresenterModel(session, logger, storage);
  return { model, sent };
}

function addPlayer(model: PartyPixPresenterModel, id: string, name: string): PartyPixPlayer {
  const p = model.createFreshPlayerEntry(name, id);
  runInAction(() => model.players.push(p));
  return p;
}

const PHOTO = { full: "data:image/jpeg;base64,FULL", thumb: "data:image/jpeg;base64,THUMB" };

describe("PartyPixPresenterModel — upload", () => {
  it("spends a credit, adds the photo, and flips Gathering -> Slideshow", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    expect(model.gameState).toBe(PresenterGameState.Gathering);

    const res = model.handleUpload("A", PHOTO);

    expect(res.success).toBe(true);
    expect(res.credits).toBe(START_CREDITS - 1);
    expect(author.credits).toBe(START_CREDITS - 1);
    expect(author.uploads).toBe(1);
    expect(model.photos.length).toBe(1);
    expect(model.gameState).toBe(PartyPixGameState.Slideshow);
    expect(model.currentPhoto?.authorId).toBe("A");
  });

  it("rejects an upload from a player with no credits", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    runInAction(() => (author.credits = 0));

    const res = model.handleUpload("A", PHOTO);

    expect(res.success).toBe(false);
    expect(model.photos.length).toBe(0);
    expect(model.gameState).toBe(PresenterGameState.Gathering);
  });

  it("rejects an upload from an unknown sender", () => {
    const { model } = makeModel();
    const res = model.handleUpload("ghost", PHOTO);
    expect(res.success).toBe(false);
    expect(model.photos.length).toBe(0);
  });
});

describe("PartyPixPresenterModel — voting + credits", () => {
  it("awards the author a credit at the first upvote milestone (2 upvotes)", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");

    model.handleUpload("A", PHOTO);
    expect(author.credits).toBe(2); // 3 start - 1 upload
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "up" });
    expect(author.totalUp).toBe(1);
    expect(author.credits).toBe(2); // milestone 2 not reached yet
    expect(photo.up).toBe(1);

    model.handleVote("C", { photoId: photo.id, kind: "up" });
    expect(author.totalUp).toBe(2);
    expect(photo.up).toBe(2);
    expect(author.credits).toBe(3); // crossed milestone 2 -> +1 credit
  });

  it("blocks credit farming by a single toggling voter", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    // Bob taps up/off/up... many times, trying to mint credits for Alice.
    for (let i = 0; i < 10; i++) {
      model.handleVote("B", { photoId: photo.id, kind: "up" });
    }

    expect(author.totalUp).toBe(1); // one accomplice = one credit-step, ever
    expect(author.credits).toBe(2); // 3 start - 1 upload, no farmed credit
  });

  it("rejects a self-vote (no tally change, no credit)", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    const res = model.handleVote("A", { photoId: photo.id, kind: "up" });

    expect(photo.up).toBe(0);
    expect(author.totalUp).toBe(0);
    expect(res.up).toBe(0);
  });

  it("keeps the tally in sync on a down vote", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "down" });
    expect(photo.down).toBe(1);
    expect(photo.up).toBe(0);
  });

  it("ignores a vote for an unknown photo", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    const res = model.handleVote("A", { photoId: "nope", kind: "up" });
    expect(res.ok).toBe(false);
  });
});

describe("PartyPixPresenterModel — flagging + moderation", () => {
  it("pulls a photo out of rotation on the first flag and remembers it", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "delete" });

    expect(model.photos.length).toBe(0); // out of rotation
    expect(model.flaggedPhotos.length).toBe(1); // remembered
    expect(model.flaggedPhotos[0]).toBe(photo);
    expect(model.gameState).toBe(PresenterGameState.Gathering); // no active photos left
    expect(Array.from(photo.flaggerNames.values())).toContain("Bob");
  });

  it("OK returns a flagged photo to rotation, then needs 3 flags to pull again", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");
    addPlayer(model, "D", "Dave");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "delete" }); // 1 flag -> flagged
    expect(model.flaggedPhotos.length).toBe(1);

    model.moderateOk(photo);
    expect(model.photos.length).toBe(1); // back in rotation
    expect(model.flaggedPhotos.length).toBe(0);
    expect(photo.approved).toBe(true);

    // Already has Bob's flag (1); now needs 3.
    model.handleVote("C", { photoId: photo.id, kind: "delete" }); // 2 total
    expect(model.photos.length).toBe(1); // still in rotation (< 3)
    model.handleVote("D", { photoId: photo.id, kind: "delete" }); // 3 total -> pulled
    expect(model.photos.length).toBe(0);
    expect(model.flaggedPhotos.length).toBe(1);
  });

  it("Ban removes a photo and blocks re-uploading the same image", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO); // credits 3 -> 2
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "delete" }); // -> flagged
    model.moderateBan(photo);
    expect(model.photos.length).toBe(0);
    expect(model.flaggedPhotos.length).toBe(0);

    // Re-uploading the exact same image is rejected and costs no credit.
    const res = model.handleUpload("A", PHOTO);
    expect(res.success).toBe(false);
    expect(author.credits).toBe(2); // unchanged
    expect(model.photos.length).toBe(0);
  });

  it("jumpToPhoto resumes the slideshow from the chosen photo", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.handleUpload("A", { full: "F1", thumb: "T1" });
    model.handleUpload("A", { full: "F2", thumb: "T2" });
    model.handleUpload("A", { full: "F3", thumb: "T3" }); // newest is shown
    const first = model.photos[0];

    model.jumpToPhoto(first);
    expect(model.currentPhoto).toBe(first);
  });
});

describe("PartyPixPresenterModel — checkpoint serialization", () => {
  // Regression guard for the bug where the non-serializable `photoStore` field
  // made the deep serializer throw, silently killing ALL checkpoints (player
  // credits/totalUp would no longer survive a refresh). Build the serializer the
  // production way (instantiateGame wraps the type helper and attaches it).
  it("round-trips through the real serializer, preserving players and skipping photos", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getPartyPixPresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(typeHelper, logger, storage) as unknown as PartyPixPresenterModel;

    runInAction(() => {
      const p = model.createFreshPlayerEntry("A", "A");
      p.credits = 7;
      p.totalUp = 4;
      model.players.push(p);
    });
    model.handleUpload("A", PHOTO); // credit 7 -> 6, adds a photo (not a folder run)

    const serializer = model.serializer!;
    let json = "";
    // The Finding-1 regression: this used to throw on the `photoStore` field.
    expect(() => {
      json = serializer.stringify(model);
    }).not.toThrow();

    const back = serializer.parse<PartyPixPresenterModel>(json);
    expect(back.players.length).toBe(1);
    expect(back.players[0].credits).toBe(6); // player state survives a checkpoint
    expect(back.players[0].totalUp).toBe(4);
    expect(back.photos.length).toBe(0); // photos are intentionally never serialized
  });

  // Guards the new skip-list entries: `flaggedPhotos` holds unregistered
  // PartyPixPhoto objects and `bannedHashes` is a Set — if either were left in
  // the serialized graph the deep serializer would throw (flaggedPhotos) and
  // silently kill every checkpoint again. Exercise a model that actually has
  // both populated.
  it("does not choke when flaggedPhotos + bannedHashes are populated", () => {
    const sent: SentMessage[] = [];
    const session = makeFakeSession(sent);
    const logger = new MockTelemetryLogger("test");
    const storage = { set: () => {}, get: () => null, remove: () => {}, clear: () => {} } as any;

    const typeHelper = getPresenterTypeHelper(
      getPartyPixPresenterTypeHelper(session, { logger, storage } as any),
    );
    const model = instantiateGame(typeHelper, logger, storage) as unknown as PartyPixPresenterModel;

    runInAction(() => {
      model.players.push(model.createFreshPlayerEntry("Alice", "A"));
      model.players.push(model.createFreshPlayerEntry("Bob", "B"));
    });
    model.handleUpload("A", { full: "F1", thumb: "T1" });
    model.handleUpload("A", { full: "F2", thumb: "T2" });
    const held = model.photos[0];
    const toBan = model.photos[model.photos.length - 1];
    model.handleVote("B", { photoId: held.id, kind: "delete" }); // -> flaggedPhotos
    model.handleVote("B", { photoId: toBan.id, kind: "delete" });
    model.moderateBan(toBan); // -> bannedHashes

    expect(model.flaggedPhotos.length).toBeGreaterThan(0);
    expect(() => model.serializer!.stringify(model)).not.toThrow();
  });
});

describe("PartyPixPresenterModel — onboarding", () => {
  it("reports live state + current slide to a joining player", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    const bob = addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);

    const info = model.handleOnboard("B");
    expect(info.state).toBe(PartyPixGameState.Slideshow);
    expect(info.credits).toBe(bob.credits);
    expect(info.slide).not.toBeNull();
    expect(info.slide?.authorName).toBe("Alice");
    expect(info.slide?.youAuthored).toBe(false);
    expect(info.slide?.count).toBe(1);
  });

  it("marks youAuthored for the author's own slide", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    model.handleUpload("A", PHOTO);
    const info = model.handleOnboard("A");
    expect(info.slide?.youAuthored).toBe(true);
  });
});

// -------------------------------------------------------------------
// Slideshow index integrity as photos are pulled / OK'd / banned / jumped.
// spliceFromActive is the one place currentIndex can desync from what is on
// screen, so these pin down each removal position.
// -------------------------------------------------------------------
describe("PartyPixPresenterModel — moderation index safety", () => {
  // Three photos by Alice; Bob is a non-author flagger. Returns [p1, p2, p3].
  function threeUp(model: PartyPixPresenterModel) {
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", { full: "F1", thumb: "T1" });
    model.handleUpload("A", { full: "F2", thumb: "T2" });
    model.handleUpload("A", { full: "F3", thumb: "T3" });
    return model.photos.slice();
  }

  it("pulling an EARLIER (non-current) photo keeps the on-screen photo", () => {
    const { model } = makeModel();
    const [p1, p2] = threeUp(model);
    model.jumpToPhoto(p2); // show the middle photo
    expect(model.currentPhoto).toBe(p2);

    model.handleVote("B", { photoId: p1.id, kind: "delete" }); // pull the earlier one
    expect(model.photos.length).toBe(2);
    expect(model.currentPhoto).toBe(p2); // still the same photo on screen
    expect(model.flaggedPhotos).toContain(p1);
  });

  it("pulling the CURRENT photo advances to the next", () => {
    const { model } = makeModel();
    const [, p2, p3] = threeUp(model);
    model.jumpToPhoto(p2);

    model.handleVote("B", { photoId: p2.id, kind: "delete" }); // pull the current one
    expect(model.photos.length).toBe(2);
    expect(model.currentPhoto).toBe(p3); // advanced to what shifted into its slot
  });

  it("pulling the LAST active photo returns to Gathering", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "delete" });
    expect(model.photos.length).toBe(0);
    expect(model.gameState).toBe(PresenterGameState.Gathering);
    expect(model.currentPhoto).toBeNull();
  });

  it("jumpToPhoto ignores a flagged (pulled) photo — it is not in active rotation", () => {
    const { model } = makeModel();
    const [p1, p2] = threeUp(model);
    model.handleVote("B", { photoId: p1.id, kind: "delete" }); // p1 -> flagged
    model.jumpToPhoto(p2);
    expect(model.currentPhoto).toBe(p2);

    model.jumpToPhoto(p1); // p1 is only in flaggedPhotos now
    expect(model.currentPhoto).toBe(p2); // unchanged, no jump to a flagged photo
    expect(model.photos).not.toContain(p1);
  });

  it("banning a flagged photo does not disturb the active rotation or currentIndex", () => {
    const { model } = makeModel();
    const [p1, p2] = threeUp(model);
    model.jumpToPhoto(p2);
    model.handleVote("B", { photoId: p1.id, kind: "delete" }); // p1 -> flagged
    expect(model.currentPhoto).toBe(p2);

    model.moderateBan(p1); // p1 lives in flaggedPhotos, not active
    expect(model.photos.length).toBe(2);
    expect(model.currentPhoto).toBe(p2); // active rotation untouched
    expect(model.flaggedPhotos.length).toBe(0);
  });

  it("moderateOk flips Gathering back to Slideshow when the OK'd photo is the only one", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];
    model.handleVote("B", { photoId: photo.id, kind: "delete" }); // -> Gathering
    expect(model.gameState).toBe(PresenterGameState.Gathering);

    model.moderateOk(photo);
    expect(model.gameState).toBe(PartyPixGameState.Slideshow);
    expect(model.currentPhoto).toBe(photo);
    expect(photo.approved).toBe(true);
  });

  it("a ban blocks only the banned image; a different image still uploads", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO); // credits 3 -> 2
    const photo = model.photos[0];
    model.handleVote("B", { photoId: photo.id, kind: "delete" });
    model.moderateBan(photo);

    const res = model.handleUpload("A", { full: "DIFFERENT", thumb: "T" });
    expect(res.success).toBe(true);
    expect(author.credits).toBe(1); // 2 -> 1, a fresh image is fine
    expect(model.photos.length).toBe(1);
  });
});
