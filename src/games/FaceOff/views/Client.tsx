// The player's phone view. Thin: it captures input (camera/file, votes) and shows feedback.
// The presenter owns the game. One sub-screen per client game state.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Client.module.css";
import classNames from "classnames";
import {
  UIProperties,
  GeneralGameState,
  GeneralClientGameState,
  UINormalizer,
  ErrorBoundary,
  PlayerAvatar,
  ClientHeader,
} from "libs";
import { FaceOffClientModel, FaceOffClientState } from "../models/ClientModel";
import { PromptInfo } from "../models/prompts";
import { fileToUploadPair, videoFrameToUploadPair, UploadImageOptions } from "./imageUtil";
import {
  MAX_IMAGE_EDGE,
  THUMB_IMAGE_EDGE,
  TARGET_IMAGE_BYTES,
  JPEG_QUALITY_START,
  JPEG_QUALITY_MIN,
  JPEG_QUALITY_STEP,
  THUMB_JPEG_QUALITY,
  FACE_OFF_VERSION_HISTORY,
} from "../models/GameSettings";

const IMG_OPTS: UploadImageOptions = {
  fullEdge: MAX_IMAGE_EDGE,
  thumbEdge: THUMB_IMAGE_EDGE,
  targetBytes: TARGET_IMAGE_BYTES,
  startQuality: JPEG_QUALITY_START,
  minQuality: JPEG_QUALITY_MIN,
  qualityStep: JPEG_QUALITY_STEP,
  thumbQuality: THUMB_JPEG_QUALITY,
};

const Wordmark: React.FC = () => (
  <span className={styles.wordmark}>
    FACE<span className={styles.off}>OFF</span>
  </span>
);

const PromptView: React.FC<{ prompt: PromptInfo }> = ({ prompt }) => {
  if (prompt.kind === "emoji") {
    return (
      <div className={styles.prompt}>
        <div className={styles.promptEmoji}>{prompt.emoji}</div>
        {prompt.text ? <div className={styles.promptCaption}>{prompt.text}</div> : null}
      </div>
    );
  }
  if (prompt.kind === "image" && prompt.src) {
    return (
      <div className={styles.prompt}>
        <img className={styles.promptImg} src={prompt.src} alt={prompt.text ?? "prompt"} />
      </div>
    );
  }
  return <div className={classNames(styles.prompt, styles.promptText)}>“{prompt.text}”</div>;
};

// -------------------------------------------------------------------
// Capture view — manages the live camera and the snap. On the presenter's SnapNow the model
// bumps snapNonce; this component grabs the current frame and submits. A file picker is always
// available as a fallback (desktop / no camera), submitting immediately on pick.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class CaptureView extends React.Component<
  { appModel?: FaceOffClientModel },
  { cameraError: boolean; busy: boolean }
