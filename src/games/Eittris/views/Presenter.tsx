// The shared-screen view for EITtris: all live boards side by side, scaled to
// fit up to 16 across.  Deliberately plain visuals - the design pass comes in a
// later increment (see DESIGN.md).
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import EittrisAssets from "../assets/Assets";
import { EittrisVersion } from "../models/GameSettings";
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
  EittrisPresenterModel,
  EittrisGameState,
  EittrisGameEvent,
  EittrisPlayer,
} from "../models/PresenterModel";
import {
  EittrisBoard,
  SpecialType,
  IMPLEMENTED_SPECIALS,
  SPECIAL_NAMES,
  SPECIAL_ICON_COUNT,
} from "../models/eittrisLogic";
import BoardGrid from "./BoardGrid";
import RobotDemo from "./RobotDemo";

const RULES = ["Use your finger to control and place pieces"];

// Which of the original's sounds each special plays when it lands
const SPECIAL_SOUNDS: Partial<Record<SpecialType, string>> = {
  [SpecialType.Speedup]: EittrisAssets.sounds.speedup,
  [SpecialType.TheWall]: EittrisAssets.sounds.wall,
  [SpecialType.Escalator]: EittrisAssets.sounds.smack,
  [SpecialType.Shackle]: EittrisAssets.sounds.shackle,
  [SpecialType.TowerOfEit]: EittrisAssets.sounds.tower,
  [SpecialType.Bridge]: EittrisAssets.sounds.bridge,
  [SpecialType.SlowDown]: EittrisAssets.sounds.slowdown,
  [SpecialType.SeeShadows]: EittrisAssets.sounds.shadows,
  [SpecialType.EvilPieces]: EittrisAssets.sounds.evil,
  [SpecialType.CrazyIvan]: EittrisAssets.sounds.ivan,
  [SpecialType.FreezeDried]: EittrisAssets.sounds.freeze,
  [SpecialType.Transparency]: EittrisAssets.sounds.vanish,
  [SpecialType.Psycho]: EittrisAssets.sounds.psycho,
  [SpecialType.Jumble]: EittrisAssets.sounds.jumble,
  [SpecialType.SwitchScreens]: EittrisAssets.sounds.swap,
};

function soundForSpecial(type: number): string {
  return SPECIAL_SOUNDS[type as SpecialType] ?? EittrisAssets.sounds.speedup;
}

