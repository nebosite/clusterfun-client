// The player's phone view.  One sub-screen per client game state, chosen by renderSubScreen().
// Thin: it searches (directly against the MusicProvider), cues a song, and ranks the songs;
// the presenter owns the real game.
//
// Look: design 2a "BURNED CD-R" — the presenter's denim desktop shrunk to a phone.  Blue XP
// status bar, glossy windows, gel bubble buttons, a green LCD waveform for the cue point.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Client.module.css";
import {
  UIProperties,
  GeneralGameState,
  GeneralClientGameState,
  SafeBrowser,
  UINormalizer,
  ErrorBoundary,
  ClientHeader,
} from "libs";
import { PassTheAuxClientModel, PassTheAuxClientState } from "../models/ClientModel";
import {
  MAX_BALLOT,
  CLIENT_PREVIEW_MS,
  SONG_PLAY_MS,
  PASS_THE_AUX_VERSION_HISTORY,
} from "../models/GameSettings";
import { Track, isRealVideoId } from "../models/musicProvider";
import { YouTubePlayer } from "./YouTubePlayer";

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const SNIPPET_SEC = SONG_PLAY_MS / 1000;

// A fixed decorative waveform for the LCD scrub strip - it stands in for the track's shape,
// the live part is the highlighted selection window drawn over it.
const WAVE = [20, 52, 34, 70, 44, 86, 60, 38, 74, 50, 28, 64, 42, 80, 36, 56];

// A glossy phone-sized window: title bar (with an optional right-hand readout) plus a body.
const Win: React.FC<{
  title: string;
  meter?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}> = ({ title, meter, className, children }) => (
  <div className={className ? `${styles.win} ${className}` : styles.win}>
    <div className={styles.winBar}>
      <div className={styles.winTitle}>{title}</div>
      {meter && <div className={styles.winMeter}>{meter}</div>}
    </div>
    <div className={styles.winBody}>{children}</div>
  </div>
);

// -------------------------------------------------------------------
// Selecting — search, cue a start time, submit
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SelectingScreen extends React.Component<
  { appModel?: PassTheAuxClientModel },
  { query: string }
