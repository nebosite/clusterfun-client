// The shared-screen view for 101.  Deliberately plain visuals - this is a
// mechanics playground awaiting a design pass (see DESIGN.md).
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import { action, makeObservable, observable, reaction } from "mobx";
import OneOhOneAssets from "../assets/Assets";
import {
  ONE_OH_ONE_VERSION_HISTORY,
  PHASE_GAP_MS,
  PICKS_HOLD_MS,
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
  GameVersionTag,
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
  endZoneStart,
  TARGET_OPTIONS,
  GamePiece,
  MAX_GUESS,
  MAX_PIECES,
  WIN_POSITION,
} from "../models/oneOhOneLogic";

// Percent position along the track for a given board position
const pct = (position: number, bustLimit: number) =>
  `${((position / bustLimit) * 100).toFixed(2)}%`;

// Human-readable summary of a piece's last move
export function describeMove(piece: GamePiece): string {
  const move = piece.lastMove;
  if (!move) return "";
  if (move.won) return `picked ${move.guess} → 🏆 WIN!`;
  if (move.busted) return `picked ${move.guess} → BUST! back to 0`;
  if (move.collidedCount > 0) return `picked ${move.guess} ×${move.collidedCount} → ${move.delta}`;
  return `picked ${move.guess} → +${move.delta}`;
}

// The range and the target both depend on the room, so the rules are built rather than
// written out - they used to say "1-10" and "101" whatever the host had actually chosen.
function rulesFor(winPosition: number, maxGuess: number): string[] {
  return [
    `Pick a number from 1-${maxGuess} each round`,
    "Your number is unique? Move forward that many spaces",
    "Same number as someone else? Everyone who picked it goes BACK by how many picked it",
    `Land exactly on ${winPosition} to win — overshoot past ${winPosition + maxGuess} and you restart at 0!`,
  ];
}

// ==========================================================================================
// RevealAnimator - walks the pieces to their new positions, in PHASES.
//
// It used to animate one piece at a time, start to finish, and with sixteen pieces that was a
// minute of watching other people's turns. Worse, it hid the thing the round is actually
// about: who picked the same number as whom. That is a fact about the WHOLE FIELD, and it is
// only legible if the field is shown at once.
//
// So the reveal has three beats, and the order is the order the rules resolve in:
//
//   1. PICKS    every number on screen together, conflicts splashed red. Nobody moves.
//   2. BACK     every colliding piece slides backwards, simultaneously.
//   3. FORWARD  every clean pick advances, simultaneously. Pot payouts go last of all,
//               because they are the round's final word.
//
// The model's positions jump the moment the round resolves; this animates a display copy.
// ==========================================================================================