// Cell size that fits `count` boards across the 1920-wide presenter frame
function presenterCellPx(count: number): number {
  const perBoard = 1800 / Math.max(1, count);
  return Math.max(5, Math.min(24, Math.floor(perBoard / 10)));
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
class GatheringPlayersPage extends React.Component<{ appModel?: EittrisPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div className={styles.gatheringLayout}>
        <div className={styles.gatheringMain}>
          <h3>Welcome to EITtris</h3>
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

          {/* Game setup.  Everything here is decided before the round starts,
            and rides the checkpoint so a refresh mid-setup loses nothing. */}
          <div className={styles.setupPanel}>
            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Antidotes to start:</span>
              {[0, 1, 2, 3].map((count) => (
                <button
                  key={count}
                  className={classNames(styles.robotButton, {
                    [styles.robotButtonOn]: appModel.settings.startingAntidotes === count,
                  })}
                  onClick={() => appModel.setStartingAntidotes(count)}
                >
                  {count}
                </button>
              ))}
            </div>

            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Four-row award:</span>
              <select
                className={styles.setupSelect}
                value={appModel.settings.fourRowAward}
                onChange={(ev) => appModel.setFourRowAward(Number(ev.target.value))}
              >
                {IMPLEMENTED_SPECIALS.map((type) => (
                  <option key={type} value={type}>
                    {SPECIAL_NAMES[type]}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.setupRow}>
              <span className={styles.setupLabel}>Powerups in play:</span>
              <div className={styles.specialChecks}>
                {IMPLEMENTED_SPECIALS.map((type) => (
                  <label key={type} className={styles.specialCheck}>
                    <input
                      type="checkbox"
                      checked={appModel.isSpecialAllowed(type)}
                      onChange={() => appModel.toggleAllowedSpecial(type)}
                    />
                    <span
                      className={styles.specialCheckIcon}
                      style={{
                        backgroundImage: `url(${EittrisAssets.images.specials})`,
                        backgroundPosition: `${(type / (SPECIAL_ICON_COUNT - 1)) * 100}% 0%`,
                      }}
                    />
                    {SPECIAL_NAMES[type]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Robot players: enough to make a game of it with one or two people.
            They never change how many humans are needed to start. */}
          <div className={styles.robotPicker}>
            <span className={styles.robotLabel}>Robot players:</span>
            {[0, 1, 2, 3, 4].map((count) => (
              <button
                key={count}
                className={classNames(styles.robotButton, {
                  [styles.robotButtonOn]: appModel.robotCount === count,
                })}
                onClick={() => appModel.setRobotCount(count)}
              >
                {count}
              </button>
            ))}
            {appModel.robotCount > 0 ? (
              <span className={styles.robotNames}>
                {appModel.robots.map((robot) => (
                  <span className={styles.nameBox} key={robot.playerId}>
                    <PlayerAvatar
                      avatarId={robot.avatarId}
                      colorIndex={robot.avatarColor}
                      size={40}
                    />{" "}
                    {robot.name}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          {appModel.canStart ? (
            <button className={styles.presenterButton} onClick={() => appModel.startGame()}>
              Click here to start!
            </button>
          ) : (
            <div>Waiting for at least {appModel.minPlayers} player(s) to join...</div>
          )}
        </div>

        {/* A robot playing the game, so the big screen has something
            happening on it while people are still typing in the room code. */}
        <div className={styles.demoColumn}>
          <RobotDemo cellPx={18} />
        </div>
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedGamePage extends React.Component<{ appModel?: EittrisPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <p>EITtris is paused</p>
        <button className={styles.button} onClick={() => appModel.resumeGame()}>
          Resume Game
        </button>
      </div>
    );
  }
}

// One player's mini board with name, avatar, and score
@inject("appModel")
@observer
class BoardPanel extends React.Component<{
  appModel?: EittrisPresenterModel;
  board: EittrisBoard;
  cellPx: number;
}> {
  render() {
    const { appModel, board, cellPx } = this.props;
    // identityFor covers robots as well as people - robots have no player entry
    const who = appModel?.identityFor(board.playerId);
    const targetName = board.targetId ? appModel?.identityFor(board.targetId).name : undefined;
    const isWinner =
      appModel?.gameState === GeneralGameState.GameOver && appModel.winnerId === board.playerId;
    const backgrounds = EittrisAssets.images.backgrounds;

    return (
      <div className={classNames(styles.boardPanel, { [styles.winnerPanel]: isWinner })}>
        <div className={styles.boardLabel} style={{ maxWidth: cellPx * 10 + 8 }}>
          <PlayerAvatar
            avatarId={who?.avatarId ?? 0}
            colorIndex={who?.avatarColor}
            size={Math.max(18, cellPx * 2)}
          />
          <span>{who?.name ?? "?"}</span>
          {targetName ? <span className={styles.targetNote}>⚔ {targetName}</span> : null}
        </div>
        <div className={styles.boardHolder}>
          <BoardGrid
            grid={board.grid}
            piece={board.piece}
            cellPx={cellPx}
            backgroundUrl={backgrounds[board.backgroundIndex % backgrounds.length]}
            dimmed={!board.alive}
            specials={board.specials.map((m) => ({ i: m.index, t: m.type }))}
            specialsUrl={EittrisAssets.images.specials}
            showShadow={board.seeShadows}
            freezeDried={board.freezeDried}
            transparency={board.transparency}
            psychoSeed={board.psychoSeed}
            psychoOverlay={board.psychoOverlay}
            clearing={board.clearing}
          />
          {!board.alive ? <div className={styles.toppedOut}>TOPPED OUT</div> : null}
        </div>
        <div className={styles.boardScore} style={{ maxWidth: cellPx * 10 + 8 }}>
          {board.score} pts · {board.rows} rows
        </div>
      </div>
    );
  }
}

@inject("appModel")
@observer
class BoardsRow extends React.Component<{ appModel?: EittrisPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const cellPx = presenterCellPx(appModel.boards.length);
    return (
      <div className={styles.boardsRow}>
        {appModel.boards.map((board) => (
          <BoardPanel key={board.playerId} board={board} cellPx={cellPx} />
        ))}
      </div>
    );
  }
}

@inject("appModel")
@observer
class PlayingPage extends React.Component<{ appModel?: EittrisPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <div className={styles.roundHeader}>
          {appModel.aliveBoards.length}/{appModel.boards.length} boards still standing
        </div>
        <BoardsRow />
      </div>
    );
  }
}

@inject("appModel")
@observer
class GameOverPage extends React.Component<{ appModel?: EittrisPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const winner = appModel.players.find((p) => p.playerId === appModel.winnerId);

    return (
      <div>
        <div className={styles.winnerBanner}>
          {winner ? (
            <PlayerAvatar avatarId={winner.avatarId} colorIndex={winner.avatarColor} size={64} />
          ) : null}{" "}
          🏆{" "}
          {appModel.winnerName
            ? `${appModel.winnerName} is the last board standing!`
            : "Game over!"}
        </div>
        <BoardsRow />
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
  appModel?: EittrisPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  constructor(props: Readonly<{ appModel?: EittrisPresenterModel; uiProperties: UIProperties }>) {
    super(props);

    const { appModel } = this.props;

    this.media = new MediaHelper();
    for (let soundName in EittrisAssets.sounds) {
      this.media.loadSound((EittrisAssets.sounds as any)[soundName]);
    }

    const clearSounds = [
      EittrisAssets.sounds.clear1,
      EittrisAssets.sounds.clear2,
      EittrisAssets.sounds.clear3,
      EittrisAssets.sounds.clear4,
    ];

    // A special landing (or bouncing off a shield) gets its own sound
    appModel?.subscribe(
      EittrisGameEvent.SpecialFired,
      "special sound",
      (_attackerId: string, _victimId: string, type: number, repelled: boolean) => {
        const sound = repelled ? EittrisAssets.sounds.repel : soundForSpecial(type);
        this.media.playSound(sound, { volume: 0.9 });
      },
    );
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(EittrisAssets.sounds.hello, { volume: 0.2 }),
    );
    appModel?.subscribe(EittrisGameEvent.GameStarted, "play start sound", () =>
      this.media.playSound(EittrisAssets.sounds.gameStart, { volume: 0.8 }),
    );
    appModel?.subscribe(EittrisGameEvent.PieceLocked, "play lock sound", () =>
      this.media.playSound(EittrisAssets.sounds.dot, { volume: 0.3 }),
    );
    appModel?.subscribe(EittrisGameEvent.PieceBumped, "play bump sound", () =>
      this.media.playSound(EittrisAssets.sounds.bump, { volume: 0.6 }),
    );
    appModel?.subscribe(EittrisGameEvent.RowsCleared, "play clear sound", (_playerId, cleared) => {
      const index = Math.max(1, Math.min(4, (cleared as number) ?? 1)) - 1;
      this.media.playSound(clearSounds[index], { volume: 0.8 });
    });
    // An affliction letting go - whether it timed out or an antidote washed
    // it off.  One chime per batch, so a cure that lifts four at once is not
    // four overlapping chimes.
    appModel?.subscribe(EittrisGameEvent.AfflictionEnded, "play cured sound", () =>
      this.media.playSound(EittrisAssets.sounds.cured, { volume: 0.7 }),
    );
    // Blocks skittering while the randomizer shakes a stack apart.  Same
    // short sample every time, at a different pitch each time, which is what
    // turns a repeated click into a tinkle.
    appModel?.subscribe(EittrisGameEvent.JumbleNudge, "play jumble tinkle", () =>
      this.media.playSound(EittrisAssets.sounds.jumble, {
        volume: 0.35,
        rate: 0.75 + Math.random() * 1.1,
      }),
    );
    appModel?.subscribe(EittrisGameEvent.PlayerDied, "play death sound", () =>
      this.media.playSound(EittrisAssets.sounds.crowdAww, { volume: 0.9 }),
    );
    appModel?.subscribe(EittrisGameEvent.WinnerAnnounced, "play winner sound", () =>
      this.media.playSound(EittrisAssets.sounds.cheer, { volume: 1.0 }),
    );
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case EittrisGameState.Playing:
        return <PlayingPage />;
      case GeneralGameState.GameOver:
        return <GameOverPage />;
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
        <div style={{ marginLeft: "50px" }}>v{EittrisVersion}</div>
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
