// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import {
  AnswerType,
  RetroSpectroClientModel,
  RetroSpectroClientState,
} from "../../models/ClientModel";
import { UIProperties, UINormalizer, GeneralGameState, GeneralClientGameState } from "libs";
import styles from "./Client.module.css";
import { ErrorBoundary } from "libs/components/ErrorBoundary";
import { SafeBrowser } from "libs/Browser/SafeBrowser";
import classNames from "classnames";

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: RetroSpectroClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;
  containerOffset = { left: 0, top: 0 };

  // -------------------------------------------------------------------
  // When the component updates, learn about our overall offset
  // -------------------------------------------------------------------
  componentDidUpdate() {
    // TODO: update any calculated coordinates here.  (See Foomius)
  }

  // -------------------------------------------------------------------
  // Do something to alert the user if the game state changed
  // -------------------------------------------------------------------
  alertUser() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

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
    if (!appModel) return <div>No Data</div>;

    switch (appModel.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return (
          <div className={styles.wait_text}>
            Sit tight — waiting for the host to start the retrospective…
          </div>
        );
      case RetroSpectroClientState.SubmittingAnswers:
        this.alertUser();
        return (
          <React.Fragment>
            <div className={styles.heading}>Brainstorm</div>
            <p>
              Write down whatever pops into your head — there are no good or bad ideas. Summarize
              each in five words or less.
            </p>
            <input
              className={styles.field}
              type="text"
              placeholder="Your idea…"
              value={appModel.currentAnswer}
              onChange={(ev) => {
                appModel.currentAnswer = ev.target.value;
              }}
            />
            <div className={styles.submitRow}>
              <button
                className={classNames(styles.submitButton, styles.buttonPositive)}
                disabled={!appModel.currentAnswerOK}
                onClick={() => appModel.submitAnswer(AnswerType.Positive)}
              >
                👍 Positive
              </button>
              <button
                className={classNames(styles.submitButton, styles.buttonNegative)}
                disabled={!appModel.currentAnswerOK}
                onClick={() => appModel.submitAnswer(AnswerType.Negative)}
              >
                👎 Negative
              </button>
            </div>
            <div className={styles.submitHint}>
              Tag each idea as something that went well or not.
            </div>
            <div className={styles.examples}>
              <div className={styles.examplesLabel}>Examples</div>
              <span className={styles.exampleChip}>Bug tracking system</span>
              <span className={styles.exampleChip}>Fred Fenning</span>
              <span className={styles.exampleChip}>Coffee machine</span>
            </div>
          </React.Fragment>
        );
      case RetroSpectroClientState.Sorting:
        return (
          <React.Fragment>
            <div className={styles.heading}>Categorizing</div>
            <p>
              The host is grouping everyone&apos;s ideas into categories. Feel free to suggest how
              to group them.
            </p>
          </React.Fragment>
        );
      case RetroSpectroClientState.Discussing:
        if (appModel.hasOnscreenAnswer) this.alertUser();
        return (
          <React.Fragment>
            <div className={styles.heading}>Discussion</div>
            <p>The team is talking through a category on the shared screen.</p>
            {appModel.hasOnscreenAnswer ? (
              <div className={styles.answerAlert}>
                One of your ideas is on screen — tell us more!
              </div>
            ) : null}
          </React.Fragment>
        );

      case GeneralGameState.GameOver:
        return (
          <React.Fragment>
            <div className={styles.heading}>Thanks for playing!</div>
            <p>The retrospective has wrapped up.</p>
            <button className={styles.primaryButton} onClick={() => appModel.quitApp()}>
              Quit
            </button>
          </React.Fragment>
        );
      case GeneralClientGameState.JoinError:
        return (
          <React.Fragment>
            <div className={styles.heading}>Couldn&apos;t join</div>
            <p>{appModel.joinError}</p>
          </React.Fragment>
        );

      default:
        return <div>These are not the droids you are looking for… ({appModel.gameState})</div>;
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <div>
        <UINormalizer
          uiProperties={this.props.uiProperties}
          virtualHeight={1920}
          virtualWidth={1080}
        >
          <div className={styles.gameclient}>
            <div className={styles.topbar}>
              <span className={styles.gametitle}>RetroSpectro</span>
              <span className={styles.playerName}>{appModel.playerName}</span>
              <button className={styles.quitbutton} onClick={() => appModel.quitApp()}>
                ✕
              </button>
            </div>
            <div className={styles.content}>
              <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
            </div>
          </div>
        </UINormalizer>
      </div>
    );
  }
}
