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
  it("awards the author a credit after three distinct upvotes", () => {
    const { model } = makeModel();
    const author = addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");
    addPlayer(model, "D", "Dave");

    model.handleUpload("A", PHOTO);
    expect(author.credits).toBe(2); // 3 start - 1 upload
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "up" });
    model.handleVote("C", { photoId: photo.id, kind: "up" });
    expect(author.totalUp).toBe(2);
    expect(author.credits).toBe(2); // no boundary crossed yet
    expect(photo.up).toBe(2);

    model.handleVote("D", { photoId: photo.id, kind: "up" });
    expect(author.totalUp).toBe(3);
    expect(photo.up).toBe(3);
    expect(author.credits).toBe(3); // 2 + 1 earned credit
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

describe("PartyPixPresenterModel — moderation", () => {
  it("auto-removes a photo once the flag threshold is reached and returns to Gathering when empty", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    addPlayer(model, "C", "Carol");
    addPlayer(model, "D", "Dave"); // 4 players -> threshold max(3, ceil(1.6)) = 3

    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("B", { photoId: photo.id, kind: "delete" });
    model.handleVote("C", { photoId: photo.id, kind: "delete" });
    expect(model.photos.length).toBe(1); // 2 flags < 3

    model.handleVote("D", { photoId: photo.id, kind: "delete" });
    expect(model.photos.length).toBe(0); // 3rd flag crosses the threshold
    expect(model.gameState).toBe(PresenterGameState.Gathering);
  });

  it("lets the author pull their own photo immediately (one flag)", () => {
    const { model } = makeModel();
    addPlayer(model, "A", "Alice");
    addPlayer(model, "B", "Bob");
    model.handleUpload("A", PHOTO);
    const photo = model.photos[0];

    model.handleVote("A", { photoId: photo.id, kind: "delete" });
    expect(model.photos.length).toBe(0);
    expect(model.gameState).toBe(PresenterGameState.Gathering);
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
