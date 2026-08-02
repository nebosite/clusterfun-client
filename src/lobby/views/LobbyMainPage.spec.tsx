import { LobbyMainPage } from "./LobbyMainPage";
import { LobbyState } from "../models/LobbyModel";
import { SafeBrowser } from "libs/Browser/SafeBrowser";

// -------------------------------------------------------------------
// The browser's history belongs to the PAGE, and the Test Lobby puts five lobbies on one
// page.  When each of them drove the history, one phone's X called history.back(), which
// every other lobby heard as the Back button and left the game on - the presenter with it.
//
// These drive the component's lifecycle directly rather than rendering it: what is under
// test is the wiring to window, not any markup.
// -------------------------------------------------------------------

function stubModel(lobbyState: LobbyState, left: { count: number }) {
  return {
    id: "lobby1",
    lobbyState,
    gameProperties: { gameName: "Eittris" },
    onUserChoseAMode: { subscribe: () => {} },
    leaveGame: () => left.count++,
  } as any;
}

function makePage(manageHistory: boolean | undefined, lobbyState: LobbyState) {
  const left = { count: 0 };
  const page = new LobbyMainPage({
    lobbyModel: stubModel(lobbyState, left),
    games: [],
    manageHistory,
    size: () => ({ width: 100, height: 100 }),
  });
  return { page, left };
}

describe("LobbyMainPage - who owns the Back button", () => {
  let pushed: string[];
  let dropped: number;
  let originalPush: any;
  let originalDrop: any;

  beforeEach(() => {
    pushed = [];
    dropped = 0;
    originalPush = SafeBrowser.pushRoute;
    originalDrop = SafeBrowser.dropRoute;
    // Stub at SafeBrowser rather than at window.history: what the page is responsible for
    // is asking for a route change, and jsdom's history is not ours to assert on.
    SafeBrowser.pushRoute = (hash: string) => {
      pushed.push(hash);
    };
    SafeBrowser.dropRoute = () => {
      dropped++;
    };
  });

  afterEach(() => {
    SafeBrowser.pushRoute = originalPush;
    SafeBrowser.dropRoute = originalDrop;
  });

  it("leaves the game when Back is pressed on the page that owns the history", () => {
    const { page, left } = makePage(undefined, LobbyState.ReadyToPlay);
    page.componentDidMount();
    (page as any).inGameRoute = true;

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(left.count).toBe(1);
    page.componentWillUnmount();
  });

  it("ignores Back entirely when it does not own the history", () => {
    // This is the whole fix: one lobby of five quitting must not take the rest with it.
    const { page, left } = makePage(false, LobbyState.ReadyToPlay);
    page.componentDidMount();
    (page as any).inGameRoute = true;

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(left.count).toBe(0);
    page.componentWillUnmount();
  });

  it("pushes a route on the way into a game, and drops it on the way out", () => {
    const { page } = makePage(undefined, LobbyState.ReadyToPlay);
    (page as any).syncRoute();
    expect(pushed).toEqual(["#eittris"]);

    page.props.lobbyModel.lobbyState = LobbyState.Fresh;
    (page as any).syncRoute();
    expect(dropped).toBe(1);
  });

  it("touches no history at all when it does not own it", () => {
    const { page } = makePage(false, LobbyState.ReadyToPlay);
    (page as any).syncRoute();
    page.props.lobbyModel.lobbyState = LobbyState.Fresh;
    (page as any).syncRoute();

    expect(pushed).toEqual([]);
    expect(dropped).toBe(0);
  });

  it("does not walk out of a game it was never in", () => {
    const { page, left } = makePage(undefined, LobbyState.Fresh);
    page.componentDidMount();

    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(left.count).toBe(0);
    page.componentWillUnmount();
  });
});
