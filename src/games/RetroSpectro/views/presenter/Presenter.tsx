// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import {
  RetroSpectroGameState,
  RetroSpectroGameEvent,
  RetroSpectroPresenterModel,
} from "../../models/PresenterModel";
import {
  UIProperties,
  UINormalizer,
  DevOnly,
  DevUI,
  GeneralGameState,
  PresenterGameEvent,
  PresenterGameState,
} from "libs";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import { MediaHelper } from "libs/Media/MediaHelper";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { RetroSpectroVersion } from "../../models/GameSettings";
import RetroSpectroAssets from "../../assets/Assets";
import AnswerSortingBox from "./AnswerSortingBox";
import { DiscussionPage } from "./DiscussionPage";

@inject("appModel")
@observer
class GatheringPlayersPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <div>
        <h2>Welcome to {appModel.name}</h2>
        <p className={styles.lead}>
          A fast, structured retrospective. Invite the team to join from their own devices and
          we&apos;ll help surface what&apos;s on everyone&apos;s mind.
        </p>

        <div className={styles.contentGrid} style={{ marginTop: 20 }}>
          <div className={styles.panel}>
            <div className={styles.sectionLabel}>To join</div>
            <ol className={styles.joinSteps}>
              <li>
                On any browser, go to{" "}
                <span className={styles.joinUrl}>http://{window.location.host}</span>
              </li>
              <li>
                Enter the room code <span className={styles.joinCodeInline}>{appModel.roomId}</span>
              </li>
            </ol>
            <p className={styles.waitingNote}>
              Hosting? Join from your own device or a second browser window too.
            </p>
          </div>

          <div className={styles.panel}>
            <div className={styles.sectionLabel}>Joined&nbsp;·&nbsp;{appModel.players.length}</div>
            {appModel.players.length > 0 ? (
              <div className={styles.nameGrid}>
                {appModel.players.map((player) => (
                  <div className={styles.nameBox} key={player.playerId}>
                    {player.name}
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.waitingNote}>No one has joined yet.</p>
            )}
          </div>
        </div>

        <div style={{ marginTop: 24 }}>
          {appModel.players.length < appModel.minPlayers ? (
            <p className={styles.waitingNote}>
              Waiting for at least {appModel.minPlayers} players to join…
            </p>
          ) : (
            <button className={styles.presenterButton} onClick={() => appModel.startGame()}>
              Start the retrospective
            </button>
          )}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// InstructionsPage
// -------------------------------------------------------------------
@inject("appModel")
@observer
class InstructionsPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    return (
      <div>
        <h2>How this works</h2>
        <div className={styles.instructions}>
          <div className={styles.stepRow}>
            <div className={styles.stepNum}>1</div>
            <div>
              <div className={styles.stepTitle}>Brainstorm</div>
              <div className={styles.stepBody}>
                Pick a topic — &ldquo;How did last week go?&rdquo; or anything. Enter thoughts as
                fast as they come, up to five words each. (Note: entries are not anonymous in the
                discussion stage.)
              </div>
            </div>
          </div>
          <div className={styles.stepRow}>
            <div className={styles.stepNum}>2</div>
            <div>
              <div className={styles.stepTitle}>Categorize</div>
              <div className={styles.stepBody}>
                When the timer ends, drag the ideas together to group them by theme.
              </div>
            </div>
          </div>
          <div className={styles.stepRow}>
            <div className={styles.stepNum}>3</div>
            <div>
              <div className={styles.stepTitle}>Talk</div>
              <div className={styles.stepBody}>
                Groups come up one at a time, biggest first. Discuss why each idea came up, whether
                you agree, and what to do about it. Capture notes and tasks, then move on.
              </div>
            </div>
          </div>
        </div>
        <button className={styles.letsGo} onClick={() => this.props.appModel?.startNextRound()}>
          We have a topic — let&apos;s start
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// WaitingForAnswersPage
// -------------------------------------------------------------------
@inject("appModel")
@observer
class WaitingForAnswersPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    const low = appModel.secondsLeftInStage <= 15;

    return (
      <div className={styles.answeringPage}>
        <div>
          <h2>Brainstorm</h2>
          <p className={styles.lead}>
            Enter your ideas — see your device for instructions. Join any time at{" "}
            <span className={styles.joinUrl}>http://{window.location.host}</span>.
          </p>
        </div>

        <div className={styles.timerBar}>
          <div className={styles.secondsCounterRow}>
            <span className={styles.timerLabel}>Time left</span>
            <span
              className={classNames(styles.secondsCounter, { [styles.secondsCounterLow]: low })}
            >
              {appModel.secondsLeftInStage}
            </span>
          </div>
          <span className={styles.timerLabel}>Add time</span>
          <button className={styles.discussionButton} onClick={() => appModel.addTime(10)}>
            +10s
          </button>
          <button className={styles.discussionButton} onClick={() => appModel.addTime(60)}>
            +1m
          </button>
          <div className={styles.timerSpacer} />
          <span className={styles.answerCountPill}>
            {appModel.answerCollections.length} ideas in
          </span>
          <DevOnly>
            <button className={styles.discussionButton} onClick={() => appModel.generateAnswers()}>
              Make answers
            </button>
          </DevOnly>
        </div>

        <div className={styles.answerList}>
          {appModel.answerCollections.map((a) => (
            <div
              className={classNames(styles.answerChip, {
                [styles.chipPositive]: a.answers[0].answerType === "Positive",
                [styles.chipNegative]: a.answers[0].answerType !== "Positive",
              })}
              key={a.id}
            >
              <img
                className={styles.lightbulb}
                src={RetroSpectroAssets.images.lightbulb}
                alt="idea"
              />
            </div>
          ))}
        </div>

        <div>
          <button className={styles.presenterButton} onClick={() => appModel.finishRound()}>
            Done — start categorizing
          </button>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// SortingAnswersPage
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SortingAnswersPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <DndProvider backend={HTML5Backend}>
        <div>
          <div className={styles.discussionHeader}>
            <div>
              <h2>Categorize</h2>
              <p className={styles.sortHint}>
                Drag and drop to group similar ideas. Use +/− to weight the strongest ones.
              </p>
            </div>
            <button className={styles.presenterButton} onClick={() => appModel.doneSorting()}>
              Done — discuss
            </button>
          </div>
          <AnswerSortingBox context={appModel} />
        </div>
      </DndProvider>
    );
  }
}

// -------------------------------------------------------------------
// GameOverPage
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameOverPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <div>
        <h2>Retrospective complete</h2>
        <div className={styles.sectionLabel} style={{ marginTop: 16 }}>
          Final scores
        </div>
        {appModel.players.map((p) => (
          <div
            key={p.playerId}
            className={classNames(styles.scoreRow, { [styles.scoreWinner]: p.winner })}
          >
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)" }}>{p.totalScore}</span>
            {p.winner ? <span className={styles.winnerTag}>Winner</span> : null}
          </div>
        ))}
        <div className={styles.divRow} style={{ gap: 12, marginTop: 20 }}>
          <button className={styles.discussionButton} onClick={() => appModel.playAgain()}>
            Play again
          </button>
          <button className={styles.presenterButton} onClick={() => appModel.quitApp()}>
            Quit
          </button>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// PausePage
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PausePage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <div>
        <h2>Paused</h2>
        <p className={styles.lead}>Waiting for players to rejoin.</p>
        <div className={styles.sectionLabel} style={{ marginTop: 16 }}>
          Current players
        </div>
        <div className={styles.nameGrid}>
          {appModel.players.map((player) => (
            <div className={styles.nameBox} key={player.playerId}>
              {player.name}
            </div>
          ))}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Presenter Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Presenter extends React.Component<{
  appModel?: RetroSpectroPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    props: Readonly<{ appModel?: RetroSpectroPresenterModel; uiProperties: UIProperties }>,
  ) {
    super(props);

    const { appModel } = this.props;
    if (!appModel) throw Error("No appModel");

    // Set up sound effects
    this.media = new MediaHelper();
    for (let soundName in RetroSpectroAssets.sounds) {
      this.media.loadSound((RetroSpectroAssets.sounds as any)[soundName]);
    }

    const sfxVolume = 1.0;

    let timeAlertLoaded = false;
    appModel.onTick.subscribe("Timer Watcher", () => {
      if (appModel.secondsLeftInStage > 15) timeAlertLoaded = true;
      if (
        appModel.gameState === RetroSpectroGameState.WaitingForAnswers &&
        timeAlertLoaded &&
        appModel.secondsLeftInStage <= 15
      ) {
        timeAlertLoaded = false;
        this.media.repeatSound(RetroSpectroAssets.sounds.ding, 5, 100);
      }
    });
    appModel.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(RetroSpectroAssets.sounds.response, { volume: sfxVolume * 0.5 }),
    );
    appModel.subscribe(RetroSpectroGameEvent.ResponseReceived, "play response received sound", () =>
      this.media.playSound(RetroSpectroAssets.sounds.ding, { volume: sfxVolume }),
    );
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) {
      console.log("NO GAME DATA.  Quitting...");
      return;
    }

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case RetroSpectroGameState.Instructions:
        return <InstructionsPage />;
      case RetroSpectroGameState.WaitingForAnswers:
        return <WaitingForAnswersPage />;
      case RetroSpectroGameState.Sorting:
        return <SortingAnswersPage />;
      case RetroSpectroGameState.Discussing:
        return <DiscussionPage />;
      case GeneralGameState.GameOver:
        return <GameOverPage />;
      case GeneralGameState.Paused:
        return <PausePage />;
      default:
        return <div>Unhandled game state: {appModel.gameState}</div>;
    }
  }

  // -------------------------------------------------------------------
  // renderFrame
  // -------------------------------------------------------------------
  private renderFrame() {
    const { appModel } = this.props;
    if (!appModel) return <div>No Data</div>;

    return (
      <div className={styles.navbar}>
        <img src={RetroSpectroAssets.images.logo} alt="RetroSpectro" className={styles.icon} />
        <div className={styles.brand}>
          <span className={styles.appTitle}>RetroSpectro</span>
          <span className={styles.appVersion}>v{RetroSpectroVersion}</span>
        </div>
        <div className={styles.roomCode}>
          Room code <span className={styles.roomCodeValue}>{appModel.roomId}</span>
        </div>
        <DevUI context={appModel} />
        <button className={styles.ghostButton} onClick={() => appModel.quitApp()}>
          Quit
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    return (
      <UINormalizer
        className={styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        {this.renderFrame()}
        <div className={styles.pageContent}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
