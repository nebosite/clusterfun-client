// App Navigation handled here
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
} from "libs";
import { PartyPixClientModel, PartyPixClientState } from "../models/ClientModel";
import { fileToUploadPair } from "./imageUtil";
import {
  MAX_IMAGE_EDGE,
  THUMB_IMAGE_EDGE,
  JPEG_QUALITY,
  UPLOAD_COST,
} from "../models/GameSettings";

const Wordmark: React.FC = () => (
  <span className={styles.wordmark}>
    PARTY<span className={styles.pix}>PIX</span>
  </span>
);

interface ClientState {
  review: { full: string; thumb: string } | null;
  busy: boolean;
  toast: { text: string; error: boolean } | null;
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<
  { appModel?: PartyPixClientModel; uiProperties: UIProperties },
  ClientState
> {
  private _fileInput = React.createRef<HTMLInputElement>();
  private _toastTimer: any;

  constructor(props: { appModel?: PartyPixClientModel; uiProperties: UIProperties }) {
    super(props);
    this.state = { review: null, busy: false, toast: null };
  }

  componentWillUnmount() {
    clearTimeout(this._toastTimer);
  }

  private showToast(text: string, error = false) {
    this.setState({ toast: { text, error } });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setState({ toast: null }), 2600);
  }

  private openPicker = () => this._fileInput.current?.click();

