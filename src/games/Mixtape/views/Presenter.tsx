// The shared-screen view.  One page component per presenter game state, chosen by
// renderSubScreen().  All observers over the presenter model - they render state, never own it.
import React from "react";
import { observer, inject } from "mobx-react";
import { reaction, IReactionDisposer } from "mobx";
import styles from "./Presenter.module.css";
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
import MixtapeAssets from "../assets/Assets";
import {
  MixtapeVersion,
  METADATA_REVEAL_MS,
  METADATA_FADE_MS,
  AUDIO_FADE_MS,
  TALLY_STEP_MS,
} from "../models/GameSettings";
import { isRealVideoId } from "../models/musicProvider";
import { YouTubePlayer } from "./YouTubePlayer";
import { BackgroundMusic } from "./BackgroundMusic";
import {
  MixtapePresenterModel,
  MixtapeGameState,
  MixtapeGameEvent,
  MixtapePlayer,
} from "../models/PresenterModel";

const watchLink = (videoId: string, title: string, artist: string) =>
  isRealVideoId(videoId)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${artist}`)}`;

// The looping background-music bed for each phase (null = silence, e.g. during Playback when
// the actual song plays, and while Paused).
function musicForState(state: string): string | null {
  switch (state) {
    case PresenterGameState.Gathering:
      return MixtapeAssets.music.lobby;
    case MixtapeGameState.PromptReveal:
    case MixtapeGameState.Selecting:
      return MixtapeAssets.music.selection;
    case MixtapeGameState.Voting:
      return MixtapeAssets.music.voting;
    case MixtapeGameState.Tally:
    case MixtapeGameState.Scoreboard:
      return MixtapeAssets.music.tally;
    case GeneralGameState.GameOver:
      return MixtapeAssets.music.endgame;
    default:
      return null; // Playback (real song plays) / Paused
  }
}