class RevealAnimator {
  displayPositions = observable.map<string, number>();
  /** Set while the picks are being shown, so the lanes can display them. */
  @observable showingPicks = false;
  /** Which phase is running, for the caption above the track. */
  @observable phase: "picks" | "back" | "forward" | null = null;

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
    this.showingPicks = false;
    this.phase = null;
    this.displayPositions.replace(new Map(pieces.map((p) => [p.pieceId, p.position])));
  });

  positionFor(piece: GamePiece): number {
    return this.displayPositions.get(piece.pieceId) ?? piece.position;
  }

  /**
   * Step a whole group of pieces together, one square per tick, until each has arrived.
   * Sequential animation is what made a sixteen-piece round unwatchable; this takes as long
   * as the LONGEST move rather than the sum of them.
   */
  private async stepTogether(
    moves: OneOhOneMoveSummary[],
    bustLimit: number,
    sound: string,
  ): Promise<boolean> {
    const paths = moves
      .map((move) => ({ move, path: animationPathForMove(move, bustLimit) }))
      .filter((entry) => entry.path.length > 0);
    // Returns whether anything actually moved, so the caller can skip the beat after a phase
    // that had nothing to show - a field that all collided at zero, for instance.
    if (paths.length === 0) return false;

    const longest = Math.max(...paths.map((entry) => entry.path.length));
    for (let step = 0; step < longest; step++) {
      if (this.cancelled) return false;
      action(() => {
        for (const { move, path } of paths) {
          // A piece that has arrived stays where it is while the others catch up.
          if (step < path.length) this.displayPositions.set(move.pieceId, path[step]);
        }
      })();
      this.media.playSound(sound, { volume: 0.7 });
      await this.delay(STEP_ANIMATION_MS);
    }
    return true;
  }

  // -------------------------------------------------------------------
  // play - the three beats.
  // -------------------------------------------------------------------
  async play(moves: OneOhOneMoveSummary[], bustLimit: number) {
    this.cancelled = false;

    // Everyone starts where they were before the round resolved.
    action(() => {
      for (const move of moves) {
        const oldPosition = move.busted ? -move.delta : move.newPosition - move.delta;
        this.displayPositions.set(move.pieceId, oldPosition);
      }
      this.showingPicks = true;
      this.phase = "picks";
    })();

    // Grouped by which WAY a piece moves, not by whether it collided. A collision that also
    // collects the lone-last bonus can net POSITIVE, and grouping on `collidedCount` sent that
    // piece sliding forwards during the backwards beat. A bust is forward too - it runs to the
    // edge before it snaps to zero.
    const slidingBack = moves.filter((m) => m.delta < 0 && !m.busted);
    const collisions = moves.filter((m) => m.collidedCount > 0);
    if (collisions.length > 0) {
      // The crash lands with the numbers, not with the movement - it is the collision being
      // announced, and a piece at zero has nowhere to slide but still collided.
      this.media.playSound(OneOhOneAssets.sounds.crash, { volume: 0.9 });
    }
    await this.delay(PICKS_HOLD_MS);
    if (this.cancelled) return;

    // --- BACK, all together --------------------------------------------------------------
    action(() => (this.phase = "back"))();
    const movedBack = await this.stepTogether(
      slidingBack,
      bustLimit,
      OneOhOneAssets.sounds.stepback,
    );
    if (this.cancelled) return;
    if (movedBack) await this.delay(PHASE_GAP_MS);

    // --- FORWARD, all together -----------------------------------------------------------
    action(() => (this.phase = "forward"))();
    // Everything not sliding back: a bust runs FORWARD to the edge before it snaps to zero.
    const forward = moves.filter((m) => m.delta >= 0 || m.busted);
    // The pot is the round's last word, so its recipients move after everybody else.
    const potWinners = forward.filter((m) => m.potShare > 0);
    const ordinary = forward.filter((m) => m.potShare === 0);
    await this.stepTogether(ordinary, bustLimit, OneOhOneAssets.sounds.stepforward);
    if (potWinners.length > 0) {
      await this.delay(PHASE_GAP_MS);
      await this.stepTogether(potWinners, bustLimit, OneOhOneAssets.sounds.stepforward);
    }
    if (this.cancelled) return;

    if (moves.some((m) => m.busted)) {
      this.media.playSound(OneOhOneAssets.sounds.ding, { volume: 0.9 });
    }
    if (moves.some((m) => m.won)) {
      this.media.playSound(OneOhOneAssets.sounds.score, { volume: 1.0 });
    }
    action(() => {
      this.showingPicks = false;
      this.phase = null;
    })();
  }
}