  private onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    this.setState({ busy: true });
    try {
      const pair = await fileToUploadPair(file, MAX_IMAGE_EDGE, THUMB_IMAGE_EDGE, JPEG_QUALITY);
      this.setState({ review: pair, busy: false });
    } catch (err) {
      this.setState({ busy: false });
      this.showToast("Couldn't read that photo.", true);
    }
  };

  private doUpload = async () => {
    const { appModel } = this.props;
    const { review } = this.state;
    if (!appModel || !review) return;
    this.setState({ busy: true });
    const res = await appModel.uploadPhoto(review.full, review.thumb);
    this.setState({ busy: false });
    if (res.success) {
      this.setState({ review: null });
      this.showToast("Sent to the big screen!");
    } else {
      this.showToast(res.error ?? "Upload failed.", true);
    }
  };

  private retake = () => {
    this.setState({ review: null });
    this.openPicker();
  };

  // -------------------------------------------------------------------
  // Capture view
  // -------------------------------------------------------------------
  private renderCapture() {
    const { appModel } = this.props;
    if (!appModel) return null;
    const { review, busy } = this.state;
    const canAfford = appModel.credits >= UPLOAD_COST;

    if (review) {
      return (
        <>
          <img className={styles.reviewImg} src={review.full} alt="your shot" />
          <div className={styles.reviewActions}>
            <button className={styles.retake} onClick={this.retake} disabled={busy}>
              Retake
            </button>
            <button className={styles.upload} onClick={this.doUpload} disabled={busy || !canAfford}>
              {busy ? "Sending…" : "Upload −1 credit"}
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        <div className={styles.credits}>
          🎞️ {appModel.credits} {appModel.credits === 1 ? "CREDIT" : "CREDITS"}
        </div>
        <div className={styles.earnHint}>
          Earn a credit for every 3 upvotes · next in {appModel.untilNextCredit}
        </div>

        {canAfford ? (
          <>
            <button className={styles.takePhoto} onClick={this.openPicker} disabled={busy}>
              <span className={styles.cameraGlyph}>📸</span>
              {busy ? "Processing…" : "TAKE A PHOTO"}
            </button>
            <div className={styles.costNote}>Costs 1 credit to upload.</div>
          </>
        ) : (
          <div className={styles.outOfCredits}>
            OUT OF CREDITS
            <div className={styles.sub}>
              Earn one when your photos get {appModel.untilNextCredit} more upvote
              {appModel.untilNextCredit === 1 ? "" : "s"}.
            </div>
          </div>
        )}

        <input
          ref={this._fileInput}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={this.onFileChange}
        />
      </>
    );
  }

  // -------------------------------------------------------------------
  // Vote view
  // -------------------------------------------------------------------
  private renderVote() {
    const { appModel } = this.props;
    if (!appModel) return null;
    const slide = appModel.currentSlide;

    if (!slide) {
      return (
        <div className={styles.voteEmpty}>
          Waiting for the first photo…
          <br />
          Be the one to take it!
        </div>
      );
    }

    return (
      <>
        <div className={styles.voteLabel}>Now showing</div>
        <div className={styles.voteThumbWrap}>
          <img className={styles.voteThumb} src={slide.thumb} alt="now showing" />
        </div>
        <div className={styles.voteAuthor}>📸 {slide.authorName}</div>

        {slide.youAuthored ? (
          <div className={styles.ownBadge}>
            This one's yours — <span className={styles.up}>▲ {slide.up}</span>
          </div>
        ) : (
          <div className={styles.voteRow}>
            <button
              className={classNames(styles.voteBtn, styles.up, {
                [styles.active]: appModel.myVoteForCurrent === "up",
              })}
              onClick={() => appModel.vote("up")}
            >
              <span className={styles.voteGlyph}>▲</span>
              Up
            </button>
            <button
              className={classNames(styles.voteBtn, styles.down, {
                [styles.active]: appModel.myVoteForCurrent === "down",
              })}
              onClick={() => appModel.vote("down")}
            >
              <span className={styles.voteGlyph}>▼</span>
              Down
            </button>
            <button
              className={classNames(styles.voteBtn, styles.flag, {
                [styles.active]: appModel.hasFlaggedCurrent,
              })}
              onClick={() => appModel.flag()}
            >
              <span className={styles.voteGlyph}>⚑</span>
              Flag
            </button>
          </div>
        )}
      </>
    );
  }

  // -------------------------------------------------------------------
  // Playing (tabs + body)
  // -------------------------------------------------------------------
  private renderPlaying() {
    const { appModel } = this.props;
    if (!appModel) return null;
    return (
      <>
        <div className={styles.tabs}>
          <button
            className={classNames(styles.tab, {
              [styles.tabActive]: appModel.viewMode === "capture",
            })}
            onClick={() => appModel.setViewMode("capture")}
          >
            Capture
          </button>
          <button
            className={classNames(styles.tab, {
              [styles.tabActive]: appModel.viewMode === "vote",
            })}
            onClick={() => appModel.setViewMode("vote")}
          >
            Vote
          </button>
        </div>
        <div className={styles.body}>
          {appModel.viewMode === "capture" ? this.renderCapture() : this.renderVote()}
        </div>
      </>
    );
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    switch (appModel.gameState) {
      case PartyPixClientState.Playing:
        return this.renderPlaying();
      case GeneralClientGameState.WaitingToStart:
        return <div className={styles.wait_text}>Joining the party…</div>;
      case GeneralClientGameState.Paused:
        return <div className={styles.wait_text}>Paused — hang tight.</div>;
      case GeneralGameState.GameOver:
        return (
          <div className={styles.body}>
            <div className={styles.wait_text}>Thanks for playing!</div>
            <button className={styles.primaryButton} onClick={() => appModel.quitApp()}>
              Quit
            </button>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <div className={styles.wait_text}>Couldn't join: {appModel.joinError}</div>;
      default:
        return <div className={styles.wait_text}>Loading…</div>;
    }
  }

  render() {
    const { appModel } = this.props;
    const { toast } = this.state;
    return (
      <UINormalizer uiProperties={this.props.uiProperties} virtualHeight={1920} virtualWidth={1080}>
        <div className={styles.gameclient}>
          <div className={styles.header}>
            <Wordmark />
            <span className={styles.headerName}>{appModel?.playerName}</span>
            <button className={styles.quit} onClick={() => appModel?.quitApp()}>
              ✕
            </button>
          </div>
          <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          {toast ? (
            <div className={classNames(styles.toast, { [styles.toastError]: toast.error })}>
              {toast.text}
            </div>
          ) : null}
        </div>
      </UINormalizer>
    );
  }
}
