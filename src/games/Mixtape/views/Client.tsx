// The player's phone view.  One sub-screen per client game state, chosen by renderSubScreen().
// Thin: it searches (directly against the MusicProvider), cues a song, and ranks the songs;
// the presenter owns the real game.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Client.module.css";
import {
  UIProperties,
  GeneralGameState,
  GeneralClientGameState,
  SafeBrowser,
  ScaleToWidth,
  ErrorBoundary,
  PlayerAvatar,
} from "libs";
import { MixtapeClientModel, MixtapeClientState } from "../models/ClientModel";
import { MAX_BALLOT, CLIENT_PREVIEW_MS } from "../models/GameSettings";
import { Track, isRealVideoId } from "../models/musicProvider";
import { YouTubePlayer } from "./YouTubePlayer";

const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// -------------------------------------------------------------------
// Selecting — search, cue a start time, submit
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SelectingScreen extends React.Component<
  { appModel?: MixtapeClientModel },
  { query: string }
> {
  private preview = React.createRef<YouTubePlayer>();

  constructor(props: { appModel?: MixtapeClientModel }) {
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
    const maxStart = dur > 30 ? dur - 30 : 300; // unknown duration -> allow up to 5:00
    return (
      <div>
        <div className={styles.prompt}>{m.prompt}</div>
        <div className={styles.providerTag}>
          {m.providerKind === "mock"
            ? "Demo catalog (real YouTube search in production)"
            : "Searching YouTube"}
        </div>

        {m.mySubmission && !sel && (
          <div className={styles.submittedCard}>
            <div className={styles.cueLabel}>Your pick (you can still change it):</div>
            <div className={styles.rtitle}>{m.mySubmission.title}</div>
            <div className={styles.rartist}>
              {m.mySubmission.artist} · starts {fmt(m.mySubmission.startSec)}
            </div>
          </div>
        )}

        {sel ? (
          <div className={styles.cueCard}>
            <div className={styles.rtitle}>{sel.title}</div>
            <div className={styles.rartist}>{sel.artist}</div>
            <div className={styles.cueLabel} style={{ marginTop: 24 }}>
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
              Lock in this song
            </button>
            <button className={`${styles.btn} ${styles.btnFull}`} onClick={this.back}>
              ← Back to results
            </button>
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
                {m.searching ? "…" : "Search"}
              </button>
            </div>
            {m.searchError && <div className={styles.hint}>{m.searchError}</div>}
            <div className={styles.results}>
              {m.searchResults.map((t: Track) => (
                <div className={styles.result} key={t.videoId} onClick={() => m.selectTrack(t)}>
                  {t.thumbnailUrl ? (
                    <img className={styles.rthumb} src={t.thumbnailUrl} alt="" />
                  ) : (
                    <div className={styles.rthumb}>🎵</div>
                  )}
                  <div className={styles.rinfo}>
                    <div className={styles.rtitle}>{t.title}</div>
                    <div className={styles.rartist}>{t.artist}</div>
                  </div>
                </div>
              ))}
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
@inject("appModel")
@observer
class VotingScreen extends React.Component<{ appModel?: MixtapeClientModel }> {
  render() {
    const m = this.props.appModel!;
    return (
      <div>
        <div className={styles.prompt}>Rank your favorites</div>
        <div className={styles.hint}>
          {m.voteSubmitted
            ? "Vote submitted! Tap below if you want to change it."
            : `Tap up to ${MAX_BALLOT} in order — ${m.myBallot.length}/${MAX_BALLOT} picked.`}
        </div>
        <div className={m.voteSubmitted ? `${styles.voteList} ${styles.locked}` : styles.voteList}>
          {m.votingSongs.map((s) => {
            const own = s.videoId === m.myOwnVideoId;
            const rank = m.rankOf(s.videoId);
            const cls = [styles.voteItem];
            if (own) cls.push(styles.own);
            if (rank > 0) cls.push(styles.ranked);
            return (
              <div
                className={cls.join(" ")}
                key={s.videoId}
                onClick={() => !own && m.toggleRank(s.videoId)}
              >
                <div className={rank > 0 ? `${styles.rankBadge} ${styles.on}` : styles.rankBadge}>
                  {rank > 0 ? rank : ""}
                </div>
                <div className={styles.rinfo}>
                  <div className={styles.rtitle}>{s.title}</div>
                  <div className={styles.rartist}>{s.artist}</div>
                </div>
                {own && <div className={styles.ownTag}>your song</div>}
              </div>
            );
          })}
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
            Submit ranking
          </button>
        )}
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
  appModel?: MixtapeClientModel;
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
      case MixtapeClientState.Selecting:
        this.alertUser();
        return <SelectingScreen />;
      case MixtapeClientState.Voting:
        this.alertUser();
        return <VotingScreen />;
      case MixtapeClientState.Watching:
        this.alertUser();
        return <div className={styles.watch}>Look up at the big screen 🔊</div>;
      case GeneralGameState.GameOver:
        return (
          <div className={styles.watch}>
            That's a wrap! 🎉
            <div>
              <button className={`${styles.btn} ${styles.btnFull}`} onClick={() => m.quitApp()}>
                Quit
              </button>
            </div>
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
      <ScaleToWidth
        virtualWidth={1080}
        virtualHeight={1920}
        containerWidth={this.props.uiProperties.containerWidth}
        containerHeight={this.props.uiProperties.containerHeight}
        hoverScrollbar
        fillHeight
      >
        <div className={styles.gameclient}>
          <div className={styles.topbar}>
            <span className={styles.gametitle}>MIXTAPE</span>
            <span className={styles.me}>
              <PlayerAvatar avatarId={m?.avatarId ?? 0} size={44} /> {m?.playerName}
            </span>
            <button className={styles.quitbutton} onClick={() => m?.quitApp()}>
              ✕
            </button>
          </div>
          <div className={styles.body}>
            <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          </div>
        </div>
      </ScaleToWidth>
    );
  }
}
