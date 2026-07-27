// The shared-screen view for 101.  Deliberately plain visuals - this is a
// mechanics playground awaiting a design pass (see DESIGN.md).
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import { action, makeObservable, observable, reaction } from "mobx";
import OneOhOneAssets from "../assets/Assets";
import {
  COLLISION_PAUSE_MS,
  OneOhOneVersion,
  PIECE_GAP_MS,
  STEP_ANIMATION_MS,
} from "../models/GameSettings";
import {
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
  OneOhOnePresenterModel,
  OneOhOneGameState,
  OneOhOneGameEvent,
} from "../models/PresenterModel";
import { OneOhOneMoveSummary, OneOhOneRoundPhase } from "../models/oneOhOneEndpoints";
import {
  animationPathForMove,
  BotAttitude,
  BUST_LIMIT,
  GamePiece,
  MAX_PIECES,
  WIN_POSITION,
} from "../models/oneOhOneLogic";

// Percent position along the track for a given board position
const pct = (position: number) => `${((position / BUST_LIMIT) * 100).toFixed(2)}%`;

// Human-readable summary of a piece's last move
export function describeMove(piece: GamePiece): string {
  const move = piece.lastMove;
  if (!move) return "";
  if (move.won) return `picked ${move.guess} → 🏆 101!`;
  if (move.busted) return `picked ${move.guess} → BUST! back to 0`;
  if (move.collidedCount > 0) return `picked ${move.guess} ×${move.collidedCount} → ${move.delta}`;
  return `picked ${move.guess} → +${move.delta}`;
}

const RULES = [
  "Pick a number from 1-10 each round",
  "Your number is unique? Move forward that many spaces",
  "Same number as someone else? Everyone who picked it goes BACK by how many picked it",
  "Land exactly on 101 to win — overshoot past 111 and you restart at 0!",
];

// -------------------------------------------------------------------
// RevealAnimator - view-layer controller that walks pieces to their new
// positions one piece at a time, one step at a time, clicking as it goes.
// The model's positions jump immediately; this animates a display copy.
// -------------------------------------------------------------------
class RevealAnimator {
  displayPositions = observable.map<string, number>();
  @observable activePieceId: string | null = null;

  private cancelled = false;

  constructor(private media: MediaHelper) {
    makeObservable(this);
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Snap the display to the model's real positions (no animation)
  syncTo = action((pieces: GamePiece[]) => {
    this.cancelled = true;
    this.activePieceId = null;
    this.displayPositions.replace(new Map(pieces.map((p) => [p.pieceId, p.position])));
  });

  positionFor(piece: GamePiece): number {
    return this.displayPositions.get(piece.pieceId) ?? piece.position;
  }

  // Animate the round's moves sequentially with step sounds
  async play(moves: OneOhOneMoveSummary[]) {
    this.cancelled = false;

    // Start everyone at their pre-move position
    action(() => {
      for (const move of moves) {
        const oldPosition = move.busted ? -move.delta : move.newPosition - move.delta;
        this.displayPositions.set(move.pieceId, oldPosition);
      }
    })();

    for (const move of moves) {
      const path = animationPathForMove(move);
      if (path.length === 0) continue;
      if (this.cancelled) return;

      action(() => (this.activePieceId = move.pieceId))();

      // Collision! Crash first, then slide backward
      if (move.collidedCount > 0) {
        this.media.playSound(OneOhOneAssets.sounds.crash, { volume: 0.9 });
        await this.delay(COLLISION_PAUSE_MS);
        if (this.cancelled) return;
      }

      let previous = this.displayPositions.get(move.pieceId) ?? 0;
      for (const position of path) {
        if (this.cancelled) return;
        const isBustSnap = move.busted && position === 0 && previous > 0;
        action(() => this.displayPositions.set(move.pieceId, position))();
        if (isBustSnap) {
          this.media.playSound(OneOhOneAssets.sounds.ding, { volume: 0.9 });
          await this.delay(PIECE_GAP_MS);
        } else if (position > previous) {
          this.media.playSound(OneOhOneAssets.sounds.stepforward, { volume: 0.7 });
          await this.delay(STEP_ANIMATION_MS);
        } else {
          this.media.playSound(OneOhOneAssets.sounds.stepback, { volume: 0.8 });
          await this.delay(STEP_ANIMATION_MS);
        }
        previous = position;
      }
      if (move.won) {
        this.media.playSound(OneOhOneAssets.sounds.score, { volume: 1.0 });
      }
      await this.delay(PIECE_GAP_MS);
    }
    action(() => (this.activePieceId = null))();
  }
}

@inject("appModel")
@observer
class InstructionsBox extends React.Component<{}> {
  render() {
    return (
      <div className={styles.instructions}>
        <div style={{ fontWeight: 700 }}>How to play:</div>
        <ul>
          {RULES.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>
    );
  }
}

@inject("appModel")
@observer
class GatheringPlayersPage extends React.Component<{ appModel?: OneOhOnePresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div>
        <h3>Welcome to 101</h3>
        <InstructionsBox />
        <p>
          To Join: go to http://{window.location.host} and enter this room code: {appModel.roomId}
        </p>