> {
  private preview = React.createRef<YouTubePlayer>();

  constructor(props: { appModel?: PassTheAuxClientModel }) {
    super(props);
    this.state = { query: "" };
  }
  componentDidMount() {
    // Populate something to browse right away (mock catalog; YouTube stays empty until typed).
    if (this.props.appModel!.searchResults.length === 0) this.props.appModel!.doSearch("");
  }
  private search = () => this.props.appModel!.doSearch(this.state.query);

  // Scrubbing the start time plays a short preview from that offset so the player can hear
  // exactly where their snippet begins (real YouTube tracks only; mock catalog is silent).
  private onScrub = (v: number) => {
    const m = this.props.appModel!;
    m.setStartSec(v);
    const sel = m.selectedTrack;
    if (sel && isRealVideoId(sel.videoId)) {
      this.preview.current?.playPreview(m.pendingStartSec, CLIENT_PREVIEW_MS);
    }
  };
  private lockIn = () => {
    this.preview.current?.stop(); // stop the preview when the choice is locked in
    this.props.appModel!.submitSelected();
  };
  private back = () => {
    this.preview.current?.stop();
    this.props.appModel!.clearSelection();
  };

  render() {
    const m = this.props.appModel!;
    const sel = m.selectedTrack;
    const dur = sel?.durationSec ?? 0;
    const maxStart = dur > SNIPPET_SEC ? dur - SNIPPET_SEC : 300; // unknown duration -> up to 5:00
    // The green selection window on the waveform: how much of the track the 30s snippet covers,
    // slid along by the chosen start point.
    const winPct = dur > 0 ? Math.min(60, (SNIPPET_SEC / dur) * 100) : 20;
    const leftPct =
      maxStart > 0 ? (Math.min(m.pendingStartSec, maxStart) / maxStart) * (100 - winPct) : 0;

    return (
      <div>
        <div className={styles.pillRow}>
          <span className={styles.pillBlue}>
            {m.providerKind === "mock" ? "DEMO CATALOG" : "YOUTUBE"}
          </span>
          <span className={styles.pill}>YOUR TURN</span>
        </div>
        <div className={styles.prompt}>{m.prompt}</div>
        <div className={styles.providerTag}>
          {m.providerKind === "mock"
            ? "Demo catalog (real YouTube search in production)"
            : "Searching YouTube"}
        </div>

        {m.mySubmission && !sel && (
          <div className={styles.submittedCard}>
            {m.mySubmission.thumbnailUrl ? (
              <img className={styles.rthumb} src={m.mySubmission.thumbnailUrl} alt="" />
            ) : (
              <div className={styles.rthumb}>🎵</div>
            )}
            <div className={styles.rinfo}>
              <div className={styles.cueLabel}>Your pick (you can still change it):</div>
              <div className={styles.rtitle}>{m.mySubmission.title}</div>
              <div className={styles.rartist}>
                {m.mySubmission.artist} · starts {fmt(m.mySubmission.startSec)}
              </div>
            </div>
            <div className={styles.tick}>✓</div>
          </div>
        )}

        {sel ? (
          <div className={styles.cueCard}>
            <Win title="start at…" meter={fmt(m.pendingStartSec)}>
              <div className={styles.rtitle}>{sel.title}</div>
              <div className={styles.rartist}>{sel.artist}</div>

              <div className={styles.wave}>
                <div className={styles.waveBars}>
                  {WAVE.map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div
                  className={styles.waveWindow}
                  style={{ left: `${leftPct}%`, width: `${winPct}%` }}
                />
              </div>
              <div className={styles.waveScale}>
                <span>0:00</span>
                <b>{SNIPPET_SEC}s SNIPPET</b>
                <span>{dur > 0 ? fmt(dur) : "—"}</span>
              </div>

              <div className={styles.cueLabel}>
                Start playing at <span className={styles.startVal}>{fmt(m.pendingStartSec)}</span>
              </div>
              <input
                className={styles.range}
                type="range"
                min={0}
                max={maxStart}
                value={Math.min(m.pendingStartSec, maxStart)}
                onChange={(e) => this.onScrub(Number(e.target.value))}
              />
              <div className={styles.cueHint}>
                {isRealVideoId(sel.videoId)
                  ? "Drag to preview 5s from your start point."
                  : "Preview available for real songs in production."}
              </div>
              {isRealVideoId(sel.videoId) && (
                <YouTubePlayer
                  key={sel.videoId}
                  ref={this.preview}
                  videoId={sel.videoId}
                  startSec={m.pendingStartSec}
                  hidden
                />
              )}
              <button
                className={`${styles.btn} ${styles.btnGo} ${styles.btnFull}`}
                onClick={this.lockIn}
              >
                PLUG IT IN
              </button>
              <button className={`${styles.btn} ${styles.btnFull}`} onClick={this.back}>
                ← Back to results
              </button>
            </Win>
          </div>
        ) : (
          <>
            <div className={styles.searchRow}>
              <input
                className={styles.searchInput}
                placeholder="Search for a song…"
                value={this.state.query}
                onChange={(e) => this.setState({ query: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && this.search()}
              />
              <button
                className={`${styles.btn} ${styles.btnGo}`}
                disabled={m.searching}
                onClick={this.search}
              >
                {m.searching ? "…" : "GO"}
              </button>
            </div>
            {m.searchError && <div className={styles.hint}>{m.searchError}</div>}
            <div className={styles.sectionLabel}>RESULTS · {m.searchResults.length}</div>
            <div className={styles.results}>
              {m.searchResults.map((t: Track) => {
                const picked = m.mySubmission?.videoId === t.videoId;
                return (
                  <div
                    className={picked ? `${styles.result} ${styles.picked}` : styles.result}
                    key={t.videoId}
                    onClick={() => m.selectTrack(t)}
                  >
                    {t.thumbnailUrl ? (
                      <img className={styles.rthumb} src={t.thumbnailUrl} alt="" />
                    ) : (
                      <div className={styles.rthumb}>🎵</div>
                    )}
                    <div className={styles.rinfo}>
                      <div className={styles.rtitle}>{t.title}</div>
                      <div className={styles.rartist}>
                        {t.artist}
                        {t.durationSec ? ` · ${fmt(t.durationSec)}` : ""}
                      </div>
                    </div>
                    {picked && <div className={styles.tick}>✓</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Voting — rank your top 3 (your own song is not rankable)
// -------------------------------------------------------------------
const RANK_CLASS = [styles.on, styles.on2, styles.on3];

@inject("appModel")
@observer
class VotingScreen extends React.Component<{ appModel?: PassTheAuxClientModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <div className={styles.pillRow}>
          <span className={styles.pill}>RANK YOUR TOP {MAX_BALLOT}</span>
          {m.voteSubmitted && <span className={styles.pillGreen}>● BALLOT IN</span>}
        </div>
        <div className={styles.prompt}>Which one fits?</div>
        <div className={styles.hint}>
          {m.voteSubmitted
            ? "Vote submitted! Tap below if you want to change it."
            : "tap to rank — no voting for yourself!"}
        </div>
        <div className={m.voteSubmitted ? `${styles.voteList} ${styles.locked}` : styles.voteList}>
          {m.votingSongs.map((s) => {
            const own = s.videoId === m.myOwnVideoId;
            const rank = m.rankOf(s.videoId);
            const cls = [styles.voteItem];
            if (own) cls.push(styles.own);
            if (rank > 0) cls.push(styles.ranked);
            const badge = [styles.rankBadge];
            if (rank > 0) badge.push(RANK_CLASS[Math.min(rank, RANK_CLASS.length) - 1]);
            return (
              <div
                className={cls.join(" ")}
                key={s.videoId}
                onClick={() => !own && m.toggleRank(s.videoId)}
              >
                <div className={badge.join(" ")}>{own ? "✕" : rank > 0 ? rank : ""}</div>
                {s.thumbnailUrl ? (
                  <img className={styles.rthumb} src={s.thumbnailUrl} alt="" />
                ) : (
                  <div className={styles.rthumb}>🎵</div>
                )}
                <div className={styles.rinfo}>
                  <div className={styles.rtitle}>{s.title}</div>
                  <div className={styles.rartist}>{s.artist}</div>
                </div>
                {own && <div className={styles.ownTag}>your song</div>}
              </div>
            );
          })}
        </div>
        <div className={styles.ballotStatus}>
          <span>
            BALLOT {m.myBallot.length} / {MAX_BALLOT} PLACED
          </span>
          <span>EDITABLE UNTIL VOTING CLOSES</span>
        </div>
        {m.voteSubmitted ? (
          <button
            className={`${styles.btn} ${styles.btnFull} ${styles.btnSubmitted}`}
            onClick={() => m.undoVote()}
          >
            Change your vote?
          </button>
        ) : (
          <button
            className={`${styles.btn} ${styles.btnGo} ${styles.btnFull}`}
            disabled={m.myBallot.length < 1}
            onClick={() => m.submitBallot()}
          >
            SUBMIT YOUR VOTES
          </button>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Watching — the phone is out of the loop; show what you cued and point at the big screen
// -------------------------------------------------------------------
@inject("appModel")
@observer
class WatchingScreen extends React.Component<{ appModel?: PassTheAuxClientModel }> {
  render() {
    const m = this.props.appModel!;
    const sub = m.mySubmission;
    return (
      <div>
        <div className={styles.pillRow}>
          <span className={styles.pillBlue}>LOOK UP 🔊</span>
          {sub && <span className={styles.pillGreen}>● CUED</span>}
        </div>
        <div className={styles.watch}>
          <div className={styles.watchTitle}>
            {sub ? "You're plugged in" : "Look up at the big screen"}
          </div>
          <div className={styles.plugDisc} />
          <div className={styles.plugCable} />
        </div>
        {sub && (
          <div className={styles.submittedCard} style={{ marginTop: 60 }}>
            {sub.thumbnailUrl ? (
              <img className={styles.rthumb} src={sub.thumbnailUrl} alt="" />
            ) : (
              <div className={styles.rthumb}>🎵</div>
            )}
            <div className={styles.rinfo}>
              <div className={styles.rtitle}>{sub.title}</div>
              <div className={styles.rartist}>{sub.artist}</div>
              <div className={styles.startVal}>
                STARTS {fmt(sub.startSec)} · {SNIPPET_SEC}s
              </div>
            </div>
          </div>
        )}
        <div className={styles.watchNote}>no skips. no takebacks.</div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Client shell
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: PassTheAuxClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;

  private alertUser() {
    const m = this.props.appModel!;
    if (m.gameState !== this.lastState) SafeBrowser.vibrate([50, 50, 50]);
    this.lastState = m.gameState as string;
  }

  private renderSubScreen() {
    const m = this.props.appModel!;
    switch (m.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return <div className={styles.wait_text}>Sit tight — waiting for the host to start…</div>;
      case PassTheAuxClientState.Selecting:
        this.alertUser();
        return <SelectingScreen />;
      case PassTheAuxClientState.Voting:
        this.alertUser();
        return <VotingScreen />;
      case PassTheAuxClientState.Watching:
        this.alertUser();
        return <WatchingScreen />;
      case GeneralGameState.GameOver:
        return (
          <div>
            <div className={styles.wait_text}>That's a wrap! 🎉</div>
            <button className={`${styles.btn} ${styles.btnFull}`} onClick={() => m.quitApp()}>
              Quit
            </button>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <div className={styles.wait_text}>Could not join: {m.joinError}</div>;
      default:
        return <div className={styles.wait_text}>Loading…</div>;
    }
  }

  render() {
    const m = this.props.appModel;
    return (
      <UINormalizer uiProperties={this.props.uiProperties} virtualHeight={1920} virtualWidth={1080}>
        <div className={styles.gameclient}>
          <div className={styles.noise} />
          <div className={styles.sparkles} />
          <ClientHeader
            className={styles.header}
            title="PASS THE AUX"
            history={PASS_THE_AUX_VERSION_HISTORY}
            avatarId={m?.avatarId ?? 0}
            avatarColor={m?.avatarColor}
            playerName={m?.playerName}
            onQuit={() => m?.quitApp()}
          />
          <div className={styles.body}>
            <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          </div>
        </div>
      </UINormalizer>
    );
  }
}
