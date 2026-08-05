import { LEXIBLE_VERSION_HISTORY } from "../models/GameSettings";
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
  ClientHeader,
} from "libs";
import LexibleClientGameComponent from "./ClientGameComponent";
import { InstructionDemo } from "./InstructionDemo";
import { COZY, teamColor, mixWithWhite } from "./cozyTheme";

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
        {/* Rule on the LEFT, the board doing it on the RIGHT.  The caption is short
            enough to live in a narrow column, which buys the animation the width it
            needs to be watched rather than squinted at. */}
        <div className={styles.instructionsRow}>
          <p className={styles.instructionParagraph}>
            1. Claim tiles by finding words, starting from your team's territory.
          </p>
          <InstructionDemo step={1} size={66} />
        </div>
        <div className={styles.instructionsRow}>
          <p className={styles.instructionParagraph}>
            2. Capture tiles if your word score is bigger than the letter score.
          </p>
          <InstructionDemo step={2} size={66} />
        </div>
        <div className={styles.instructionsRow}>
          <p className={styles.instructionParagraph}>
            3. To win, be the first team to build a bridge to the other side! Tiles connect only if
            they share a side.
          </p>
          <InstructionDemo step={3} size={66} />
        </div>
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

    // The whole phone wears the team's colour.  Which team you are on is the
    // thing you most need to keep straight while playing - it decides which
    // letters you may start from and which tiles are worth taking - and a slim
    // accent stripe was easy to miss on a device you glance at.  The page is a
    // pale wash of the colour rather than the colour itself, so the tiles and
    // the text on top of it keep their contrast.
    const onATeam = appModel.myTeam === "A" || appModel.myTeam === "B";
    const teamAccent = teamColor(appModel.myTeam ?? "");
    const pageBackground = onATeam ? mixWithWhite(teamAccent, 0.22) : COZY.bg;

    return (
      <div style={{ background: pageBackground }}>
        <UINormalizer
          uiProperties={this.props.uiProperties}
          virtualHeight={1920}
          virtualWidth={1080}
          onScaleCalc={reportScale}
        >
          <div className={styles.gameclient} style={{ background: pageBackground }}>
            {/* The shared strip every game uses, so the quit button is in the same place
                whichever game you are playing. Lexible's own contribution is the team, which
                is the one fact a player has to keep straight while playing. */}
            <ClientHeader
              className={styles.topbar}
              style={
                onATeam
                  ? { background: teamAccent, color: "#fff", borderTop: `8px solid ${teamAccent}` }
                  : { borderTop: `8px solid ${teamAccent}` }
              }
              title="Lexible"
              history={LEXIBLE_VERSION_HISTORY}
              team={onATeam ? `TEAM ${appModel.myTeam}` : undefined}
              teamColor="rgba(255,255,255,0.28)"
              avatarId={appModel.avatarId}
              avatarColor={appModel.avatarColor}
              playerName={appModel.playerName}
              onQuit={() => appModel.quitApp()}
            />
            <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          </div>
        </UINormalizer>
      </div>
    );
  }
}