@inject("appModel")
@observer
class InstructionsBox extends React.Component<{ appModel?: OneOhOnePresenterModel }> {
  render() {
    const { appModel } = this.props;
    const rules = rulesFor(appModel?.winPosition ?? WIN_POSITION, appModel?.maxGuess ?? MAX_GUESS);
    return (
      <div className={styles.instructions}>
        <div style={{ fontWeight: 700 }}>How to play:</div>
        <ul>
          {rules.map((rule, i) => (
            <li key={i}>{rule}</li>
          ))}
        </ul>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// SetupBox - the host's knobs, tucked into the lower-right corner.
//
// They used to run down the middle of the gathering screen, above the room code and the list
// of who had joined - which put the two things a ROOM needs to see behind the handful of
// things only the HOST cares about. Same controls, out of the way, and openable at a glance.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SetupBox extends React.Component<{ appModel?: OneOhOnePresenterModel }> {
  @observable private open = true;

  constructor(props: { appModel?: OneOhOnePresenterModel }) {
    super(props);
    makeObservable(this);
  }

  render() {
    const { appModel } = this.props;
    if (!appModel) return null;
    const toggle = action(() => (this.open = !this.open));

    return (
      <div className={styles.settingsBox}>
        <div className={styles.settingsHeader} onClick={toggle}>
          Setup {this.open ? "▾" : "▸"}
        </div>
        {this.open ? (
          <div>
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

            {/* Four lengths rather than a slider over every number in between.  The in-between
              values were a false choice - nobody wants to race to 37 - and the slider fired a
              checkpoint save and an InvalidateState broadcast on every input event while the
              host dragged it. */}
            <div className={styles.setupRow}>
              <span>Race to:</span>
              {TARGET_OPTIONS.map((target) => (
                <button
                  key={target}
                  className={classNames(styles.setupButton, {
                    [styles.setupSelected]: appModel.winPosition === target,
                  })}
                  onClick={() => (appModel.winPosition = target)}
                >
                  {target}
                </button>
              ))}
            </div>

            {/* The two catch-up rules and the guess history. 101 is a race in which a
                piece that falls behind has no way to gain on the field faster than anybody
                else, so a bad early round used to decide it before it got interesting. */}
            <div className={styles.setupRow}>
              <label className={styles.setupCheck}>
                <input
                  type="checkbox"
                  checked={appModel.lastPlaceBonus}
                  onChange={(e) => (appModel.lastPlaceBonus = e.target.checked)}
                />
                Lone last place gets +5
              </label>
            </div>
            <div className={styles.setupRow}>
              <label className={styles.setupCheck}>
                <input
                  type="checkbox"
                  checked={appModel.potEnabled}
                  onChange={(e) => (appModel.potEnabled = e.target.checked)}
                />
                Collision pot{appModel.pot > 0 ? ` (${appModel.pot} in the pot)` : ""}
              </label>
            </div>
            <div className={styles.setupRow}>
              <label className={styles.setupCheck}>
                <input
                  type="checkbox"
                  checked={appModel.showGuessHistory}
                  onChange={(e) => (appModel.showGuessHistory = e.target.checked)}
                />
                Show last 3 picks
              </label>
            </div>

            <div className={styles.setupRow}>
              <span>Add a bot:</span>
              {[BotAttitude.Aggressive, BotAttitude.Moderate, BotAttitude.Cautious].map(
                (attitude) => (
                  <button
                    key={attitude}
                    className={styles.setupButton}
                    disabled={appModel.totalPlannedPieces >= MAX_PIECES}
                    onClick={() => appModel.addBot(attitude)}
                  >
                    {attitude}
                  </button>
                ),
              )}
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
          </div>
        ) : null}
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

        <SetupBox />

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
              // Every colliding piece is lit at once - the collision is a fact about the
              // whole field, and one lane at a time is what hid it.
              [styles.activeLane]:
                animator.showingPicks && (piece.lastMove?.collidedCount ?? 0) > 0,
              [styles.winnerLane]: isGameOver && piece.position === appModel.winPosition,
            })}
            key={piece.pieceId}
          >
            <div className={styles.laneLabel}>
              <PlayerAvatar avatarId={piece.avatarId} colorIndex={piece.avatarColor} size={26} />{" "}
              {piece.name}
              {/* The last few picks, so the room can see who keeps choosing the same number -
                  the only read anybody has in a game where every choice is secret. */}
              {appModel.showGuessHistory && piece.recentGuesses?.length ? (
                <span className={styles.guessHistory}>
                  {piece.recentGuesses.map((g, i) => (
                    <span className={styles.guessChip} key={i}>
                      {g}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
            <div className={styles.laneTrack}>
              <div
                className={styles.dangerZone}
                style={{
                  left: pct(appModel.winPosition, appModel.bustLimit),
                  width: pct(appModel.bustLimit - appModel.winPosition, appModel.bustLimit),
                }}
              />
              {/* The stretch from which the target is reachable in ONE move. "Am I close
                  enough to win this round" is the only question that matters once the race is
                  on, and counting squares from across a room is not a game mechanic. */}
              <div
                className={styles.endZone}
                style={{
                  left: pct(
                    endZoneStart(appModel.winPosition, appModel.maxGuess),
                    appModel.bustLimit,
                  ),
                  width: pct(
                    appModel.winPosition - endZoneStart(appModel.winPosition, appModel.maxGuess),
                    appModel.bustLimit,
                  ),
                }}
              />
              <div
                className={styles.finishLine}
                style={{ left: pct(appModel.winPosition, appModel.bustLimit) }}
              />
              <div
                className={styles.pieceMarker}
                style={{ left: pct(animator.positionFor(piece), appModel.bustLimit) }}
              >
                <PlayerAvatar avatarId={piece.avatarId} colorIndex={piece.avatarColor} size={30} />
              </div>
            </div>
            <div className={styles.laneInfo}>
              <span className={styles.lanePosition}>{animator.positionFor(piece)}</span>
              {/* The pick, held on screen before anything moves. A conflict gets the spiky
                  red splash, and it is shown whether or not the piece can actually move
                  back - a collision at zero still happened. */}
              {animator.showingPicks && piece.lastMove ? (
                <span
                  className={classNames(styles.pickBadge, {
                    [styles.pickConflict]: piece.lastMove.collidedCount > 0,
                  })}
                >
                  {piece.lastMove.guess}
                </span>
              ) : null}
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
          Unique pick = forward · matched pick = back · land exactly on {appModel.winPosition} to
          win · past {appModel.bustLimit} = restart
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
        this.media.repeatSound(OneOhOneAssets.sounds.ding, 3, 100);
      }
    });

    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(OneOhOneAssets.sounds.hello, { volume: 0.2 }),
    );
    // The reveal animation (with its step sounds) runs off the RoundResolved event
    appModel?.subscribe(OneOhOneGameEvent.RoundResolved, "animate reveal", (moves) =>
      this.animator.play(moves as OneOhOneMoveSummary[], appModel!.bustLimit),
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
        <div style={{ marginLeft: "50px" }}>
          <GameVersionTag title="101" history={ONE_OH_ONE_VERSION_HISTORY} showChanges />
        </div>
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
