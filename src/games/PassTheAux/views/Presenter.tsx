// The shared-screen view.  One page component per presenter game state, chosen by
// renderSubScreen().  All observers over the presenter model - they render state, never own it.
//
// Look: design 2a "BURNED CD-R" - a 2000s denim desktop.  Every panel is a glossy XP-ish
// window, every host action is a gel bubble button, counters are green LCD readouts, and
// asides are scrawled in Sharpie.  See Presenter.module.css for the kit.
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
  GameVersionTag,
} from "libs";
import PassTheAuxAssets from "../assets/Assets";
import {
  PASS_THE_AUX_VERSION_HISTORY,
  METADATA_REVEAL_MS,
  METADATA_FADE_MS,
  AUDIO_FADE_MS,
  TALLY_STEP_MS,
  SONG_PLAY_MS,
} from "../models/GameSettings";
import { isRealVideoId } from "../models/musicProvider";
import { YouTubePlayer } from "./YouTubePlayer";
import { BackgroundMusic } from "./BackgroundMusic";
import {
  PassTheAuxPresenterModel,
  PassTheAuxGameState,
  PassTheAuxGameEvent,
  PassTheAuxPlayer,
} from "../models/PresenterModel";

const watchLink = (videoId: string, title: string, artist: string) =>
  isRealVideoId(videoId)
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${artist}`)}`;

// mm:ss for the LCD transport readouts.
const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// The looping background-music bed for each phase (null = silence, e.g. during Playback when
// the actual song plays, and while Paused).
function musicForState(state: string): string | null {
  switch (state) {
    case PresenterGameState.Gathering:
      return PassTheAuxAssets.music.lobby;
    case PassTheAuxGameState.PromptReveal:
    case PassTheAuxGameState.Selecting:
      return PassTheAuxAssets.music.selection;
    case PassTheAuxGameState.Voting:
      return PassTheAuxAssets.music.voting;
    case PassTheAuxGameState.Tally:
    case PassTheAuxGameState.Scoreboard:
      return PassTheAuxAssets.music.tally;
    case GeneralGameState.GameOver:
      return PassTheAuxAssets.music.endgame;
    default:
      return null; // Playback (real song plays) / Paused
  }
}

// -------------------------------------------------------------------
// Shared chrome pieces
// -------------------------------------------------------------------

// A glossy desktop window: title bar (with an optional right-hand meter) plus a body.
const Win: React.FC<{
  title: string;
  meter?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}> = ({ title, meter, className, bodyClassName, children }) => (
  <div className={className ? `${styles.win} ${className}` : styles.win}>
    <div className={styles.winBar}>
      <div className={styles.winTitle}>{title}</div>
      {meter && <div className={styles.winMeter}>{meter}</div>}
    </div>
    <div className={bodyClassName ?? styles.winBody}>{children}</div>
  </div>
);

const EqBars: React.FC<{ className?: string }> = ({ className }) => (
  <div className={className ? `${styles.eqBars} ${className}` : styles.eqBars}>
    <div className={styles.eqBar} />
    <div className={styles.eqBar} />
    <div className={styles.eqBar} />
  </div>
);

// A player's gadget.  The shape is derived from their avatar so the same player keeps the
// same device all game; players who have not cued yet get the "still digging" laptop.
const GADGETS = [styles.gadget0, styles.gadget1, styles.gadget2, styles.gadget3];
const Gadget: React.FC<{ variant: number; idle?: boolean }> = ({ variant, idle }) =>
  idle ? (
    <div className={`${styles.gadget} ${styles.gadgetIdle}`}>
      <div className={styles.gadgetIdleScreen}>
        <span>SEARCHING…</span>
      </div>
      <div className={styles.gadgetIdleKeys}>
        <span />
        <span />
        <span />
      </div>
    </div>
  ) : (
    <div className={`${styles.gadget} ${GADGETS[Math.abs(variant) % GADGETS.length]}`} />
  );

