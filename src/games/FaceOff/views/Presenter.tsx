// The shared-screen view. One page component per presenter game state, chosen by
// renderSubScreen(). All observers over the presenter model — they render state, never own it.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import FaceOffAssets from "../assets/Assets";
import { FaceOffVersion, POINTS_PER_VOTE, WIN_BONUS } from "../models/GameSettings";
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
  FaceOffPresenterModel,
  FaceOffGameState,
  FaceOffGameEvent,
  FaceOffEntry,
} from "../models/PresenterModel";
import { scoreForEntry } from "../models/faceOffLogic";
import { PromptInfo } from "../models/prompts";

// -------------------------------------------------------------------
// Shared bits
// -------------------------------------------------------------------
const Wordmark: React.FC = () => (
  <span className={styles.wordmark}>
    FACE<span className={styles.off}>OFF</span>
  </span>
);

const PromptView: React.FC<{ prompt: PromptInfo; big?: boolean }> = ({ prompt, big }) => {
  if (prompt.kind === "emoji") {
    return (
      <div className={classNames(styles.prompt, big && styles.promptBig)}>
        <div className={styles.promptEmoji}>{prompt.emoji}</div>
        {prompt.text ? <div className={styles.promptCaption}>{prompt.text}</div> : null}
      </div>
    );
  }
  if (prompt.kind === "image" && prompt.src) {
    return (
      <div className={classNames(styles.prompt, big && styles.promptBig)}>
        <img className={styles.promptImg} src={prompt.src} alt={prompt.text ?? "prompt"} />
        {prompt.text ? <div className={styles.promptCaption}>{prompt.text}</div> : null}
      </div>
    );
  }
  return (
    <div className={classNames(styles.prompt, styles.promptText, big && styles.promptBig)}>
      “{prompt.text}”
    </div>
  );
};

const EntryPhoto: React.FC<{ entry: FaceOffEntry; reveal?: boolean }> = ({ entry, reveal }) => (
  <div className={classNames(styles.entry, reveal && entry.isWinner && styles.entryWinner)}>
    {entry.hasPhoto ? (
      <img className={styles.entryImg} src={entry.full} alt={reveal ? entry.playerName : "entry"} />
    ) : (
      <div className={styles.entryNoPhoto}>No photo 📵</div>
    )}
    {reveal ? (
      <div className={styles.entryFooter}>
        <PlayerAvatar avatarId={entry.avatarId} size={40} /> <span>{entry.playerName}</span>
        <span className={styles.entryVotes}>{entry.votes} ▲</span>
        {entry.isWinner ? <span className={styles.crown}>👑</span> : null}
        <span className={styles.entryPts}>
          +{scoreForEntry(entry.votes, entry.isWinner, POINTS_PER_VOTE, WIN_BONUS)}
        </span>
      </div>
    ) : null}
  </div>
);