        {appModel.players.length > 0 ? (
          <div>
            <p style={{ fontWeight: 600 }}>Players:</p>
            <div className={styles.divRow}>
              {appModel.players.map((player) => (
                <div className={styles.nameBox} key={player.playerId}>
                  <PlayerAvatar
                    avatarId={player.avatarId}
                    colorIndex={player.avatarColor}
                    size={40}
                  />{" "}
                  {player.name}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>Waiting for players to join...</div>
        )}

        <div className={styles.setupRow}>
          <span>Pieces per player:</span>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              className={classNames(styles.setupButton, {
                [styles.setupSelected]: appModel.piecesPerHuman === n,
              })}
              disabled={n > appModel.maxPiecesPerHumanNow}
              onClick={() => (appModel.piecesPerHuman = n)}
            >
              {n}
            </button>
          ))}
        </div>

        <div className={styles.setupRow}>
          <span>Add a bot:</span>
          {[BotAttitude.Aggressive, BotAttitude.Moderate, BotAttitude.Cautious].map((attitude) => (
            <button
              key={attitude}
              className={styles.setupButton}
              disabled={appModel.totalPlannedPieces >= MAX_PIECES}
              onClick={() => appModel.addBot(attitude)}
            >
              {attitude}
            </button>
          ))}
        </div>

