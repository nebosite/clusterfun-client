// App Navigation handled here
import React from "react";
import { observer, Provider } from "mobx-react";
import { LobbyState, LobbyModel } from "../models/LobbyModel";
import { LobbyComponent } from "../Components/LobbyComponent";
import { getGameComponent } from "../../GameChooser";
import { SafeBrowser } from "libs/Browser/SafeBrowser";
import Logger from "js-logger";
import { GameDescriptor } from "games/lists/GameDescriptor";

export interface LobbyMainPageProps {
  games: GameDescriptor[];
  lobbyModel: LobbyModel;
  size?: () => { width: number; height: number };
  /**
   * Whether this page owns the browser's history and Back button.  True for the app, which
   * is one lobby filling the window.  FALSE wherever several lobbies share a page - there is
   * only one history between them, so each one pushing and popping it makes every quit look
   * to the others like somebody pressed Back.
   */
  manageHistory?: boolean;
}

// -------------------------------------------------------------------
// MainPage
// -------------------------------------------------------------------
@observer
export class LobbyMainPage extends React.Component<
  LobbyMainPageProps,
  { size: { width: number; height: number } }
> {
  getSize: () => { width: number; height: number };

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: LobbyMainPageProps) {
    super(props);
    if (!props.size) {
      this.getSize = () => {
        return { width: window.innerWidth - 3, height: window.innerHeight - 3 };
      };
    } else {
      this.getSize = props.size;
    }
    this.state = { size: this.getSize() };
    props.lobbyModel.onUserChoseAMode.subscribe("resize on mode change", () =>
      this.sizeChangeHandler(),
    );
  }

  // -------------------------------------------------------------------
  // hook up size change event
  // -------------------------------------------------------------------
  componentDidMount() {
    window.addEventListener("resize", this.sizeChangeHandler);
    if (this.ownsHistory) {
      this.stopListeningForBack = SafeBrowser.onPopState(this.onPopState);
    }
  }
  componentWillUnmount() {
    window.removeEventListener("resize", this.sizeChangeHandler);
    this.stopListeningForBack?.();
  }
  private stopListeningForBack?: () => void;
  private sizeChangeHandler = () => {
    if (this.getSize) {
      const size = this.getSize();
      setTimeout(() => {
        this.setState({ size });
        this.forceUpdate();
      }, 0);
    }
  };

  // -------------------------------------------------------------------
  // The Back button.
  //
  // Opening a game pushes a history entry, so Back steps out of the game and lands in
  // the lobby instead of leaving the site altogether - which is what a phone's back
  // gesture would otherwise do, mid-round.  A hash rather than a real path, because the
  // relay serves this as a static bundle: a deep path would 404 on refresh, a hash
  // cannot.
  //
  // The history is the PAGE's, not this component's, so a page showing several lobbies at
  // once (the Test Lobby: a presenter and four phones side by side) must not let each of
  // them drive it.  One quitting would call history.back(), and every other lobby on the
  // page would hear that popstate and leave the game too - one X closing all five.
  // -------------------------------------------------------------------
  private inGameRoute = false;

  private get ownsHistory() {
    return this.props.manageHistory !== false;
  }

  private onPopState = () => {
    // Back out of a game.  If we are not in one there is nothing to leave.
    if (!this.inGameRoute) return;
    this.inGameRoute = false;
    this.props.lobbyModel.leaveGame();
  };

  private syncRoute() {
    if (!this.ownsHistory) return;
    const inGame = this.props.lobbyModel.lobbyState === LobbyState.ReadyToPlay;
    if (inGame === this.inGameRoute) return;
    this.inGameRoute = inGame;
    const name = this.props.lobbyModel.gameProperties?.gameName ?? "game";
    if (inGame) {
      SafeBrowser.pushRoute(`#${name.toLowerCase()}`);
    } else {
      // Left by some other route - Quit, or the host ending it.  Drop the entry we
      // pushed so Back does not walk into a game that is over.
      SafeBrowser.dropRoute();
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    this.syncRoute();
    const { lobbyModel, games } = this.props;
    let innerChild: any;
    const uiProperties = {
      containerWidth: this.state.size.width,
      containerHeight: this.state.size.height,
      containerId: `LobbyContainer_${lobbyModel.id}`,
    };

    try {
      switch (lobbyModel.lobbyState) {
        case LobbyState.Fresh:
          innerChild = <LobbyComponent uiProperties={uiProperties} games={this.props.games} />;
          break;
        case LobbyState.ReadyToPlay:
          const gameName = lobbyModel.gameProperties!.gameName;
          const descriptor = games.find((i) => i.name === gameName);
          if (!descriptor) throw Error(`Could not find game '${gameName}'`);
          innerChild = getGameComponent(descriptor!, lobbyModel.getGameConfig(uiProperties));
          break;
      }
    } catch (err) {
      Logger.info("LobbyMainPage error: " + (err as any).message);
      innerChild = (
        <React.Fragment>
          <div style={{ background: "white", fontSize: "30px" }}>
            There was an error: {(err as any).message}
          </div>
        </React.Fragment>
      );
    }

    return (
      <Provider lobbyModel={lobbyModel}>
        <div style={{ width: "100%", height: "100%" }} key={lobbyModel.id}>
          {innerChild}
        </div>
      </Provider>
    );
  }
}
