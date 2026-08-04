import { ISessionHelper, ITelemetryLogger, IStorage } from "libs";
import { LexibleGameEvent, LexiblePresenterModel } from "./PresenterModel";
import { WordTree } from "./WordTree";
import { LetterGridModel } from "./LetterGridModel";

// ==========================================================================================
// A submission must be scored ONCE, however many times it arrives.
//
// LexibleSubmitWordEndpoint retries after 2s.  Speaking an accepted word on the WASM speech
// backend blocks the presenter's thread for about the same, so the phone gives up waiting and
// resends while the presenter is still mid-synthesis.  Observed live, not theorised.
//
// The SCORE happens to survive this: a word cannot beat its own score, so `word.length >
// block.score` is false the second time and no tile changes hands.  What does not survive is
// everything else placeSuccessfulWord does - the WordAccepted event fires again, so the room
// hears the word read out twice, and the board broadcast, win check and checkpoint all run
// again for nothing.
// ==========================================================================================

function memoryStorage(): IStorage {
  const map = new Map<string, string>();
  return {
    set: (n, v) => void (v ? map.set(n, v) : map.delete(n)),
    get: (n) => map.get(n) ?? null,
    remove: (n) => void map.delete(n),
    clear: () => map.clear(),
  };
}

function fakeSession(): ISessionHelper {
  return {
    roomId: "ROOM",
    personalId: "HOST",
    personalSecret: "secret",
    sendMessage: () => {},
    listen: () => ({ unsubscribe: () => {} }),
    listenPresenter: () => ({ unsubscribe: () => {} }),
    request: () => Promise.resolve(undefined),
    requestPresenter: () => Promise.resolve(undefined),
    sendMessageToPresenter: () => {},
    addClosedListener: () => {},
    removeClosedListener: () => {},
    onError: () => {},
    serverCall: () => Promise.resolve(undefined),
    stats: { sentCount: 0, bytesSent: 0, recievedCount: 0, bytesRecieved: 0 },
  } as unknown as ISessionHelper;
}

const silentLogger: ITelemetryLogger = {
  logEvent: () => {},
  logPageView: () => {},
  logAnalyticsEvent: () => {},
};

const built: LexiblePresenterModel[] = [];
afterEach(() => {
  while (built.length) built.pop()!.shutdown();
});

/** A presenter with a tiny known board and dictionary, and one joined player. */
async function presenterWithBoard() {
  const model = new LexiblePresenterModel(fakeSession(), silentLogger, memoryStorage());
  built.push(model);
  model.minPlayers = 1;

  // A 3x2 board spelling CAT along the top row, every tile neutral.
  const grid = new LetterGridModel(3, 2);
  grid.populate("C_0A_0T_0X_0X_0X_0");
  model.theGrid = grid;
  model.theGrid.processBlocks((b) => model.setBlockHandlers(b));

  model.wordSet = new Set(["CAT"]);
  model.wordTree = new WordTree("", undefined);
  model.wordTree.add("CAT");
  model.badWords = new Set<string>();

  await model.handleJoinMessage("conn-1", { playerName: "Alice", playerToken: "token-alice" });
  const player = model.players[0];
  player.teamName = "A";
  // Words must start on your own tile by default; give Alice the C.
  grid.getBlock({ x: 0, y: 0 } as any)!.setScore(1, "A");
  return { model, player };
}

const catSubmission = {
  letters: [
    { letter: "C", coordinates: { x: 0, y: 0 } as any },
    { letter: "A", coordinates: { x: 1, y: 0 } as any },
    { letter: "T", coordinates: { x: 2, y: 0 } as any },
  ],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("a resent submission", () => {
  it("is announced once, so the room does not hear the word twice", async () => {
    const { model, player } = await presenterWithBoard();
    const announced: string[] = [];
    model.subscribe(LexibleGameEvent.WordAccepted, "count", (word: string) => announced.push(word));

    const first = model.handleSubmitWordMessage(player.playerId, catSubmission as any);
    // The phone gave up waiting and sent it again.
    const second = model.handleSubmitWordMessage(player.playerId, catSubmission as any);
    await flush();

    // The phone must still be told it worked - a retry answered with failure
    // would flash the letters red for a word that was actually accepted.
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    // ...and the word is read out exactly once.
    expect(announced).toEqual(["cat"]);
  });

  it("leaves the board exactly as the first submission left it", async () => {
    const { model, player } = await presenterWithBoard();

    model.handleSubmitWordMessage(player.playerId, catSubmission as any);
    const scoreAfterFirst = model.theGrid.getBlock({ x: 2, y: 0 } as any)!.score;
    const capturesAfterFirst = player.captures;

    model.handleSubmitWordMessage(player.playerId, catSubmission as any);

    expect(model.theGrid.getBlock({ x: 2, y: 0 } as any)!.score).toBe(scoreAfterFirst);
    expect(player.captures).toBe(capturesAfterFirst);
  });

  it("still rejects a genuinely bad word every time", async () => {
    const { model, player } = await presenterWithBoard();
    const nonsense = {
      letters: [
        { letter: "C", coordinates: { x: 0, y: 0 } as any },
        { letter: "T", coordinates: { x: 2, y: 0 } as any },
      ],
    };
    // A failed submission is not remembered - the player may well try the same
    // letters again after the board changes under them.
    expect(model.handleSubmitWordMessage(player.playerId, nonsense as any).success).toBe(false);
    expect(model.handleSubmitWordMessage(player.playerId, nonsense as any).success).toBe(false);
  });

  it("does not confuse two players submitting the same letters", async () => {
    const { model, player } = await presenterWithBoard();
    await model.handleJoinMessage("conn-2", { playerName: "Bob", playerToken: "token-bob" });
    const bob = model.players[1];
    bob.teamName = "B";

    const alice = model.handleSubmitWordMessage(player.playerId, catSubmission as any);
    // Bob's identical letters are a different submission and must be judged on
    // their own merits, not answered from Alice's cache.
    const bobResult = model.handleSubmitWordMessage(bob.playerId, catSubmission as any);

    expect(alice.success).toBe(true);
    expect(bobResult).toBeDefined();
  });
});