        {appModel.bots.length > 0 ? (
          <div className={styles.setupRow}>
            <span>Bots:</span>
            {appModel.bots.map((attitude, i) => (
              <button
                key={i}
                className={styles.setupButton}
                title="Click to remove"
                onClick={() => appModel.removeBot(i)}
              >
                {attitude} ✕
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.setupRow}>
          <span>
            Pieces on the track: {appModel.totalPlannedPieces}/{MAX_PIECES}
          </span>
        </div>

        {appModel.canStart ? (
          <button className={styles.presenterButton} onClick={() => appModel.startGame()}>
            Click here to start!
          </button>
        ) : (
          <div>Need 2-{MAX_PIECES} pieces (players × pieces + bots) to start...</div>
        )}
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedGamePage extends React.Component<{ appModel?: OneOhOnePresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <p>101 is paused</p>
        <button className={styles.button} onClick={() => appModel.resumeGame()}>
          Resume Game
        </button>
      </div>
    );
  }
}

// The race track - one lane per piece, finish line at 101, danger zone to 111
@inject("appModel")
@observer
class RaceTrack extends React.Component<{
  appModel?: OneOhOnePresenterModel;
  animator: RevealAnimator;
}> {
  render() {
    const { appModel, animator } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const isReveal = appModel.roundPhase === OneOhOneRoundPhase.Reveal;
    const isGameOver = appModel.gameState === GeneralGameState.GameOver;

    return (
      <div className={styles.trackArea}>
        {appModel.pieces.map((piece) => (
          <div
            className={classNames(styles.lane, {
              [styles.activeLane]: animator.activePieceId === piece.pieceId,
              [styles.winnerLane]: isGameOver && piece.position === WIN_POSITION,
            })}
            key={piece.pieceId}
          >
            <div className={styles.laneLabel}>
              <PlayerAvatar avatarId={piece.avatarId} colorIndex={piece.avatarColor} size={26} />{" "}
              {piece.name}
            </div>
            <div className={styles.laneTrack}>
              <div
                className={styles.dangerZone}
                style={{ left: pct(WIN_POSITION), width: pct(BUST_LIMIT - WIN_POSITION) }}
              />
              <div className={styles.finishLine} style={{ left: pct(WIN_POSITION) }} />
              <div
                className={styles.pieceMarker}
                style={{ left: pct(animator.positionFor(piece)) }}
              >
                <PlayerAvatar avatarId={piece.avatarId} colorIndex={piece.avatarColor} size={30} />
              </div>
            </div>
            <div className={styles.laneInfo}>
              <span className={styles.lanePosition}>{animator.positionFor(piece)}</span>
              {isReveal || isGameOver ? (
                <span
                  className={classNames({
                    [styles.moveGood]: (piece.lastMove?.delta ?? 0) > 0,
                    [styles.moveBad]: (piece.lastMove?.delta ?? 0) < 0 || piece.lastMove?.busted,
                  })}
                >
                  {describeMove(piece)}
                </span>
              ) : (
                <span>
                  {piece.ownerId === null
                    ? "🤖"
                    : piece.confirmed
                      ? "✓ locked in"
                      : piece.guess !== null
                        ? "thinking…"
                        : "…"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
}

@inject("appModel")
@observer
class PlayingPage extends React.Component<{
  appModel?: OneOhOnePresenterModel;
  animator: RevealAnimator;
}> {
  render() {
    const { appModel, animator } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const collecting = appModel.roundPhase === OneOhOneRoundPhase.Collecting;
    return (
      <div>
        <div className={styles.roundHeader}>
          {collecting
            ? `Round ${appModel.currentRound} — pick and confirm your numbers! ` +
              `(${appModel.confirmedCount}/${appModel.humanPieces.length} locked in, ` +
              `${appModel.secondsLeftInStage}s left)`
            : `Round ${appModel.currentRound} results...`}
        </div>
        <div className={styles.rulesReminder}>
          Unique pick = forward · matched pick = back · land exactly on 101 to win · past 111 =
          restart
        </div>
        <RaceTrack animator={animator} />
      </div>
    );
  }
}

@inject("appModel")
@observer
class GameOverPage extends React.Component<{
  appModel?: OneOhOnePresenterModel;
  animator: RevealAnimator;
}> {
  render() {
    const { appModel, animator } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const winners = appModel.winners;

    return (
      <div>
        <div className={styles.winnerBanner}>
          {winners.map((w) => (
            <PlayerAvatar
              avatarId={w.avatarId}
              colorIndex={w.avatarColor}
              size={64}
              key={w.pieceId}
            />
          ))}{" "}
          🏆{" "}
          {winners.length === 1
            ? `${winners[0].name} landed on 101 and wins!`
            : `Simultaneous finish: ${winners.map((w) => w.name).join(" & ")}!`}
        </div>
        <RaceTrack animator={animator} />
        <button onClick={() => appModel.startGame()}>Play again, same players</button>
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
  appModel?: OneOhOnePresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;
  animator: RevealAnimator;

  constructor(props: Readonly<{ appModel?: OneOhOnePresenterModel; uiProperties: UIProperties }>) {
    super(props);

    const { appModel } = this.props;

    this.media = new MediaHelper();
    for (let soundName in OneOhOneAssets.sounds) {
      this.media.loadSound((OneOhOneAssets.sounds as any)[soundName]);
    }
    this.animator = new RevealAnimator(this.media);
    if (appModel) this.animator.syncTo(appModel.pieces.slice());

    // Countdown warning near the end of a pick phase
    let timeAlertLoaded = false;
    appModel?.onTick.subscribe("Timer Watcher", () => {
      if (appModel!.secondsLeftInStage > 10) timeAlertLoaded = true;
      if (
        appModel!.gameState === OneOhOneGameState.Playing &&
        appModel!.roundPhase === OneOhOneRoundPhase.Collecting &&
        timeAlertLoaded &&
        appModel!.secondsLeftInStage <= 5
      ) {
        timeAlertLoaded = false;
        this.media.repeatSound("ding.wav", 3, 100);
      }
    });

    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(OneOhOneAssets.sounds.hello, { volume: 0.2 }),
    );
    // The reveal animation (with its step sounds) runs off the RoundResolved event
    appModel?.subscribe(OneOhOneGameEvent.RoundResolved, "animate reveal", (moves) =>
      this.animator.play(moves as OneOhOneMoveSummary[]),
    );
    appModel?.subscribe(OneOhOneGameEvent.WinnerAnnounced, "play winner sound", () =>
      this.media.playSound(OneOhOneAssets.sounds.winner, { volume: 1.0 }),
    );

    // When a new pick phase opens, stop any running animation and snap the
    // display to the real positions
    if (appModel) {
      reaction(
        () => appModel.roundPhase,
        (phase) => {
          if (phase === OneOhOneRoundPhase.Collecting) {
            this.animator.syncTo(appModel.pieces.slice());
          }
        },
      );
    }
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case OneOhOneGameState.Playing:
        return <PlayingPage animator={this.animator} />;
      case GeneralGameState.GameOver:
        return <GameOverPage animator={this.animator} />;
      case GeneralGameState.Paused:
        return <PausedGamePage />;
      default:
        return <div>Whoops! No display for this state: {appModel.gameState}</div>;
    }
  }

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
        <div style={{ marginLeft: "50px" }}>v{OneOhOneVersion}</div>
      </div>
    );
  }

  render() {
    return (
      <UINormalizer
        className={styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        {this.renderFrame()}
        <div style={{ margin: "30px" }}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
