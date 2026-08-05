// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import LexibleAssets from "../assets/Assets";
import { LEXIBLE_VERSION_HISTORY } from "../models/GameSettings";
import { LetterBlockModel } from "../models/LetterBlockModel";
import LetterBlock from "./LetterBlock";
import { InstructionDemo } from "./InstructionDemo";
import { TEAM_PANEL_TINT, mixWithWhite, teamColor } from "./cozyTheme";
import { MIN_GRID_HEIGHT, MAX_GRID_HEIGHT, blockSizeForHeight } from "../models/gridLayout";
import {
  LexiblePresenterModel,
  LexibleGameEvent,
  LexiblePlayer,
  LexibleGameState,
} from "../models/PresenterModel";
import {
  Row,
  MediaHelper,
  UIProperties,
  PresenterGameEvent,
  PresenterGameState,
  GeneralGameState,
  UINormalizer,
  DevUI,
  SpeechHelper,
  SPEECH_ENGINE_LIST,
  DEFAULT_SPEECH_ENGINE,
  playExplosion,
  GameVersionTag,
} from "libs";
import type { SpeechEngineId, SpeechVoice } from "libs";
import { action, makeAutoObservable } from "mobx";

@inject("appModel")
@observer
class GameSettings extends React.Component<{ appModel?: LexiblePresenterModel }> {
  myState = {
    showSettings: false,
  };

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  constructor(props: { appModel?: LexiblePresenterModel }) {
    super(props);

    makeAutoObservable(this.myState);
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  renderSettingsItems() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const handleStartFromTeamAreaChange = () => {
      appModel.startFromTeamArea = !appModel.startFromTeamArea;
    };

    return (
      <div className={styles.settingsArea}>
        <Row>
          <input
            className={styles.settingsCheckbox}
            type="checkbox"
            checked={appModel.startFromTeamArea}
            onChange={handleStartFromTeamAreaChange}
          />
          <div>Words must start from team territory:</div>
        </Row>
        {/* One control for board size: how many rows.  The tile size and the
            column count both follow from it and the play area, so the board
            always fills the screen - see models/gridLayout.ts. */}
        <Row>
          <div>Board rows:</div>
          <input
            className={styles.settingsSlider}
            type="range"
            min={MIN_GRID_HEIGHT}
            max={MAX_GRID_HEIGHT}
            step={1}
            value={appModel.gridHeight}
            onChange={(e) => (appModel.gridHeight = parseInt(e.target.value, 10))}
          />
          <div className={styles.settingsValue}>
            {appModel.gridHeight} x {appModel.gridWidth}
          </div>
        </Row>
        {/* Which voice reads the words out.  This is a host decision, not a build
            decision: the right answer depends on the machine driving the screen,
            and the only honest way to find out is to try one in the room.  An
            engine that is not chosen downloads nothing - see libs/Media/speech. */}
        <Row>
          <div>Word voice:</div>
          <div className={styles.engineChoices}>
            {SPEECH_ENGINE_LIST.map((engine) => (
              <div
                key={engine.id}
                title={engine.description}
                className={classNames(
                  styles.engineChoice,
                  appModel.speechEngine === engine.id ? styles.engineChoiceOn : undefined,
                )}
                onClick={() => (appModel.speechEngine = engine.id as SpeechEngineId)}
              >
                {engine.label}
                {engine.downloads ? <span className={styles.engineCost}>downloads</span> : null}
              </div>
            ))}
          </div>
        </Row>
        <div className={styles.engineNote}>
          {SPEECH_ENGINE_LIST.find((e) => e.id === appModel.speechEngine)?.description}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const toggleShow = () =>
      action(() => (this.myState.showSettings = !this.myState.showSettings))();

    return (
      <div>
        <div onClick={toggleShow} className={styles.settingsButton}>
          Settings
        </div>
        {this.myState.showSettings ? this.renderSettingsItems() : null}
      </div>
    );
  }
}

@inject("appModel")
@observer
class GatheringPlayersPage extends React.Component<{ appModel?: LexiblePresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div className={styles.instructionArea}>
        <h1>Welcome to {appModel.name}</h1>
        <div className={styles.joinBlock}>
          <p>
            <b>To Join:</b> go to http://{window.location.host}
            &nbsp;&nbsp;&nbsp;(room code: <b>{appModel.roomId}</b>)
          </p>
        </div>