> {
  private _video = React.createRef<HTMLVideoElement>();
  private _file = React.createRef<HTMLInputElement>();
  private _stream: MediaStream | null = null;
  private _lastNonce = 0;
  private _tick: any;

  constructor(props: { appModel?: FaceOffClientModel }) {
    super(props);
    this.state = { cameraError: false, busy: false };
    this._lastNonce = props.appModel?.snapNonce ?? 0;
  }

  componentDidMount() {
    if (this.props.appModel?.role === "contestant" && !this.props.appModel?.submitted) {
      void this.startCamera();
    }
    // Re-render 4x/sec so the countdown number ticks (Date.now-based, not observable).
    this._tick = setInterval(() => this.forceUpdate(), 250);
  }

  componentDidUpdate() {
    const { appModel } = this.props;
    if (!appModel) return;
    if (appModel.snapNonce !== this._lastNonce) {
      this._lastNonce = appModel.snapNonce;
      void this.captureFromVideo();
    }
    if (appModel.submitted) this.stopCamera();
  }

  componentWillUnmount() {
    this.stopCamera();
    clearInterval(this._tick);
  }

  private async startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      this._stream = stream;
      const v = this._video.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
      }
    } catch (err) {
      this.setState({ cameraError: true });
    }
  }

  private stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
  }

  private async captureFromVideo() {
    const { appModel } = this.props;
    const v = this._video.current;
    if (!appModel || !v || !this._stream) return;
    try {
      const pair = videoFrameToUploadPair(v, IMG_OPTS);
      await appModel.submitPair(pair.full, pair.thumb);
      this.stopCamera();
    } catch (err) {
      // No frame yet — fall back to letting the player pick a file.
      this.setState({ cameraError: true });
    }
  }

  private pickFile = () => this._file.current?.click();

  private onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const { appModel } = this.props;
    if (!file || !appModel) return;
    this.setState({ busy: true });
    try {
      const pair = await fileToUploadPair(file, IMG_OPTS);
      await appModel.submitPair(pair.full, pair.thumb);
      this.stopCamera();
    } catch (err) {
      this.setState({ cameraError: true });
    } finally {
      this.setState({ busy: false });
    }
  };

  render() {
    const { appModel } = this.props;
    if (!appModel) return null;
    // Read snapNonce so the observer re-renders (and componentDidUpdate fires) when it bumps.
    const nonce = appModel.snapNonce;

    if (appModel.role !== "contestant") {
      return (
        <div className={styles.judgeWait} data-nonce={nonce}>
          <div className={styles.bigEmoji}>👀</div>
          Get ready to judge!
          <div className={styles.sub}>The contestants are striking their poses…</div>
        </div>
      );
    }

    if (appModel.submitted) {
      return (
        <div className={styles.judgeWait} data-nonce={nonce}>
          <div className={styles.bigEmoji}>✅</div>
          Shot submitted!
          <div className={styles.sub}>Sit tight while everyone finishes.</div>
        </div>
      );
    }

    const secs = appModel.snapSecondsLeft;
    return (
      <div className={styles.capture} data-nonce={nonce}>
        <div className={styles.captureLabel}>Mimic this:</div>
        {appModel.prompt ? <PromptView prompt={appModel.prompt} /> : null}

        <div className={styles.cameraWrap}>
          {!this.state.cameraError ? (
            <video ref={this._video} className={styles.camera} playsInline muted />
          ) : (
            <div className={styles.cameraFallback}>No camera — pick a photo below 👇</div>
          )}
          {secs > 0 ? <div className={styles.captureCountdown}>{secs}</div> : null}
        </div>

        <button className={styles.fileButton} onClick={this.pickFile} disabled={this.state.busy}>
          {this.state.busy ? "Processing…" : "📁 Pick a photo instead"}
        </button>
        <input
          ref={this._file}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="user"
          onChange={this.onFileChange}
        />
        <div className={styles.captureHint}>Snaps automatically at zero — no retake!</div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Voting view
// -------------------------------------------------------------------
@inject("appModel")
@observer
class VotingView extends React.Component<{ appModel?: FaceOffClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return null;
    if (appModel.votableMatchups.length === 0) {
      return (
        <div className={styles.judgeWait}>
          <div className={styles.bigEmoji}>🎭</div>
          You're in the spotlight this round.
          <div className={styles.sub}>Watch the big screen for the verdict!</div>
        </div>
      );
    }
    return (
      <div className={styles.vote}>
        <div className={styles.voteHead}>Who nailed it? Tap the better mimic.</div>
        {appModel.votableMatchups.map((m) => {
          const myChoice = appModel.myVotes.get(m.matchupId);
          return (
            <div className={styles.voteCard} key={m.matchupId}>
              <PromptView prompt={m.prompt} />
              <div className={styles.voteEntries}>
                {m.entries.map((e) => (
                  <button
                    key={e.entryId}
                    className={classNames(
                      styles.voteEntry,
                      myChoice === e.entryId && styles.chosen,
                    )}
                    onClick={() => appModel.vote(m.matchupId, e.entryId)}
                  >
                    {e.thumb ? (
                      <img className={styles.voteThumb} src={e.thumb} alt="entry" />
                    ) : (
                      <div className={styles.voteNoPhoto}>No photo</div>
                    )}
                    {myChoice === e.entryId ? (
                      <div className={styles.chosenTag}>✓ your pick</div>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Watching (reveal + scoreboard)
// -------------------------------------------------------------------
@inject("appModel")
@observer
class WatchingView extends React.Component<{ appModel?: FaceOffClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return null;
    const top = appModel.standings.slice(0, 5);
    return (
      <div className={styles.judgeWait}>
        <div className={styles.bigEmoji}>📺</div>
        Watch the big screen!
        {top.length > 0 ? (
          <div className={styles.miniStand}>
            {top.map((s, i) => (
              <div className={styles.miniRow} key={s.playerId}>
                <span>{i + 1}</span>
                <PlayerAvatar avatarId={s.avatarId} size={28} />
                <span className={styles.miniName}>{s.name}</span>
                <span>{s.score}</span>
              </div>
            ))}
          </div>
        ) : null}
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
  appModel?: FaceOffClientModel;
  uiProperties: UIProperties;
}> {
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    switch (appModel.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return (
          <div className={styles.judgeWait}>
            <div className={styles.bigEmoji}>🎬</div>
            Waiting for the host to start…
            <div className={styles.sub}>
              {appModel.hasCamera ? "Camera found — you'll be a contestant!" : "You'll be a judge."}
            </div>
          </div>
        );
      case FaceOffClientState.Capturing:
        return <CaptureView />;
      case FaceOffClientState.Voting:
        return <VotingView />;
      case FaceOffClientState.Watching:
        return <WatchingView />;
      case GeneralGameState.GameOver:
        return (
          <div className={styles.judgeWait}>
            <div className={styles.bigEmoji}>🎉</div>
            Thanks for playing!
            <button className={styles.fileButton} onClick={() => appModel.quitApp()}>
              Quit
            </button>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <div className={styles.judgeWait}>Couldn't join: {appModel.joinError}</div>;
      default:
        return <div className={styles.judgeWait}>Loading…</div>;
    }
  }

  render() {
    const { appModel } = this.props;
    return (
      <UINormalizer uiProperties={this.props.uiProperties} virtualHeight={1920} virtualWidth={1080}>
        <div className={styles.gameclient}>
          <ClientHeader
            className={styles.header}
            title={<Wordmark />}
            history={FACE_OFF_VERSION_HISTORY}
            avatarId={appModel?.avatarId ?? 0}
            avatarColor={appModel?.avatarColor}
            playerName={appModel?.playerName}
            onQuit={() => appModel?.quitApp()}
          />
          <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
        </div>
      </UINormalizer>
    );
  }
}
