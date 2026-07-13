// The shared-screen view.  One page component per presenter game state, chosen by
// renderSubScreen().  All of these are observers over the presenter model - they
// render state; they never own it.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import { makeObservable, observable } from "mobx";
import TemplateAssets from "../assets/Assets";
import { TemplateVersion } from "../models/GameSettings";
import {
  BaseAnimationController,
  MediaHelper,
  UIProperties,
  PresenterGameEvent,
  PresenterGameState,
  GeneralGameState,
  DevUI,
  UINormalizer,
  PlayerAvatar,
} from "libs";
import {
  TemplatePresenterModel,
  TemplateGameState,
  TemplateGameEvent,
} from "../models/PresenterModel";

@inject("appModel")
@observer
class GatheringPlayersPage extends React.Component<{ appModel?: TemplatePresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div>
        <h3>Welcome to {appModel.name}</h3>
        <p>This is the ClusterFun template game.</p>
        <p>
          To Join: go to http://{window.location.host} and enter this room code: {appModel.roomId}
        </p>
        {appModel.players.length > 0 ? (
          <div>
            <p style={{ fontWeight: 600 }}>Joined team members:</p>
            <div className={styles.divRow}>
              {appModel.players.map((player) => (
                <div className={styles.nameBox} key={player.playerId}>
                  <PlayerAvatar avatarId={player.avatarId} size={48} /> {player.name}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {appModel.players.length < appModel.minPlayers ? (
          <div>{`Waiting for at least ${appModel.minPlayers} players to join ...`}</div>
        ) : (
          <button className={styles.presenterButton} onClick={() => appModel.startGame()}>
            Click here to start!
          </button>
        )}
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedGamePage extends React.Component<{ appModel?: TemplatePresenterModel }> {
  // -------------------------------------------------------------------
  // resumeGame
  // -------------------------------------------------------------------
  private resumeGame = () => {
    this.props.appModel?.resumeGame();
  };

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <p>{appModel.name} is paused</p>
        <p>Current players in the room:</p>
        <ul>
          {appModel.players.map((player) => (
            <li key={player.playerId}>
              <PlayerAvatar avatarId={player.avatarId} size={32} /> {player.name}
            </li>
          ))}
        </ul>
        <button
          className={styles.button}
          disabled={appModel.players.length < appModel.minPlayers}
          onClick={() => this.resumeGame()}
        >
          Resume Game
        </button>
      </div>
    );
  }
}

// An example of a scripted, multi-step animation (round intro).  Each step runs
// after its delay; slide() drives smooth per-frame motion.
class PlayStartAnimationController extends BaseAnimationController {
  @observable announceText = " ";
  @observable textLocation: string | null = null;
  @observable showStatus: boolean = false;

  constructor(onFinish: () => void) {
    super(onFinish);
    // Activate the @observable decorators - without this the observer
    // components never see announceText/showStatus change.
    makeObservable(this);

    const textAnimation = (fraction: number) => {
      const x = 0.01 + 0.01 * Math.sin(fraction * 20);
      this.textLocation = `${(x * 100).toFixed(2)}%`;
    };

    // set up a set of sequential animations
    // delay_s = how many seconds to wait before the action happens
    this.run([
      {
        delay_s: 1.0,
        id: "Introduce Round",
        action: (c) => {
          this.announceText = "Here we go...";
          this.slide(1, textAnimation);
        },
      },
      {
        delay_s: 2.0,
        id: "heads up!",
        action: (c) => {
          this.announceText = "Instructions are on your devices";
        },
      },
      {
        delay_s: 4.0,
        id: "Now play",
        action: (c) => {
          this.showStatus = true;
        },
      },
    ]);
  }
}

@inject("appModel")
@observer
class PlayingPage extends React.Component<{
  appModel?: TemplatePresenterModel;
  media: MediaHelper;
}> {
  private _playStartAnimation: PlayStartAnimationController;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: Readonly<{ appModel?: TemplatePresenterModel; media: MediaHelper }>) {
    super(props);
    this._playStartAnimation = new PlayStartAnimationController(() => {});
    props.appModel!.registerAnimation(this._playStartAnimation);

    props.appModel!.onTick.subscribe("animate", (e) => this.animateFrame(e));
  }

  // -------------------------------------------------------------------
  // animateFrame - render a single animation frame to the canvas
  // -------------------------------------------------------------------
  animateFrame = (elapsed_ms: number) => {
    const canvas = document.getElementById("presenterGameCanvas") as HTMLCanvasElement;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#888888";
    const w = canvas.width;
    const h = canvas.height;
    context.fillRect(0, 0, w, h);

    this.props.appModel?.players.forEach((p) => {
      const px = p.x * h;
      const py = p.y * h * 0.9 + h * 0.05;
      context.font = "50px serif";
      let label = `${p.name} (${p.totalScore})`;
      if (p.message !== "") label += ` says '${p.message}'`;
      context.fillStyle = "#777777";
      context.fillText(label, px + 4, py + 4);
      context.fillStyle = p.colorStyle;
      context.fillText(label, px, py);
    });
  };

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        {this._playStartAnimation.showStatus ? (
          <div className={styles.divRow}>
            <div>
              Playing round {appModel.currentRound}. Seconds left: {appModel.secondsLeftInStage}
            </div>
            <div className={styles.scoreStrip}>
              {appModel.players.map((p) => (
                <span className={styles.scoreItem} key={p.playerId}>
                  <PlayerAvatar avatarId={p.avatarId} size={36} /> {p.name}: {p.totalScore}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ paddingLeft: this._playStartAnimation.textLocation ?? "0px" }}>
            &nbsp;{this._playStartAnimation.announceText}
          </div>
        )}
        <div className={styles.gameCanvasFrame}>
          <canvas
            className={styles.gameCanvas}
            width="1200px"
            height="700px"
            id="presenterGameCanvas"
          />
        </div>
      </div>
    );
  }
}

@inject("appModel")
@observer
class EndOfRoundPage extends React.Component<{ appModel?: TemplatePresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const winners = appModel.winners;
    return (
      <div>
        <div>End of round {appModel.currentRound}</div>
        {appModel.gameState === GeneralGameState.GameOver ? (
          <div>
            <div className={styles.winnerBanner}>
              {winners.map((w) => (
                <PlayerAvatar avatarId={w.avatarId} size={64} key={w.playerId} />
              ))}{" "}
              {winners.length === 1
                ? `🏆 ${winners[0].name} wins with ${winners[0].totalScore} points!`
                : `🏆 It's a tie: ${winners.map((w) => w.name).join(" & ")}`}
            </div>
            <div>The game is over...</div>
            <button onClick={() => appModel.startGame()}>Play again, same players</button>
          </div>
        ) : (
          <button onClick={() => appModel.startNextRound()}>Start next round</button>
        )}
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
  appModel?: TemplatePresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: Readonly<{ appModel?: TemplatePresenterModel; uiProperties: UIProperties }>) {
    super(props);

    const { appModel } = this.props;

    // Set up sound effects
    this.media = new MediaHelper();
    for (let soundName in TemplateAssets.sounds) {
      this.media.loadSound((TemplateAssets.sounds as any)[soundName]);
    }

    const sfxVolume = 1.0;

    // Play a countdown alert when a round is nearly out of time
    let timeAlertLoaded = false;
    appModel?.onTick.subscribe("Timer Watcher", () => {
      if (appModel!.secondsLeftInStage > 10) timeAlertLoaded = true;
      if (
        appModel!.gameState === TemplateGameState.Playing &&
        timeAlertLoaded &&
        appModel!.secondsLeftInStage <= 10
      ) {
        timeAlertLoaded = false;
        this.media.repeatSound("ding.wav", 5, 100);
      }
    });

    // Game events -> sounds.  Subscribe to model events here so audio
    // stays in the view layer, out of the game logic.
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(TemplateAssets.sounds.hello, { volume: sfxVolume * 0.2 }),
    );
    appModel?.subscribe(TemplateGameEvent.ResponseReceived, "play response received sound", () =>
      this.media.playSound(TemplateAssets.sounds.response, { volume: sfxVolume }),
    );
    appModel?.subscribe(TemplateGameEvent.ColorChanged, "play color changed sound", () =>
      this.media.playSound(TemplateAssets.sounds.ding, { volume: sfxVolume * 0.5 }),
    );
    appModel?.subscribe(TemplateGameEvent.ScoreChanged, "play score sound", () =>
      this.media.playSound(TemplateAssets.sounds.score, { volume: sfxVolume * 0.6 }),
    );
    appModel?.subscribe(TemplateGameEvent.WinnerAnnounced, "play winner sound", () =>
      this.media.playSound(TemplateAssets.sounds.winner, { volume: sfxVolume }),
    );
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) {
      return <div>NO APP MODEL</div>;
    }

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case TemplateGameState.Playing:
        return <PlayingPage media={this.media} />;
      case TemplateGameState.EndOfRound:
      case GeneralGameState.GameOver:
        return <EndOfRoundPage />;
      case GeneralGameState.Paused:
        return <PausedGamePage />;
      default:
        return <div>Whoops! No display for this state: {appModel.gameState}</div>;
    }
  }

  // -------------------------------------------------------------------
  // renderFrame
  // -------------------------------------------------------------------
  private renderFrame() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={classNames(styles.divRow)}>
        <button
          className={classNames(styles.button)}
          style={{ marginRight: "30px" }}
          onClick={() => appModel.quitApp()}
        >
          Quit
        </button>
        <button
          className={classNames(styles.button)}
          disabled={appModel.gameState === PresenterGameState.Gathering}
          style={{ marginRight: "30px" }}
          onClick={() => appModel.pauseGame()}
        >
          Pause
        </button>
        <div className={classNames(styles.roomCode)}>Room Code: {appModel.roomId}</div>
        <DevUI context={appModel} children={<div></div>} />
        <div style={{ marginLeft: "50px" }}>v{TemplateVersion}</div>
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
        <div style={{ margin: "40px" }}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