// -------------------------------------------------------------------
// Gathering — join + host sets the target score
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GatheringPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <h2 className={styles.title}>Match the song to the moment.</h2>
        <p className={styles.sub}>
          Join at <b>{window.location.host}</b> with room code <b>{m.roomId}</b>
        </p>

        <div className={styles.stepper}>
          <span>First to</span>
          <button className={styles.stepBtn} onClick={() => m.setTargetScore(m.targetScore - 1)}>
            –
          </button>
          <span className={styles.stepVal}>{m.targetScore}</span>
          <button className={styles.stepBtn} onClick={() => m.setTargetScore(m.targetScore + 1)}>
            +
          </button>
          <span>wins</span>
        </div>

        <div className={styles.roster}>
          {m.players.map((p) => (
            <div className={styles.nameBox} key={p.playerId}>
              <PlayerAvatar avatarId={p.avatarId} size={40} /> {p.name}
            </div>
          ))}
        </div>

        {m.players.length < m.minPlayers ? (
          <div className={styles.sub}>Waiting for at least {m.minPlayers} players…</div>
        ) : (
          <button className={styles.cta} onClick={() => m.beginGame()}>
            Start the show →
          </button>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Prompt reveal — read it aloud, then open submissions
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PromptRevealPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <div className={styles.promptHero}>
          <div className={styles.promptKicker}>Round {m.currentRound} — read it aloud</div>
          <div className={styles.promptText}>{m.prompt}</div>
        </div>
        <button className={styles.cta} onClick={() => m.beginSelecting()}>
          Open the search →
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Selecting — players cue songs on their phones
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SelectingPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <h2 className={styles.title}>{m.prompt}</h2>
        <p className={styles.sub}>
          Find your track on your phone. {m.submittedCount} / {m.presentCount} locked in.
        </p>
        <div className={styles.roster}>
          {m.players.map((p) => (
            <div
              className={p.submission ? `${styles.nameBox} ${styles.done}` : styles.nameBox}
              key={p.playerId}
            >
              <PlayerAvatar avatarId={p.avatarId} size={40} /> {p.name}{" "}
              {p.submission ? (
                <span className={styles.check}>✓</span>
              ) : (
                <span className={styles.waitingDot}>…</span>
              )}
            </div>
          ))}
        </div>
        <button
          className={m.allSubmitted ? `${styles.cta} ${styles.hot}` : styles.cta}
          onClick={() => m.beginPlayback()}
        >
          {m.allSubmitted ? "Play the tracks →" : "Skip ahead & play what we have →"}
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Playback — the jukebox.  Mystery tile until the metadata reveal, which fires 8s after the
// audio ACTUALLY starts (not stage start - buffering must not eat the mystery window).  On
// advance, the old metadata fades fully out before the display swaps, so the next track's
// title never flashes mid-fade.  Audio fades in on start and out before the song advances.
// Submitter is never shown.  30s per song, host can jump to the next.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PlaybackPage extends React.Component<
  { appModel?: MixtapePresenterModel },
  { displayIndex: number; revealed: boolean }
> {
  private player = React.createRef<YouTubePlayer>();
  private lastModelIndex = -1;
  private startedVideoId: string | null = null; // the videoId that has actually begun playing
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private fadedOut = false;

  constructor(props: { appModel?: MixtapePresenterModel }) {
    super(props);
    this.state = { displayIndex: props.appModel?.currentSongIndex ?? 0, revealed: false };
  }

  componentDidMount() {
    this.lastModelIndex = this.props.appModel!.currentSongIndex;
    this.armForDisplayedSong();
  }

  componentDidUpdate() {
    const m = this.props.appModel!;
    // 1s audio fade-out as the song's window runs out (before the model auto-advances).
    if (
      !this.fadedOut &&
      m.secondsLeftInStage > 0 &&
      m.secondsLeftInStage <= AUDIO_FADE_MS / 1000
    ) {
      this.fadedOut = true;
      this.player.current?.fadeOut(AUDIO_FADE_MS);
    }
    // The model advanced to a new song.  Keep displaying the OLD metadata while it fades out,
    // then swap to the new (still-hidden) track and re-arm its reveal.
    if (m.currentSongIndex !== this.lastModelIndex) {
      this.lastModelIndex = m.currentSongIndex;
      this.fadedOut = false;
      if (this.revealTimer) {
        clearTimeout(this.revealTimer);
        this.revealTimer = null;
      }
      this.setState({ revealed: false });
      if (this.swapTimer) clearTimeout(this.swapTimer);
      this.swapTimer = setTimeout(() => {
        this.setState({ displayIndex: this.props.appModel!.currentSongIndex }, () =>
          this.armForDisplayedSong(),
        );
      }, METADATA_FADE_MS);
    }
  }

  componentWillUnmount() {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    if (this.swapTimer) clearTimeout(this.swapTimer);
  }

  // Arm the reveal for the currently-displayed song once its audio has started.  Mock tracks
  // never emit a PLAYING event, so treat them as started immediately (full mystery window).
  private armForDisplayedSong() {
    const disp = this.props.appModel!.roundSongs[this.state.displayIndex];
    if (!disp) return;
    if (!isRealVideoId(disp.videoId)) this.startedVideoId = disp.videoId;
    this.maybeArmReveal();
  }

  private onPlaying = (videoId: string) => {
    this.startedVideoId = videoId;
    this.maybeArmReveal();
  };

  private maybeArmReveal() {
    if (this.revealTimer || this.state.revealed) return;
    const disp = this.props.appModel!.roundSongs[this.state.displayIndex];
    if (!disp || this.startedVideoId !== disp.videoId) return;
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      this.setState({ revealed: true });
    }, METADATA_REVEAL_MS);
  }

  render() {
    const m = this.props.appModel!;
    const song = m.currentSong; // audio/video follows the model immediately
    if (!song) return <div className={styles.sub}>Cueing up…</div>;
    const display = m.roundSongs[this.state.displayIndex] ?? song; // metadata lags on advance
    const revealed = this.state.revealed;
    const total = m.roundSongs.length;
    const real = isRealVideoId(song.videoId);

    return (
      <div className={styles.juke}>
        <div className={styles.tile}>
          {real && (
            <YouTubePlayer
              key={`${song.videoId}-${m.currentSongIndex}`}
              ref={this.player}
              videoId={song.videoId}
              startSec={song.startSec}
              autoplay
              fadeInMs={AUDIO_FADE_MS}
              onPlaying={this.onPlaying}
              fill
            />
          )}
          <div className={revealed ? `${styles.mystery} ${styles.hide}` : styles.mystery}>
            <div className={styles.mysteryMark}>🎵</div>
            <div className={styles.mysteryText}>Who picked this?</div>
          </div>
        </div>

        <div className={styles.jukeSide}>
          <div className={styles.trackCounter}>
            Track {m.currentSongIndex + 1} of {total}
          </div>
          <div className={revealed ? `${styles.meta} ${styles.show}` : styles.meta}>
            <div className={styles.metaTitle}>{display.title}</div>
            <div className={styles.metaArtist}>{display.artist}</div>
          </div>
          {!revealed && <div className={styles.secretTag}>metadata hidden…</div>}
          <div className={styles.countdown}>{Math.max(0, Math.ceil(m.secondsLeftInStage))}s</div>
          <button className={styles.button} onClick={() => m.advanceSong()}>
            Next ⏭
          </button>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Voting — songs listed (no submitters), players rank on their phones
// -------------------------------------------------------------------
@inject("appModel")
@observer
class VotingPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <h2 className={styles.title}>Rank your top 3 on your phone</h2>
        <p className={styles.sub}>
          {m.votedCount} / {m.presentCount} have voted.
        </p>
        <div className={styles.songGrid}>
          {m.roundSongs.map((s, i) => (
            <div className={styles.songRow} key={s.videoId}>
              <div className={styles.songNum}>{i + 1}</div>
              {s.thumbnailUrl ? (
                <img className={styles.songThumb} src={s.thumbnailUrl} alt="" />
              ) : (
                <div className={styles.songThumb} />
              )}
              <div className={styles.songInfo}>
                <div className={styles.songTitle}>{s.title}</div>
                <div className={styles.songArtist}>{s.artist}</div>
              </div>
            </div>
          ))}
        </div>
        <button
          className={m.allVoted ? `${styles.cta} ${styles.hot}` : styles.cta}
          onClick={() => m.beginTally()}
        >
          {m.allVoted ? "Tally the votes →" : "Close voting & tally →"}
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Tally — step through the IRV eliminations.  Each bar is sliced into one chip per voter,
// labelled with that player's name; as a song is eliminated its voters' chips slide over to
// the bar of their next surviving choice, so you can see every vote get reassigned.
// -------------------------------------------------------------------
const LANE_H = 104;
const LABEL_W = 430;
const CHIP_W = 156;
const CHIP_H = 72;

@inject("appModel")
@observer
class TallyPage extends React.Component<
  { appModel?: MixtapePresenterModel },
  { stepIndex: number }
> {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(props: { appModel?: MixtapePresenterModel }) {
    super(props);
    this.state = { stepIndex: 0 };
  }
  componentDidMount() {
    const steps = this.props.appModel!.tallyOutcome?.steps ?? [];
    this.timer = setInterval(() => {
      this.setState((s) => {
        if (s.stepIndex >= steps.length - 1) return s;
        return { stepIndex: s.stepIndex + 1 };
      });
    }, TALLY_STEP_MS);
  }
  componentWillUnmount() {
    if (this.timer) clearInterval(this.timer);
  }

  render() {
    const m = this.props.appModel!;
    const outcome = m.tallyOutcome;
    if (!outcome || outcome.steps.length === 0) {
      return <div className={styles.sub}>No votes were cast this round.</div>;
    }
    const stepIndex = Math.min(this.state.stepIndex, outcome.steps.length - 1);
    const step = outcome.steps[stepIndex];
    const isFinal = stepIndex >= outcome.steps.length - 1;

    // Songs eliminated in PRIOR steps (their chips have already moved away by this step).
    const eliminated = new Set<string>();
    for (let i = 0; i < stepIndex; i++) {
      outcome.steps[i].eliminated.forEach((e) => eliminated.add(e));
    }

    // Every voter who cast a ballot (stable identity across steps -> the chip animates rather
    // than remounting when its song is eliminated).
    const allVoterIds: string[] = [];
    for (const ids of Object.values(outcome.steps[0].support)) {
      for (const v of ids) if (!allVoterIds.includes(v)) allVoterIds.push(v);
    }

    // Where a voter's chip sits at this step: {row, slot}, or null when its ballot is exhausted.
    const posOf = (vid: string): { row: number; slot: number } | null => {
      for (let i = 0; i < m.roundSongs.length; i++) {
        const backers = step.support[m.roundSongs[i].videoId];
        if (backers) {
          const slot = backers.indexOf(vid);
          if (slot >= 0) return { row: i, slot };
        }
      }
      return null;
    };
    const playerById = (id: string) => m.players.find((p) => p.playerId === id);

    return (
      <div>
        <h2 className={styles.title}>{isFinal ? "And the winner is…" : "Counting the votes…"}</h2>
        <div className={styles.tallyStage} style={{ height: m.roundSongs.length * LANE_H }}>
          {m.roundSongs.map((s, i) => {
            const isWinner = isFinal && s.videoId === m.winnerVideoId;
            const isGone = eliminated.has(s.videoId) && !isWinner;
            const cls = [styles.tallyLane];
            if (isGone) cls.push(styles.eliminated);
            if (isWinner) cls.push(styles.winner);
            const count = step.support[s.videoId]?.length ?? 0;
            return (
              <div className={cls.join(" ")} key={s.videoId} style={{ top: i * LANE_H }}>
                <div className={styles.laneLabel} style={{ width: LABEL_W }}>
                  <div className={styles.songTitle}>{s.title}</div>
                  <div className={styles.songArtist}>{s.artist}</div>
                  {isFinal && (
                    <div className={styles.submitterReveal}>— {m.submitterName(s.submitterId)}</div>
                  )}
                </div>
                <div className={styles.laneBar} style={{ left: LABEL_W }} />
                <div className={styles.laneCount}>{count}</div>
              </div>
            );
          })}
          {allVoterIds.map((vid) => {
            const pos = posOf(vid);
            const p = playerById(vid);
            const row = pos ? pos.row : m.roundSongs.length; // park exhausted chips below
            const slot = pos ? pos.slot : 0;
            const x = LABEL_W + slot * CHIP_W;
            const y = row * LANE_H + (LANE_H - 14 - CHIP_H) / 2;
            return (
              <div
                key={vid}
                className={styles.voteChip}
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                  width: CHIP_W - 10,
                  height: CHIP_H,
                  opacity: pos ? 1 : 0,
                }}
              >
                <PlayerAvatar avatarId={p?.avatarId ?? 0} size={40} />
                <span className={styles.chipName}>{p?.name ?? "?"}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Scoreboard — standings; round winner highlighted; next / final
// -------------------------------------------------------------------
@inject("appModel")
@observer
class ScoreboardPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const sorted = m.players.slice().sort((a, b) => b.score - a.score);
    const winnerSong = m.roundSongs.find((s) => s.videoId === m.winnerVideoId);
    const top = sorted.length ? sorted[0].score : 0;
    return (
      <div>
        <h2 className={styles.title}>Round {m.currentRound} results</h2>
        {winnerSong ? (
          <p className={styles.sub}>
            🏆 <b>{m.submitterName(winnerSong.submitterId)}</b> won with <b>{winnerSong.title}</b>
          </p>
        ) : (
          <p className={styles.sub}>No winner this round.</p>
        )}
        <div className={styles.scoreList}>
          {sorted.map((p) => (
            <div
              className={
                p.score === top && top > 0 ? `${styles.scoreItem} ${styles.lead}` : styles.scoreItem
              }
              key={p.playerId}
            >
              <PlayerAvatar avatarId={p.avatarId} size={44} /> {p.name}
              <span className={styles.scoreVal}>{p.score}</span>
            </div>
          ))}
        </div>
        {m.gameOverPending ? (
          <button className={`${styles.cta} ${styles.hot}`} onClick={() => m.finishGame()}>
            See final results →
          </button>
        ) : (
          <button className={styles.cta} onClick={() => m.startNextRound()}>
            Next prompt →
          </button>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Game over — winner + per-prompt YouTube links
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameOverPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const winners = m.winners;
    return (
      <div>
        <div className={styles.winnerBanner}>
          {winners.map((w: MixtapePlayer) => (
            <PlayerAvatar avatarId={w.avatarId} size={64} key={w.playerId} />
          ))}
          {winners.length === 1
            ? `🏆 ${winners[0].name} wins with ${winners[0].score}!`
            : `🏆 It's a tie: ${winners.map((w) => w.name).join(" & ")}`}
        </div>
        <p className={styles.sub}>Save the playlists — every prompt's songs:</p>
        <div className={styles.overScroll}>
          {m.roundHistory.map((r, i) => (
            <div className={styles.linkRound} key={i}>
              <div className={styles.linkPrompt}>{r.prompt}</div>
              {r.songs.map((s) => (
                <div
                  className={
                    s.videoId === r.winnerVideoId
                      ? `${styles.linkSong} ${styles.linkWin}`
                      : styles.linkSong
                  }
                  key={s.videoId}
                >
                  <a
                    href={watchLink(s.videoId, s.title, s.artist)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.title} — {s.artist}
                  </a>{" "}
                  ({s.submitterName}){s.videoId === r.winnerVideoId ? " 🏆" : ""}
                </div>
              ))}
            </div>
          ))}
        </div>
        <button className={styles.cta} onClick={() => m.beginGame()}>
          Play again, same players
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Paused
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PausedPage extends React.Component<{ appModel?: MixtapePresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <h2 className={styles.title}>{m.name} is paused</h2>
        <button
          className={styles.cta}
          disabled={m.players.length < m.minPlayers}
          onClick={() => m.resumeGame()}
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
  appModel?: MixtapePresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;
  music: BackgroundMusic;
  private disposeMusicReaction: IReactionDisposer | null = null;
  private kickMusic = () => this.music.kick();

  constructor(props: Readonly<{ appModel?: MixtapePresenterModel; uiProperties: UIProperties }>) {
    super(props);
    const { appModel } = this.props;
    this.media = new MediaHelper();
    this.music = new BackgroundMusic(0.5);
    for (let soundName in MixtapeAssets.sounds) {
      this.media.loadSound((MixtapeAssets.sounds as any)[soundName]);
    }
    const vol = 1.0;
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "joined", () =>
      this.media.playSound(MixtapeAssets.sounds.hello, { volume: vol * 0.2 }),
    );
    appModel?.subscribe(MixtapeGameEvent.SongSubmitted, "submitted", () =>
      this.media.playSound(MixtapeAssets.sounds.ding, { volume: vol * 0.5 }),
    );
    appModel?.subscribe(MixtapeGameEvent.BallotReceived, "voted", () =>
      this.media.playSound(MixtapeAssets.sounds.response, { volume: vol * 0.5 }),
    );
    appModel?.subscribe(MixtapeGameEvent.RoundWinner, "roundwin", () =>
      this.media.playSound(MixtapeAssets.sounds.score, { volume: vol * 0.7 }),
    );
    appModel?.subscribe(MixtapeGameEvent.WinnerAnnounced, "gamewin", () =>
      this.media.playSound(MixtapeAssets.sounds.winner, { volume: vol }),
    );
  }

  componentDidMount() {
    const m = this.props.appModel;
    this.music.setTrack(musicForState(m?.gameState ?? ""));
    // Swap the background bed whenever the phase changes.
    this.disposeMusicReaction = reaction(
      () => this.props.appModel?.gameState ?? "",
      (state) => this.music.setTrack(musicForState(state)),
    );
    // Browsers block autoplay until a gesture; retry the current bed on the first interaction.
    window.addEventListener("pointerdown", this.kickMusic);
  }

  componentWillUnmount() {
    this.disposeMusicReaction?.();
    window.removeEventListener("pointerdown", this.kickMusic);
    this.music.dispose();
  }

  private renderSubScreen() {
    const m = this.props.appModel;
    if (!m) return <div>NO APP MODEL</div>;
    switch (m.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPage />;
      case MixtapeGameState.PromptReveal:
        return <PromptRevealPage />;
      case MixtapeGameState.Selecting:
        return <SelectingPage />;
      case MixtapeGameState.Playback:
        return <PlaybackPage />;
      case MixtapeGameState.Voting:
        return <VotingPage />;
      case MixtapeGameState.Tally:
        return <TallyPage />;
      case MixtapeGameState.Scoreboard:
        return <ScoreboardPage />;
      case GeneralGameState.GameOver:
        return <GameOverPage />;
      case GeneralGameState.Paused:
        return <PausedPage />;
      default:
        return <div>Whoops! No display for this state: {m.gameState}</div>;
    }
  }

  private renderFrame() {
    const m = this.props.appModel!;
    return (
      <div className={styles.frame}>
        <span className={styles.wordmark}>MIXTAPE</span>
        <button className={styles.button} onClick={() => m.quitApp()}>
          Quit
        </button>
        <button
          className={styles.button}
          disabled={m.gameState === PresenterGameState.Gathering}
          onClick={() => m.pauseGame()}
        >
          Pause
        </button>
        <span className={styles.spacer} />
        <span className={styles.roomCode}>
          Room <b>{m.roomId}</b>
        </span>
        <DevUI context={m} children={<div></div>} />
        <span style={{ opacity: 0.4 }}>v{MixtapeVersion}</span>
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
        <div className={styles.energy} />
        {this.renderFrame()}
        <div className={styles.stage}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