// -------------------------------------------------------------------
// Gathering
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GatheringPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const enough = appModel.players.length >= appModel.minPlayers;
    return (
      <div className={styles.gathering}>
        <h1 className={styles.title}>Mimic the face. Win the vote.</h1>
        <p className={styles.joinLine}>
          Join at <span className={styles.host}>{window.location.host}</span> — room code{" "}
          <span className={styles.room}>{appModel.roomId}</span>
        </p>

        {appModel.players.length > 0 ? (
          <div className={styles.roster}>
            {appModel.players.map((p) => (
              <div className={styles.rosterItem} key={p.playerId}>
                <PlayerAvatar avatarId={p.avatarId} size={56} />
                <span className={styles.rosterName}>{p.name}</span>
                <span className={styles.roleTag}>{p.hasCamera ? "📸 contestant" : "⚖️ judge"}</span>
              </div>
            ))}
          </div>
        ) : null}

        {appModel.needCamera ? (
          <div className={styles.warn}>Need at least 2 players with a camera to run a round.</div>
        ) : null}

        {enough ? (
          <button className={styles.bigButton} onClick={() => appModel.startGame()}>
            Start the show!
          </button>
        ) : (
          <div className={styles.waiting}>
            Waiting for at least {appModel.minPlayers} players ({appModel.players.length} so far)…
          </div>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Capturing
// -------------------------------------------------------------------
@inject("appModel")
@observer
class CapturingPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const counting = appModel.isCountingDown;
    const secs = appModel.secondsLeftInStage;
    return (
      <div className={styles.capture}>
        <div className={styles.captureHead}>
          Round {appModel.currentRound} of {appModel.totalRounds}
        </div>
        <div className={styles.poseLine}>STRIKE YOUR POSE</div>
        {counting ? (
          <div className={styles.countdown}>{secs > 0 ? secs : "SNAP!"}</div>
        ) : (
          <div className={styles.snapNow}>📸 SNAP! Hold it…</div>
        )}
        <div className={styles.captureHint}>Your secret prompt is on your phone.</div>
        <div className={styles.contestantStrip}>
          {appModel.contestants.map((p) => (
            <div
              className={classNames(styles.contestantChip, p.submitted && styles.chipDone)}
              key={p.playerId}
            >
              <PlayerAvatar avatarId={p.avatarId} size={44} />
              <span>{p.name}</span>
              <span>{p.submitted ? "✅" : "…"}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Voting
// -------------------------------------------------------------------
@inject("appModel")
@observer
class VotingPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={styles.voting}>
        <div className={styles.captureHead}>
          Round {appModel.currentRound} — who nailed it? Vote on your phones!
        </div>
        <div className={styles.timer}>{appModel.secondsLeftInStage}s</div>
        <div className={styles.matchGrid}>
          {appModel.matchups.map((m) => (
            <div className={styles.matchCard} key={m.id}>
              <PromptView prompt={m.prompt} />
              <div className={styles.matchEntries}>
                {m.entries.map((e) => (
                  <EntryPhoto entry={e} key={e.entryId} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Revealing
// -------------------------------------------------------------------
@inject("appModel")
@observer
class RevealingPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const m = appModel.currentMatchup;
    if (!m) return <div className={styles.voting}>…</div>;
    return (
      <div className={styles.reveal}>
        <div className={styles.captureHead}>
          The verdict — matchup {appModel.revealIndex + 1} of {appModel.matchups.length}
        </div>
        <PromptView prompt={m.prompt} big />
        <div className={styles.revealEntries}>
          {m.entries.map((e) => (
            <EntryPhoto entry={e} reveal key={e.entryId} />
          ))}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Round scoreboard
// -------------------------------------------------------------------
@inject("appModel")
@observer
class RoundScoreboardPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const rows = appModel.players.slice().sort((a, b) => b.score - a.score);
    return (
      <div className={styles.scoreboard}>
        <h1 className={styles.title}>
          Round {appModel.currentRound} of {appModel.totalRounds} — standings
        </h1>
        <div className={styles.standList}>
          {rows.map((p, i) => (
            <div className={styles.standRow} key={p.playerId}>
              <span className={styles.rank}>{i + 1}</span>
              <PlayerAvatar avatarId={p.avatarId} size={48} />
              <span className={styles.standName}>{p.name}</span>
              <span className={styles.standScore}>{p.score}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Game over
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameOverPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const winners = appModel.winners;
    const rows = appModel.players.slice().sort((a, b) => b.score - a.score);
    return (
      <div className={styles.scoreboard}>
        <div className={styles.winnerBanner}>
          {winners.map((w) => (
            <PlayerAvatar avatarId={w.avatarId} size={80} key={w.playerId} />
          ))}
          <div>
            {winners.length === 1
              ? `🏆 ${winners[0].name} wins with ${winners[0].score}!`
              : `🏆 It's a tie: ${winners.map((w) => w.name).join(" & ")}`}
          </div>
        </div>
        <div className={styles.standList}>
          {rows.map((p, i) => (
            <div className={styles.standRow} key={p.playerId}>
              <span className={styles.rank}>{i + 1}</span>
              <PlayerAvatar avatarId={p.avatarId} size={44} />
              <span className={styles.standName}>{p.name}</span>
              <span className={styles.standScore}>{p.score}</span>
            </div>
          ))}
        </div>
        <button className={styles.bigButton} onClick={() => appModel.playAgain(false)}>
          Play again, same players
        </button>
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedPage extends React.Component<{ appModel?: FaceOffPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={styles.gathering}>
        <h1 className={styles.title}>Paused</h1>
        <button
          className={styles.bigButton}
          disabled={appModel.players.length < appModel.minPlayers}
          onClick={() => appModel.resumeGame()}
        >
          Resume
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Presenter shell
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Presenter extends React.Component<{
  appModel?: FaceOffPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  constructor(props: Readonly<{ appModel?: FaceOffPresenterModel; uiProperties: UIProperties }>) {
    super(props);
    const { appModel } = this.props;

    this.media = new MediaHelper();
    for (let soundName in FaceOffAssets.sounds) {
      this.media.loadSound((FaceOffAssets.sounds as any)[soundName]);
    }
    const vol = 1.0;

    // Countdown ticks in the last 3 seconds of the capture framing.
    let counted = false;
    appModel?.onTick.subscribe("Countdown Watcher", () => {
      if (!appModel) return;
      if (appModel.isCountingDown && appModel.secondsLeftInStage <= 3 && !counted) {
        counted = true;
        this.media.repeatSound("ding.wav", 3, 700);
      }
      if (!appModel.isCountingDown) counted = false;
    });

    // Model events -> sounds (kept in the view layer, out of the game logic).
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "joined", () =>
      this.media.playSound(FaceOffAssets.sounds.hello, { volume: vol * 0.2 }),
    );
    appModel?.subscribe(FaceOffGameEvent.SnapTaken, "snap", () =>
      this.media.playSound(FaceOffAssets.sounds.ding, { volume: vol }),
    );
    appModel?.subscribe(FaceOffGameEvent.MatchupRevealed, "reveal", () =>
      this.media.playSound(FaceOffAssets.sounds.score, { volume: vol * 0.7 }),
    );
    appModel?.subscribe(FaceOffGameEvent.WinnerAnnounced, "winner", () =>
      this.media.playSound(FaceOffAssets.sounds.winner, { volume: vol }),
    );
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPage />;
      case FaceOffGameState.Capturing:
        return <CapturingPage />;
      case FaceOffGameState.Voting:
        return <VotingPage />;
      case FaceOffGameState.Revealing:
        return <RevealingPage />;
      case FaceOffGameState.RoundScoreboard:
        return <RoundScoreboardPage />;
      case GeneralGameState.GameOver:
        return <GameOverPage />;
      case GeneralGameState.Paused:
        return <PausedPage />;
      default:
        return <div>Whoops! No display for state: {appModel.gameState}</div>;
    }
  }

  private renderFrame() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={styles.frame}>
        <Wordmark />
        <button className={styles.frameButton} onClick={() => appModel.quitApp()}>
          Quit
        </button>
        <button
          className={styles.frameButton}
          disabled={appModel.gameState === PresenterGameState.Gathering}
          onClick={() => appModel.pauseGame()}
        >
          Pause
        </button>
        <div className={styles.roomCode}>Room {appModel.roomId}</div>
        <DevUI context={appModel} children={<div></div>} />
        <div className={styles.version}>v{FaceOffVersion}</div>
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
        <div className={styles.stage}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