// -------------------------------------------------------------------
// Gathering — join + host sets the target score
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GatheringPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const ready = m.players.length >= m.minPlayers;
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.pill}>SIDE A · BURN A MIX</div>
            <h2 className={styles.title}>Match the song to the moment.</h2>
          </div>
          <div className={styles.headRight}>
            <div className={styles.lcdStack}>
              <div className={styles.lcdStackNum}>{m.players.length}</div>
              <div className={styles.lcdStackLabel}>PLUGGED IN</div>
            </div>
          </div>
        </div>

        <Win
          title="join_room.exe — Waiting for players"
          className={styles.gatherWin}
          meter={<EqBars />}
        >
          <div className={styles.promptSub}>
            Join at <b>{window.location.host}</b> with room code <b>{m.roomId}</b>
          </div>
          <div className={styles.stepper}>
            <span>First to</span>
            <button className={styles.stepBtn} onClick={() => m.setTargetScore(m.targetScore - 1)}>
              –
            </button>
            <span className={styles.stepVal}>{m.targetScore}</span>
            <button className={styles.stepBtn} onClick={() => m.setTargetScore(m.targetScore + 1)}>
              +
            </button>
            <span>wins the aux</span>
          </div>
          <div className={styles.roster}>
            {m.players.map((p) => (
              <div className={styles.nameBox} key={p.playerId}>
                <PlayerAvatar avatarId={p.avatarId} size={40} /> {p.name}
              </div>
            ))}
          </div>
        </Win>

        <div className={styles.sticker} style={{ left: 40, bottom: 130 }}>
          no skips. no takebacks.
        </div>

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>
            {ready ? "Everyone's here — burn it." : `Waiting for at least ${m.minPlayers} players…`}
          </div>
          <div className={styles.taskActions}>
            <button className={styles.cta} disabled={!ready} onClick={() => m.beginGame()}>
              START THE SHOW
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Prompt reveal — read it aloud, then open submissions
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PromptRevealPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div className={styles.screen}>
        <div className={styles.cable} />

        <Win
          title={`scenario_round${String(m.currentRound).padStart(2, "0")}.wma — Now Playing`}
          className={styles.promptWin}
          meter={
            <>
              <EqBars />
              <div>128 KBPS</div>
            </>
          }
        >
          <div className={styles.pill}>SCENARIO · ROUND {m.currentRound}</div>
          <div className={styles.promptText}>{m.prompt}</div>
          <div className={styles.promptSub}>
            Cue up the track that fits. You've got until everyone's plugged in.
          </div>
          <div className={styles.ctaRow}>
            <button className={styles.cta} onClick={() => m.beginSelecting()}>
              START SELECTING
            </button>
            <div className={styles.ctaHint}>HOST · read it aloud first</div>
          </div>
        </Win>

        {/* Decor: the bedazzled player sitting on the desktop next to the window. */}
        <div className={styles.player}>
          <div className={styles.playerPlug} />
          <div className={styles.playerShell} />
          <div className={styles.playerGems} />
          <div className={styles.playerScreen}>
            <div className={styles.playerScreenBig}>AUX IN</div>
            <div className={styles.playerScreenLine}>
              RND {String(m.currentRound).padStart(2, "0")} · {m.presentCount} PLYRS
            </div>
            <EqBars className={styles.playerEq} />
          </div>
          <div className={styles.playerWheel} />
        </div>

        <div className={styles.sticker} style={{ left: 30, bottom: 40 }}>
          no skips. no takebacks.
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Selecting — players cue songs on their phones.  Every player is a gadget on the desktop.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SelectingPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const gridCls =
      m.players.length > 6 ? `${styles.deviceGrid} ${styles.cols4}` : styles.deviceGrid;
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.pill}>SCENARIO · ROUND {m.currentRound}</div>
            <div className={styles.title}>{m.prompt}</div>
          </div>
          <div className={styles.headRight}>
            <div className={styles.lcdStack}>
              <div className={styles.lcdStackNum}>
                {m.submittedCount}/{m.presentCount}
              </div>
              <div className={styles.lcdStackLabel}>PLUGGED IN</div>
            </div>
          </div>
        </div>

        <div className={gridCls}>
          {m.players.map((p, i) => {
            const cued = !!p.submission;
            return (
              <div
                className={cued ? styles.deviceCard : `${styles.deviceCard} ${styles.idle}`}
                key={p.playerId}
              >
                <div className={styles.deviceBar}>
                  <span className={styles.deviceAvatar}>
                    <PlayerAvatar avatarId={p.avatarId} size={34} />
                  </span>
                  <span className={styles.deviceName}>{p.name}</span>
                </div>
                <div className={styles.deviceBody}>
                  <Gadget variant={p.avatarId ?? i} idle={!cued} />
                  <div className={styles.deviceStatus}>
                    {cued ? (
                      <>
                        <span className={styles.pillGreen}>CUED</span>
                        <div className={styles.deviceNote}>song hidden ;)</div>
                      </>
                    ) : (
                      <>
                        <span className={styles.pillAmber}>DIGGING</span>
                        <div className={styles.deviceNotePlain}>scrolling the burned folder</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>
            {m.allSubmitted
              ? "Everyone's plugged in."
              : `Waiting on ${m.presentCount - m.submittedCount} — host can force-advance`}
          </div>
          <div className={styles.taskActions}>
            <button
              className={m.allSubmitted ? `${styles.cta} ${styles.hot}` : styles.cta}
              onClick={() => m.beginPlayback()}
            >
              {m.allSubmitted ? "START PLAYBACK" : "FORCE ADVANCE"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Playback — the jukebox.  A spinning burned CD-R covers the art until the metadata reveal,
// which fires 8s after the audio ACTUALLY starts (not stage start - buffering must not eat
// the mystery window).  On advance, the old metadata fades fully out before the display
// swaps, so the next track's title never flashes mid-fade.  Audio fades in on start and out
// before the song advances.  Submitter is never shown.  30s per song, host can jump ahead.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PlaybackPage extends React.Component<
  { appModel?: PassTheAuxPresenterModel },
  { displayIndex: number; revealed: boolean }
> {
  private player = React.createRef<YouTubePlayer>();
  private lastModelIndex = -1;
  private startedVideoId: string | null = null; // the videoId that has actually begun playing
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private fadedOut = false;

  constructor(props: { appModel?: PassTheAuxPresenterModel }) {
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
    const span = SONG_PLAY_MS / 1000;
    const elapsed = Math.min(span, Math.max(0, span - m.secondsLeftInStage));

    return (
      <div className={styles.juke}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.trackCounter}>
              TRACK {m.currentSongIndex + 1} OF {total}
            </div>
            <div className={styles.pill}>THE MOMENT · {m.prompt}</div>
          </div>
          <div className={styles.headRight}>
            <div className={styles.lcdBig}>
              {clock(elapsed)} / {clock(span)}
            </div>
          </div>
        </div>

        <Win
          title={`now playing — track_${String(m.currentSongIndex + 1).padStart(2, "0")}.mp3`}
          className={styles.jukeWin}
          bodyClassName={styles.jukeBody}
          meter={<EqBars />}
        >
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
              <div className={styles.disc} />
            </div>
          </div>

          <div className={styles.jukeSide}>
            {revealed ? (
              <div className={`${styles.meta} ${styles.show}`}>
                <div className={styles.metaTitle}>{display.title}</div>
                <div className={styles.metaArtist}>{display.artist}</div>
              </div>
            ) : (
              <div>
                <div className={styles.mysteryMark}>? ? ?</div>
                <div className={styles.mysteryText}>
                  Nobody's name shows until the tally. Just listen.
                </div>
              </div>
            )}
            <div className={styles.chipRow}>
              <span className={styles.pillBlue}>{clock(m.secondsLeftInStage)} LEFT</span>
              <span className={styles.pillBlue}>SUBMITTED BY ???</span>
            </div>
            <div className={styles.progress}>
              <div className={styles.barFill} style={{ width: `${(elapsed / span) * 100}%` }} />
            </div>
          </div>
        </Win>

        {!revealed && <div className={styles.secretTag}>no peeking — metadata incoming</div>}

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>SUBMITTER HIDDEN UNTIL TALLY</div>
          <div className={styles.taskActions}>
            <button className={`${styles.cta} ${styles.hot}`} onClick={() => m.advanceSong()}>
              SKIP ▸▸
            </button>
          </div>
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
class VotingPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.pill}>RANK YOUR TOP 3</div>
            <h2 className={styles.title}>Which one fits the moment?</h2>
            <div className={styles.sharpie} style={{ fontSize: 28 }}>
              tap to rank on your phone — no voting for yourself!
            </div>
          </div>
          <div className={styles.headRight}>
            <div className={styles.lcdStack}>
              <div className={styles.lcdStackNum}>
                {m.votedCount}/{m.presentCount}
              </div>
              <div className={styles.lcdStackLabel}>BALLOTS IN</div>
            </div>
          </div>
        </div>

        <Win title="the_ballot — 1 of 1" meter={<EqBars />} bodyClassName={styles.winBody}>
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
        </Win>

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>
            {m.allVoted ? "Every ballot is in." : "Editable until voting closes"}
          </div>
          <div className={styles.taskActions}>
            <button
              className={m.allVoted ? `${styles.cta} ${styles.hot}` : styles.cta}
              onClick={() => m.beginTally()}
            >
              {m.allVoted ? "TALLY THE VOTES" : "CLOSE VOTING & TALLY"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Tally — step through the IRV eliminations.  Each lane is an XP loading bar sliced into one
// hatched chip per voter, labelled with that player's name; as a song is eliminated its
// voters' chips slide over to the bar of their next surviving choice, so you can see every
// vote get reassigned.
// -------------------------------------------------------------------
const LANE_H = 104;
const LABEL_W = 430;
const CHIP_W = 156;
const CHIP_H = 72;

@inject("appModel")
@observer
class TallyPage extends React.Component<
  { appModel?: PassTheAuxPresenterModel },
  { stepIndex: number }
> {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(props: { appModel?: PassTheAuxPresenterModel }) {
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
    const majority = Math.floor(allVoterIds.length / 2) + 1;

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
    const exhausted = allVoterIds.filter((v) => posOf(v) === null).length;

    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.title}>{isFinal ? "AND THE WINNER IS…" : "RUNOFF"}</div>
            <div className={styles.pill}>
              ROUND {stepIndex + 1} · MAJORITY NEEDS {majority} OF {allVoterIds.length}
            </div>
          </div>
          <div className={styles.headRight}>
            <div className={styles.lcd}>
              {allVoterIds.length} BALLOTS · {exhausted} EXHAUSTED
            </div>
          </div>
        </div>

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
            const x = LABEL_W + 8 + slot * CHIP_W;
            const y = row * LANE_H + 9;
            return (
              <div
                key={vid}
                className={styles.voteChip}
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                  width: CHIP_W - 12,
                  height: CHIP_H,
                  opacity: pos ? 1 : 0,
                }}
              >
                <PlayerAvatar avatarId={p?.avatarId ?? 0} size={38} />
                <span className={styles.chipName}>{p?.name ?? "?"}</span>
              </div>
            );
          })}
        </div>

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>
            Submitters stay masked until a song clears the majority line.
          </div>
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
class ScoreboardPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const sorted = m.players.slice().sort((a, b) => b.score - a.score);
    const winnerSong = m.roundSongs.find((s) => s.videoId === m.winnerVideoId);
    const top = sorted.length ? sorted[0].score : 0;
    const showPips = m.targetScore <= 10;
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <div className={styles.title}>STANDINGS</div>
            {winnerSong ? (
              <div className={styles.pill}>
                ROUND {m.currentRound} · {m.submitterName(winnerSong.submitterId)} TOOK IT WITH “
                {winnerSong.title}”
              </div>
            ) : (
              <div className={styles.pill}>ROUND {m.currentRound} · NO WINNER</div>
            )}
          </div>
          <div className={styles.headRight}>
            <div className={styles.pillBlue}>FIRST TO {m.targetScore}</div>
          </div>
        </div>

        <div className={styles.scoreList}>
          {sorted.map((p, i) => {
            const lead = p.score === top && top > 0;
            const wonRound = !!winnerSong && winnerSong.submitterId === p.playerId;
            return (
              <div
                className={lead ? `${styles.scoreItem} ${styles.lead}` : styles.scoreItem}
                key={p.playerId}
              >
                <div className={styles.scoreRank}>{i + 1}</div>
                <PlayerAvatar avatarId={p.avatarId} size={54} />
                <div className={styles.scoreName}>{p.name}</div>
                <div className={styles.roundPoint}>{wonRound ? "+1 THIS ROUND" : ""}</div>
                {showPips && (
                  <div className={styles.pips}>
                    {Array.from({ length: m.targetScore }, (_, k) => (
                      <div
                        key={k}
                        className={k < p.score ? `${styles.pip} ${styles.on}` : styles.pip}
                      />
                    ))}
                  </div>
                )}
                <div className={styles.scoreVal}>{p.score}</div>
              </div>
            );
          })}
        </div>

        <div className={styles.taskbar}>
          <div className={styles.taskNote}>ROUND {m.currentRound} COMPLETE</div>
          <div className={styles.taskActions}>
            {m.gameOverPending ? (
              <button className={`${styles.cta} ${styles.hot}`} onClick={() => m.finishGame()}>
                SEE FINAL RESULTS
              </button>
            ) : (
              <button className={styles.cta} onClick={() => m.startNextRound()}>
                NEXT PROMPT
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Game over — winner + the burned disc + per-prompt YouTube links
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GameOverPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    const winners = m.winners;
    const label = winners.length === 1 ? winners[0].name : winners.map((w) => w.name).join(" & ");
    const songCount = m.roundHistory.reduce((n, r) => n + r.songs.length, 0);
    return (
      <div className={styles.overWrap}>
        <div className={styles.overLeft}>
          <div className={styles.pill}>
            GAME OVER · {m.targetScore} POINT{m.targetScore === 1 ? "" : "S"}
          </div>
          <div className={styles.winnerFaces}>
            {winners.map((w: PassTheAuxPlayer) => (
              <PlayerAvatar avatarId={w.avatarId} size={64} key={w.playerId} />
            ))}
          </div>
          <div className={styles.winnerBanner}>
            {label}
            <br />
            {winners.length === 1 ? "WINS" : "TIE"}
          </div>
          <div className={styles.sub}>Held the aux. Everyone else may now speak.</div>
          <div className={styles.overButtons}>
            <button className={styles.cta} onClick={() => m.beginGame()}>
              PLAY AGAIN
            </button>
          </div>

          {/* The souvenir: a burned CD-R with the winner's name inked around the rim. */}
          <div className={styles.mixDisc}>
            <div className={styles.mixDiscFace}>
              <svg viewBox="0 0 300 300">
                <defs>
                  <path id="ptaDiscArc" d="M 150 150 m -118 0 a 118 118 0 1 1 236 0" fill="none" />
                </defs>
                <text className={styles.mixDiscLabel}>
                  <textPath href="#ptaDiscArc" startOffset="50%" textAnchor="middle">
                    {label.toUpperCase()}'S MIX ★
                  </textPath>
                </text>
              </svg>
            </div>
            <div className={styles.mixDiscHub} />
          </div>
        </div>

        <Win
          title={`the_tape — ${m.roundHistory.length} prompts, ${songCount} songs`}
          className={styles.tapeWin}
          bodyClassName={styles.overScroll}
          meter={<div>{songCount} TRACKS</div>}
        >
          {m.roundHistory.map((r, i) => (
            <div className={styles.linkRound} key={i}>
              <div className={styles.linkPrompt}>
                {String(i + 1).padStart(2, "0")} · {r.prompt}
              </div>
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
                  ({s.submitterName})
                  {s.videoId === r.winnerVideoId && <span className={styles.linkWinTag}> ★</span>}
                </div>
              ))}
            </div>
          ))}
        </Win>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Paused
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PausedPage extends React.Component<{ appModel?: PassTheAuxPresenterModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div className={styles.screen}>
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <h2 className={styles.title}>{m.name} is paused</h2>
            <div className={styles.sharpie} style={{ fontSize: 30 }}>
              nobody touch the aux
            </div>
          </div>
        </div>
        <div className={styles.taskbar}>
          <div className={styles.taskNote} />
          <div className={styles.taskActions}>
            <button
              className={styles.cta}
              disabled={m.players.length < m.minPlayers}
              onClick={() => m.resumeGame()}
            >
              RESUME
            </button>
          </div>
        </div>
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
  appModel?: PassTheAuxPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;
  music: BackgroundMusic;
  private disposeMusicReaction: IReactionDisposer | null = null;
  private kickMusic = () => this.music.kick();

  constructor(
    props: Readonly<{ appModel?: PassTheAuxPresenterModel; uiProperties: UIProperties }>,
  ) {
    super(props);
    const { appModel } = this.props;
    this.media = new MediaHelper();
    this.music = new BackgroundMusic(0.5);
    for (let soundName in PassTheAuxAssets.sounds) {
      this.media.loadSound((PassTheAuxAssets.sounds as any)[soundName]);
    }
    const vol = 1.0;
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "joined", () =>
      this.media.playSound(PassTheAuxAssets.sounds.hello, { volume: vol * 0.2 }),
    );
    appModel?.subscribe(PassTheAuxGameEvent.SongSubmitted, "submitted", () =>
      this.media.playSound(PassTheAuxAssets.sounds.ding, { volume: vol * 0.5 }),
    );
    appModel?.subscribe(PassTheAuxGameEvent.BallotReceived, "voted", () =>
      this.media.playSound(PassTheAuxAssets.sounds.response, { volume: vol * 0.5 }),
    );
    appModel?.subscribe(PassTheAuxGameEvent.RoundWinner, "roundwin", () =>
      this.media.playSound(PassTheAuxAssets.sounds.score, { volume: vol * 0.7 }),
    );
    appModel?.subscribe(PassTheAuxGameEvent.WinnerAnnounced, "gamewin", () =>
      this.media.playSound(PassTheAuxAssets.sounds.winner, { volume: vol }),
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
      case PassTheAuxGameState.PromptReveal:
        return <PromptRevealPage />;
      case PassTheAuxGameState.Selecting:
        return <SelectingPage />;
      case PassTheAuxGameState.Playback:
        return <PlaybackPage />;
      case PassTheAuxGameState.Voting:
        return <VotingPage />;
      case PassTheAuxGameState.Tally:
        return <TallyPage />;
      case PassTheAuxGameState.Scoreboard:
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
        <span className={styles.wordmark}>PASS THE AUX</span>
        <span className={styles.sideTag}>side A · vol.{Math.max(1, m.currentRound)}</span>
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
        <span className={styles.lcd}>ROOM {m.roomId}</span>
        <span className={styles.recDot} />
        <DevUI context={m} children={<div></div>} />
        <span className={styles.version}>
          <GameVersionTag title="Pass the AUX" history={PASS_THE_AUX_VERSION_HISTORY} showChanges />
        </span>
      </div>
    );
  }

  render() {
    const playing = this.props.appModel?.gameState === PassTheAuxGameState.Playback;
    return (
      <UINormalizer
        className={playing ? `${styles.gamepresenter} ${styles.dim}` : styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        <div className={styles.noise} />
        <div className={styles.sparkles} />
        {this.renderFrame()}
        <div className={styles.stage}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
