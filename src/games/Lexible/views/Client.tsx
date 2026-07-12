// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LexibleClientModel, LexibleClientState } from "../models/ClientModel";
import styles from "./Client.module.css";
import classNames from "classnames";
import { observable } from "mobx";
import {
  UIProperties,
  GeneralGameState,
  SafeBrowser,
  GeneralClientGameState,
  UINormalizer,
  ErrorBoundary,
  Row,
} from "libs";
import LexibleClientGameComponent from "./ClientGameComponent";
import { InstructionDemo } from "./InstructionDemo";
import { COZY, teamColor } from "./cozyTheme";

interface InstructionsComponentProps {
  appModel?: LexibleClientModel;
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
class InstructionsComponent extends React.Component<InstructionsComponentProps> {
  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const switchTeam = () => {
      appModel.requestSwitchTeam();
    };

    return (
      <div>
        <div className={styles.wait_text}>Waiting for the host to start...</div>
        <Row>
          <div className={styles.teamPill}>
            <span
              className={styles.teamDot}
              style={{ background: teamColor(appModel.myTeam ?? "") }}
            />
            Team {appModel.myTeam}
          </div>
          <button onClick={switchTeam} style={{ fontSize: "80%", marginLeft: "50px" }}>
            Switch Team
          </button>
        </Row>
        <p>
          <b>How to play</b>
        </p>
        <div className={styles.instructionsRow}>
          <p>
            1. Claim tiles by spelling a word with adjacent letters. Tiles you claim will get a
            point value equal to the length of the word.
          </p>
          <InstructionDemo step={1} size={64} />
        </div>
        <div className={styles.instructionsRow}>
          <p>
            2. You can claim the other team's tiles, but make sure your word is long enough! If the
            word is not longer than a tile's score, it will not be claimed.
          </p>
          <InstructionDemo step={2} size={64} />
        </div>
        <p>
          3. TO WIN: Build a bridge of tiles that connect your team's side to the other side of the
          grid.{" "}
        </p>
        <InstructionDemo step={3} size={70} />
      </div>
    );
  }
}

class LexibleClientUIState {
  @observable mouseScale = 1;
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: LexibleClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;
  containerOffset = { left: 0, top: 0 };

  uiState = new LexibleClientUIState();

  // -------------------------------------------------------------------
  // When the component updates, learn about our overall offset
  // -------------------------------------------------------------------
  componentDidUpdate() {
    const container = document.getElementById(this.props.uiProperties.containerId) as HTMLElement;
    if (container) {
      var rect = container.getBoundingClientRect();
      this.containerOffset = { left: rect.left, top: rect.top };
    }
  }

  // -------------------------------------------------------------------
  // Do something to alert the user if the game state changed
  // -------------------------------------------------------------------
  alertUser() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    if (appModel.gameState !== this.lastState) {
      SafeBrowser.vibrate([50, 50, 50, 50]);
    }
    this.lastState = appModel.gameState as string;
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    switch (appModel.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return <InstructionsComponent />;
      case GeneralClientGameState.Paused:
        return <div>Game has been paused</div>;
      case LexibleClientState.Playing:
        this.alertUser();
        return (
          <LexibleClientGameComponent
            clientId={this.props.uiProperties.containerId}
            playerId={appModel.playerId}
            mouseScale={this.uiState.mouseScale}
          />
        );
      case LexibleClientState.EndOfRound:
        this.alertUser();
        return <div>Round is over. Team {appModel.winningTeam} is the winner. </div>;
      case GeneralGameState.GameOver:
        return (
          <React.Fragment>
            <p>Game is over, thanks for playing!</p>
            <div>
              <button onClick={() => this.props.appModel?.quitApp()}>Quit</button>
            </div>
          </React.Fragment>
        );
      case GeneralClientGameState.JoinError:
        return (
          <React.Fragment>
            <p
              style={{
                background: "#F6D8CE",
                color: "#8A2E10",
                fontSize: "150%",
                borderRadius: "16px",
                padding: "16px 22px",
              }}
            >
              Could not join the game because: {this.props.appModel?.joinError}
            </p>
          </React.Fragment>
        );

      default:
        return <div>UNKNOWN CLIENT STATE: {appModel.gameState}</div>;
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const reportScale = (scale: number) => {
      this.uiState.mouseScale = 0.5 / scale;
    };

    // Keep the page cream so the tiles read well; the team color is used only
    // as a slim accent (the top bar's top border + the team pill dot).
    const pageBackground = COZY.bg;
    const teamAccent = teamColor(appModel.myTeam ?? "");

    return (
      <div style={{ background: pageBackground }}>
        <UINormalizer
          uiProperties={this.props.uiProperties}
          virtualHeight={1920}
          virtualWidth={1080}
          onScaleCalc={reportScale}
        >
          <div className={styles.gameclient} style={{ background: pageBackground }}>
            <div
              className={classNames(styles.divRow, styles.topbar)}
              style={{ borderTop: `8px solid ${teamAccent}` }}
            >
              <span className={classNames(styles.gametitle)}>Lexible</span>
              <span>{appModel.playerName}</span>
              <button className={classNames(styles.quitbutton)} onClick={() => appModel.quitApp()}>
                X
              </button>
            </div>
            <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          </div>
        </UINormalizer>
      </div>
    );
  }
}