        {appModel.players.length < appModel.minPlayers ? (
          <div
            className={styles.waitingText}
          >{`Waiting for at least ${appModel.minPlayers} players to join ...`}</div>
        ) : (
          <button className={styles.startButton} onClick={() => appModel.doneGathering()}>
            Click here to start!
          </button>
        )}
        <div className={styles.settingsBox}>
          <GameSettings />
        </div>
      </div>
    );
  }
}

/**
 * The three rules, in one place, because the shared screen now READS THEM OUT as well as
 * printing them - and a spoken line that has drifted from the printed one is worse than
 * either alone.
 */
export const LEXIBLE_RULES = [
  "1. Claim tiles by finding words, starting from your team's territory.",
  "2. Capture tiles if your word score is bigger than the letter score.",
  "3. To win, be the first team to build a bridge to the other side! Tiles connect only if they share a side.",
];

@inject("appModel")
@observer
class InstructionsPage extends React.Component<{ appModel?: LexiblePresenterModel }> {
  myState = {
    instructionsPage: 0,
  };

  // The host is reading these to a room, so the room may as well be read to.  Its own
  // helper rather than the playing page's: the instructions are over before that page
  // exists, and this one goes away when the page is turned.
  private speech: SpeechHelper;
  private spokenPage = -1;

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  constructor(props: { appModel?: LexiblePresenterModel }) {
    super(props);

    makeAutoObservable(this.myState);
    // No fallback noise: a beep in place of a rule communicates nothing, and the sentence
    // is on the screen anyway.
    this.speech = new SpeechHelper(() => {}, props.appModel?.speechEngine);
  }

  componentDidMount() {
    this.speakCurrentPage();
  }

  componentDidUpdate() {
    this.speakCurrentPage();
  }

  componentWillUnmount() {
    // Ready! must not leave a rule being read over the top of the first round.
    this.speech.shutdown();
  }

