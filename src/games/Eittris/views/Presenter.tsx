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
  AVATAR_COLORS,
  MusicLibrary,
  MusicPlayer,
  CachedMusicSource,
  ResolvedTrack,
  VolumePreferences,
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
  MAX_ROBOTS,
  planBoardLayout,
} from "../models/eittrisLogic";
import BoardGrid from "./BoardGrid";
import RobotDemo from "./RobotDemo";

const RULES = ["Use your finger to control and place pieces"];

// Robot counts the host can pick.  The last is a dev-only stress test: twenty
// boards is far past a real party, and useful for seeing what the host screen
// does when it is completely full.
const IS_DEV = process.env.REACT_APP_DEVMODE === "development";
const STRESS_TEST_ROBOTS = 20;
const ROBOT_COUNT_CHOICES = IS_DEV ? [0, 1, 2, 3, 4, STRESS_TEST_ROBOTS] : [0, 1, 2, 3, 4];

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

// The presenter frame is 1920x1080 virtual; this is what is left for the
// boards once the header row has taken its share.
const BOARDS_AREA_WIDTH = 1880;
// The header takes ~129 of 1080 and the audio bar along the bottom takes ~56; boards get
// what is left.  Getting this wrong pushes boards off the bottom of the screen.
const BOARDS_AREA_HEIGHT = 884;
const BOARDS_GAP = 10;

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
        {/* Dmitri in the bottom-left corner.  The setup panel uses a CSS
            shape so the text flows around his shoulder instead of running
            underneath him. */}
        <img className={styles.dmitri} src={EittrisAssets.images.dmitri} alt="" aria-hidden />
        <div className={styles.gatheringMain}>
          {/* Joining instructions ride at the very top, right under the quit
              bar - it is the one thing a player in the room needs to read. */}
          <div className={styles.joinBanner}>
            To join: go to <b>http://{window.location.host}</b> and enter room code{" "}
            <b className={styles.joinCode}>{appModel.roomId}</b>
          </div>

          {/* A fixed-height area either way: without it the whole setup panel
              jumps down the moment the first player joins. */}
          <div className={styles.playerArea}>
            {appModel.players.length > 0 ? (
              <div>
                <p className={styles.playerAreaTitle}>Players:</p>
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
              <div className={styles.playerAreaEmpty}>Waiting for players to join...</div>
            )}
          </div>

          {/* Everything from here down is indented to clear Dmitri, who
              stands in the gutter on the left. */}
          <div className={styles.lowerSetup}>
            <div className={styles.setupPanel}>
              {/* Antidotes and the award share a row - two short controls, and
                  splitting them wasted a whole line of a page that was
                  running off the bottom. */}
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
                <span className={classNames(styles.setupLabel, styles.setupLabelInline)}>
                  Four-row award:
                </span>
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

              {/* Robot players: enough to make a game of it with one or two
                  people.  They never change how many humans are needed. */}
              <div className={styles.setupRow}>
                <span className={styles.setupLabel}>Robot players:</span>
                {ROBOT_COUNT_CHOICES.map((count) => (
                  <button
                    key={count}
                    className={classNames(styles.robotButton, {
                      [styles.robotButtonOn]: appModel.robotCount === count,
                    })}
                    onClick={() => appModel.setRobotCount(count)}
                    title={count > MAX_ROBOTS ? "Stress test (dev only)" : undefined}
                  >
                    {count}
                  </button>
                ))}
                {appModel.robotCount > 0 && appModel.robotCount <= MAX_ROBOTS ? (
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
                ) : appModel.robotCount > MAX_ROBOTS ? (
                  <span className={styles.robotNames}>{appModel.robotCount} robots</span>
                ) : null}
              </div>
            </div>
          </div>

          {/* The title sits low on the left, just above Dmitri's head, and the
              start button lower still - over his portrait, where the eye ends
              up anyway.  No status line: the button's presence says it all. */}
          <div className={styles.cornerStack}>
            <h3 className={styles.cornerTitle}>Welcome to EITtris</h3>
            {appModel.canStart ? (
              <button
                className={classNames(styles.presenterButton, styles.startOverPortrait)}
                onClick={() => appModel.startGame()}
              >
                Start game!
              </button>
            ) : null}
          </div>
        </div>

        {/* A robot playing the game, so the big screen has something
            happening on it while people are still typing in the room code. */}
        <div className={styles.demoColumn}>
          <div className={styles.demoFrame}>
            <div className={styles.demoTitle}>Robot demo</div>
            <RobotDemo cellPx={18} />
          </div>
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
      <div
        className={classNames(styles.boardPanel, {
          [styles.winnerPanel]: isWinner,
          [styles.boardPanelOut]: !board.alive,
        })}
        // Their own avatar colour frames their board
        style={{
          ["--playerAccent" as any]: AVATAR_COLORS[(who?.avatarColor ?? 0) % AVATAR_COLORS.length],
        }}
      >
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
    // Fit every board on screen, in as many rows as it takes, at the biggest
    // size that works - one wide row for a few players, a grid for twenty.
    const layout = planBoardLayout(
      appModel.boards.length,
      BOARDS_AREA_WIDTH,
      BOARDS_AREA_HEIGHT,
      BOARDS_GAP,
    );
    return (
      <div
        className={styles.boardsRow}
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, max-content)`,
          gap: BOARDS_GAP,
        }}
      >
        {appModel.boards.map((board) => (
          <BoardPanel key={board.playerId} board={board} cellPx={layout.cellPx} />
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
interface PresenterState {
  effectsVolume: number;
  musicVolume: number;
  trackTitle: string | null;
  // The manifest lands after the first render, and the audio bar has to notice - otherwise
  // it goes on claiming there is no music long after the songs have arrived.
  trackCount: number;
}

@inject("appModel")
@observer
export default class Presenter extends React.Component<
  { appModel?: EittrisPresenterModel; uiProperties: UIProperties },
  PresenterState
> {
  media: MediaHelper;
  // Background music streams from our own server and is entirely optional: it lives on
  // the view, not the model, so nothing here is serialized, checkpointed, or able to
  // affect a game.  With no REACT_APP_MUSIC_BASE_URL the whole thing is inert.
  private music: MusicPlayer;
  private musicTracks: ResolvedTrack[] = [];
  private trackIndex = -1;
  private readonly volumePrefs = new VolumePreferences();

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

    // Music starts here, and only here.  GameStarted is raised synchronously from the
    // start-game click, which is what gets us past the browser's autoplay policy - the
    // same gesture that unblocks the AudioContext the sound effects run on.
    const levels = this.volumePrefs.load();
    this.state = {
      effectsVolume: levels.effects,
      musicVolume: levels.music,
      trackTitle: null,
      trackCount: 0,
    };
    this.media.setVolume(levels.effects);

    const library = new MusicLibrary(process.env.REACT_APP_MUSIC_BASE_URL);
    const source = new CachedMusicSource();
    this.music = new MusicPlayer(source, { defaultVolume: levels.music });
    // Fire and forget: rendering must not wait on the music folder.  The sweep drops
    // cached bytes for tracks that have since left the manifest.
    library.loadManifest().then((tracks) => {
      this.musicTracks = tracks;
      this.setState({ trackCount: tracks.length });
      if (tracks.length > 0) source.sweep(tracks);
    });

    appModel?.subscribe(EittrisGameEvent.GameStarted, "start background music", () => {
      if (this.musicTracks.length === 0) return; // no music configured, or it failed to load
      this.playTrack(Math.floor(Math.random() * this.musicTracks.length));
    });
    appModel?.subscribe(EittrisGameEvent.WinnerAnnounced, "stop background music", () =>
      this.music.stop(1200),
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

  componentWillUnmount(): void {
    // Leaving the game must not leave a track playing behind it.
    this.music.dispose();
  }

  // ---------------------------------------------------------------------------------------
  // Audio the host can reach: which song, and how loud each layer is.
  // ---------------------------------------------------------------------------------------
  private playTrack(index: number, fadeInMs = 800) {
    const count = this.musicTracks.length;
    if (count === 0) return;
    this.trackIndex = ((index % count) + count) % count; // wraps in both directions
    const track = this.musicTracks[this.trackIndex];
    this.music.play(track, { loop: true, fadeInMs });
    this.setState({ trackTitle: track.title });
  }

  // Straight to the next song, no fade - the host pressed the button because they want a
  // different song now, and a long crossfade just reads as the button not working.
  private nextTrack = () => {
    if (this.musicTracks.length === 0) return;
    this.playTrack(this.trackIndex + 1, 150);
  };

  private setEffectsVolume = (value: number) => {
    this.media.setVolume(value);
    this.setState({ effectsVolume: value });
    this.volumePrefs.save({ effects: value, music: this.state.musicVolume });
  };

  private setMusicVolume = (value: number) => {
    this.music.setVolume(value);
    this.setState({ musicVolume: value });
    this.volumePrefs.save({ effects: this.state.effectsVolume, music: value });
  };

  // A strip along the bottom of the shared screen.  It is deliberately always present -
  // the moment somebody says "turn it down" you do not want to be hunting for a menu.
  private renderAudioBar() {
    const { effectsVolume, musicVolume, trackTitle, trackCount } = this.state;
    const haveMusic = trackCount > 0;
    return (
      <div className={styles.audioBar}>
        <label className={styles.audioControl}>
          <span className={styles.audioLabel}>Sound FX</span>
          <input
            type="range"
            className={styles.audioSlider}
            min={0}
            max={1}
            step={0.05}
            value={effectsVolume}
            aria-label="Sound effects volume"
            onChange={(ev) => this.setEffectsVolume(Number(ev.target.value))}
          />
          <span className={styles.audioValue}>{Math.round(effectsVolume * 100)}%</span>
        </label>

        <label className={styles.audioControl}>
          <span className={styles.audioLabel}>Music</span>
          <input
            type="range"
            className={styles.audioSlider}
            min={0}
            max={1}
            step={0.05}
            value={musicVolume}
            aria-label="Music volume"
            onChange={(ev) => this.setMusicVolume(Number(ev.target.value))}
          />
          <span className={styles.audioValue}>{Math.round(musicVolume * 100)}%</span>
        </label>

        <button
          className={styles.audioNext}
          onClick={this.nextTrack}
          disabled={!haveMusic}
          aria-label="Next song"
        >
          Next song ⏭
        </button>
        <span className={styles.audioTrack}>
          {haveMusic ? (trackTitle ?? "No song playing") : "No music installed"}
        </span>
      </div>
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
        {this.renderAudioBar()}
      </UINormalizer>
    );
  }
}