  //--------------------------------------------------------------------------------------
  // speakCurrentPage - read the rule aloud, once per page turn.
  //
  // Guarded on the page number because render runs for any observable that changed, and
  // re-reading the same sentence on every one of those is what a broken record sounds like.
  //--------------------------------------------------------------------------------------
  private speakCurrentPage() {
    const page = this.myState.instructionsPage;
    if (page === this.spokenPage) return;
    this.spokenPage = page;
    const rule = LEXIBLE_RULES[page];
    if (!rule) return;
    this.speech.setEngine(this.props.appModel?.speechEngine ?? DEFAULT_SPEECH_ENGINE);
    // Drop the leading "1. ", which is a numeral on screen and a stumble out loud.
    this.speech.speak(rule.replace(/^\d+\.\s*/, ""));
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    const { instructionsPage } = this.myState;
    if (!appModel) return <div>NO APP MODEL</div>;

    const renderInstructionsPage = () => {
      switch (instructionsPage) {
        case 0:
          return (
            <div>
              <p className={styles.instructionParagraph}>{LEXIBLE_RULES[0]}</p>
              <div className={styles.instructionDemo}>
                <InstructionDemo step={1} size={84} />
              </div>
            </div>
          );
        case 1:
          return (
            <div>
              <p className={styles.instructionParagraph}>{LEXIBLE_RULES[1]}</p>
              <div className={styles.instructionDemo}>
                <InstructionDemo step={2} size={84} />
              </div>
            </div>
          );
        case 2:
          return (
            <div>
              <p className={styles.instructionParagraph}>{LEXIBLE_RULES[2]}</p>
              <div className={styles.instructionDemo}>
                <InstructionDemo step={3} size={84} />
              </div>
            </div>
          );
        default:
          return <div>Let's play!</div>;
      }
    };

    const turnPage = (count: number) => {
      const newPage = instructionsPage + count;
      if (newPage >= 0 && newPage <= 3) {
        action(() => (this.myState.instructionsPage = newPage))();
      }
    };

    const buttonStyle: React.CSSProperties = {
      width: "200px",
    };
    return (
      <div className={styles.instructionFrame}>
        <p className={styles.instructionHeader}>
          <b>How to play</b>
        </p>
        <div className={styles.instructionBody}>{renderInstructionsPage()}</div>
        {/* In NORMAL FLOW at the bottom of a flex column, not absolutely positioned.
            It used to be `position: absolute; bottom: 150px` with no left/right, which
            put it over the demo board the moment the instruction art stopped being a
            small picture - and it could not be fixed by centring, because libs' Row
            renders a plain block with inline-block children, so justifyContent on it
            does nothing. Laying it out means the two cannot collide at any size. */}
        <div className={styles.instructionButtons}>
          {instructionsPage > 0 ? (
            <button style={buttonStyle} onClick={() => turnPage(-1)}>
              ◀
            </button>
          ) : (
            <div style={buttonStyle}></div>
          )}
          <button style={{ margin: "0 40px" }} onClick={() => appModel.startGame()}>
            Ready!
          </button>
          {instructionsPage < 3 ? (
            <button style={buttonStyle} onClick={() => turnPage(1)}>
              ▶
            </button>
          ) : (
            <div style={buttonStyle}></div>
          )}
        </div>
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedGamePage extends React.Component<{ appModel?: LexiblePresenterModel }> {
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
        <p>Lexible is paused</p>
        <p>Current players in the room:</p>
        <ul>
          {appModel.players.map((player) => (
            <li key={player.playerId}>{player.name}</li>
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

const teamATaunts = [
  "Team A has won.  That is how it is.  You must get used to this.",
  "The feeling of victory is delicious, no?",
  "To grasp a language, it is a thing of beauty.  As is our triumph over team B!",
];

const teamBTaunts = [
  "As expected, team B has proved victorious over team A.",
  "The best team has employed their superior spelling to squash the competition.",
  "In competition, there must be a winner, and we surmise it might as well be us.",
];

@inject("appModel")
@observer
class PlayingPage extends React.Component<{
  appModel?: LexiblePresenterModel;
  media: MediaHelper;
}> {
  private speech: SpeechHelper;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: Readonly<{ appModel?: LexiblePresenterModel; media: MediaHelper }>) {
    super(props);

    // Speech is Kokoro now rather than SAM, which was characterful and often
    // unintelligible - the point of reading a word out is that the room hears
    // WHICH word.  The model is fetched lazily on first use and cached by the
    // browser thereafter; until it arrives (and forever, if it never does) the
    // fallback below keeps the game making the right noises at the right time.
    this.speech = new SpeechHelper((text) => {
      props.media.playSound(
        text.length > 12 ? LexibleAssets.sounds.hello : LexibleAssets.sounds.ding,
      );
    }, props.appModel!.speechEngine);
    // One voice per team, so the room knows who scored before it parses the word.
    const voiceFromTeam = (team: string): SpeechVoice => (team === "A" ? "first" : "second");

    props.appModel!.subscribe(
      LexibleGameEvent.WordAccepted,
      "say accepted word",
      (word: string, player: LexiblePlayer) => {
        // The host can change engines mid-game from the settings box; picking up the current
        // choice here means the next word uses it, with no restart.
        this.speech.setEngine(props.appModel!.speechEngine);
        this.speech.speak(word, { voice: voiceFromTeam(player.teamName) });
      },
    );
    props.appModel!.subscribe(LexibleGameEvent.TilesCaptured, "explosion on capture", () => {
      // Synthesised rather than a sound file - see libs/Media/SoundEffects.  Web Audio is a
      // separate path from speechSynthesis, so this and the word being read out mix in the
      // speakers rather than cancelling each other.
      playExplosion();
    });
    props.appModel!.subscribe(
      LexibleGameEvent.TeamWon,
      "Taunt from the winners",
      (team: string) => {
        const taunts = team === "A" ? teamATaunts : teamBTaunts;
        this.speech.speak(props.appModel?.randomItem(taunts) ?? taunts[0], {
          voice: voiceFromTeam(team),
        });
      },
    );

    // Start fetching while people are still joining, so the first word of the
    // round is spoken rather than beeped.
    this.speech.warmUp();
  }

  // -------------------------------------------------------------------
  // renderRow
  // -------------------------------------------------------------------
  renderGridRow(row: LetterBlockModel[]) {
    const handleClick = () => {}; // No need to handle block clicks from the presenter

    return (
      <Row className={styles.letterRow}>
        {row.map((b) => (
          <LetterBlock
            // Sized off the ROW count so the board fills the play area's height
            // exactly; the column count was chosen to fill its width at this
            // same size.  See models/gridLayout.ts.
            size={blockSizeForHeight(this.props.appModel!.theGrid.height)}
            key={b.__blockid}
            onClick={handleClick}
            context={b}
          />
        ))}
      </Row>
    );
  }

  // -------------------------------------------------------------------
  // renderEndOfRoundOverlay
  // -------------------------------------------------------------------
  renderEndOfRoundOverlay() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const startNextRoundClick = () => appModel.startNextRound();

    return (
      <div className={styles.overlay} style={{ fontSize: "200%" }}>
        <div className={styles.endOfRoundText}>TEAM {appModel.roundWinningTeam} is the winner!</div>
        <button style={{ margin: "20px", fontSize: "80%" }} onClick={startNextRoundClick}>
          {appModel.currentRound < appModel.totalRounds ? "Play Next Round" : "Finish Game"}
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div>
        {appModel.theGrid.rows.map((r, i) => (
          <div key={i}>{this.renderGridRow(r)}</div>
        ))}
        {appModel.gameState === LexibleGameState.EndOfRound ? this.renderEndOfRoundOverlay() : null}
      </div>
    );
  }
}

@inject("appModel")
@observer
class EndOfRoundPage extends React.Component<{ appModel?: LexiblePresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div>
        <div>The game is over...</div>
        <div>
          Overall winner is:{" "}
          {appModel.gameWinningTeam ? `Team ${appModel.gameWinningTeam}` : "It's a TIE!"}
        </div>
        <div>
          Longest word: {appModel.longestWord.value} ({appModel.longestWord.playerName}){" "}
        </div>
        <div>
          Most Captures: {appModel.mostCaptures.value} ({appModel.mostCaptures.playerName}){" "}
        </div>
        <button onClick={() => appModel.playAgain(false)}>Play again, same players</button>
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
  appModel?: LexiblePresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: Readonly<{ appModel?: LexiblePresenterModel; uiProperties: UIProperties }>) {
    super(props);

    const { appModel } = this.props;
    if (!appModel) throw new Error("No appModel provided");

    // Set up sound effects
    this.media = new MediaHelper();
    for (let soundName in LexibleAssets.sounds) {
      this.media.loadSound((LexibleAssets.sounds as any)[soundName]);
    }

    const sfxVolume = 1.0;

    let timeAlertLoaded = false;
    appModel.onTick.subscribe("Timer Watcher", () => {
      if (appModel.secondsLeftInStage > 10) timeAlertLoaded = true;
      if (
        appModel.gameState === GeneralGameState.Playing &&
        timeAlertLoaded &&
        appModel.secondsLeftInStage <= 10
      ) {
        timeAlertLoaded = false;
        this.media.repeatSound(LexibleAssets.sounds.ding, 5, 100);
      }
    });
    appModel.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(LexibleAssets.sounds.hello, { volume: sfxVolume * 0.2 }),
    );
    appModel.subscribe(LexibleGameEvent.ResponseReceived, "play response received sound", () =>
      this.media.playSound(LexibleAssets.sounds.response, { volume: sfxVolume }),
    );
  }

  // -------------------------------------------------------------------
  // renderPlayArea
  // -------------------------------------------------------------------
  private renderPlayArea() {
    const { appModel } = this.props;
    if (!appModel) {
      return <div>NO APP MODEL</div>;
    }

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case GeneralGameState.Instructions:
        return <InstructionsPage />;
      case LexibleGameState.EndOfRound:
      case GeneralGameState.Playing:
        return <PlayingPage media={this.media} />;
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
        <button className={classNames(styles.quitButton)} onClick={() => appModel.quitApp()}>
          Quit
        </button>
        <div className={classNames(styles.roomCode)}>
          <div>Room Code:</div>
          <div style={{ fontSize: "180%", fontWeight: 800 }}>{appModel.roomId}</div>
        </div>
        <div className={classNames(styles.currentRound)}>
          <div>Round:</div>
          <div style={{ fontSize: "180%", fontWeight: 800 }}>
            {appModel.currentRound}/{appModel.totalRounds}
          </div>
        </div>
        <div className={classNames(styles.version)}>
          <GameVersionTag title="Lexible" history={LEXIBLE_VERSION_HISTORY} showChanges />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const renderTeam = (teamName: string) => {
      return (
        <div>
          <div className={styles.teamTitle} style={{ color: teamColor(teamName) }}>
            TEAM {teamName}
          </div>
          {this.props
            .appModel!.players.filter((p) => p.teamName === teamName)
            .map((p) => (
              // A player who has dropped KEEPS THEIR SEAT and their score - see the
              // lifecycle contract - so the roster still lists them.  Greyed out with a
              // warning sign, because "why is nobody playing for us" is otherwise a
              // mystery the room has no way to solve.
              <div
                className={classNames(
                  styles.teamPlayerName,
                  p.isConnected ? undefined : styles.disconnectedPlayer,
                )}
                key={p.playerId}
                title={p.isConnected ? undefined : `${p.name} has lost connection`}
              >
                {p.isConnected ? null : (
                  <span className={styles.disconnectedIcon} role="img" aria-label="disconnected">
                    &#9888;
                  </span>
                )}
                {p.name}
              </div>
            ))}
        </div>
      );
    };

    const stats = appModel.session.stats;
    const sendRate = stats.sentCount / appModel.gameTimeMinutes;
    const recieveRate = stats.recievedCount / appModel.gameTimeMinutes;
    const sendSize = stats.bytesSent / stats.sentCount / 1000;
    const receiveSize = stats.bytesRecieved / stats.sentCount / 1000;

    const debugClick = () => {
      appModel.showDebugInfo = !appModel.showDebugInfo;
    };

    return (
      <UINormalizer
        className={styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        {this.renderFrame()}
        <DevUI
          style={{ position: "absolute", left: "50%", bottom: "0px", fontSize: "50%" }}
          context={appModel}
        >
          <button onClick={() => appModel.handleGameWin("A")}>Win: A</button>
          <button onClick={() => appModel.handleGameWin("B")}>Win: B</button>
        </DevUI>
        <button className={styles.debugButton} onClick={debugClick} />
        {appModel.showDebugInfo ? (
          <div className={styles.debugtext}>
            Sent: {stats.sentCount} {sendRate.toFixed(1)}/min ({(stats.bytesSent / 1000).toFixed(1)}
            KB, {sendSize.toFixed(1)}/msg) Recv: {stats.recievedCount} {recieveRate.toFixed(1)}/min
            ({(stats.bytesRecieved / 1000).toFixed(1)}KB, {receiveSize.toFixed(1)}/msg)
          </div>
        ) : null}

        {/* Both rosters live on the left now.  Both teams also START on the left
            (see models/teamAreas.ts), so the panel order matches the board, and
            the space the old right-hand column took goes to the play area. */}
        <div style={{ margin: "15px" }}>
          <Row className={styles.presenterRow}>
            {/* Each roster is washed with its own team colour.  Two cream cards
                distinguished only by the colour of their heading made the room work
                to tell them apart; the panel itself carrying the colour means a
                glance is enough. Pale, because player names sit on top of it. */}
            <div className={styles.teamColumn}>
              <div
                className={styles.teamPanel}
                style={{
                  borderTop: `6px solid ${teamColor("A")}`,
                  background: mixWithWhite(teamColor("A"), TEAM_PANEL_TINT),
                }}
              >
                {renderTeam("A")}
              </div>
              <div
                className={styles.teamPanel}
                style={{
                  borderTop: `6px solid ${teamColor("B")}`,
                  background: mixWithWhite(teamColor("B"), TEAM_PANEL_TINT),
                }}
              >
                {renderTeam("B")}
              </div>
            </div>
            <div className={styles.playColumn}>{this.renderPlayArea()}</div>
          </Row>
        </div>
      </UINormalizer>
    );
  }
}
