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
  ClientHeader,
} from "libs";
import { PartyPixClientModel, PartyPixClientState } from "../models/ClientModel";
import { fileToUploadPair } from "./imageUtil";
import {
  MAX_IMAGE_EDGE,
  THUMB_IMAGE_EDGE,
  TARGET_IMAGE_BYTES,
  JPEG_QUALITY_START,
  JPEG_QUALITY_MIN,
  JPEG_QUALITY_STEP,
  THUMB_JPEG_QUALITY,
  UPLOAD_COST,
  PARTY_PIX_VERSION_HISTORY,
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
  private _cameraInput = React.createRef<HTMLInputElement>();
  private _albumInput = React.createRef<HTMLInputElement>();
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

  private openCamera = () => this._cameraInput.current?.click();
  private openAlbum = () => this._albumInput.current?.click();

  private onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    this.setState({ busy: true });
    try {
      const pair = await fileToUploadPair(file, {
        fullEdge: MAX_IMAGE_EDGE,
        thumbEdge: THUMB_IMAGE_EDGE,
        targetBytes: TARGET_IMAGE_BYTES,
        startQuality: JPEG_QUALITY_START,
        minQuality: JPEG_QUALITY_MIN,
        qualityStep: JPEG_QUALITY_STEP,
        thumbQuality: THUMB_JPEG_QUALITY,
      });
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
    this.openCamera();
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
        {canAfford ? (
          <>
            {/* Side by side, and both offered on every device. A phone that can only reach
                the camera cannot post the picture it already took. */}
            <div className={styles.captureButtons}>
              <button className={styles.takePhoto} onClick={this.openCamera} disabled={busy}>
                <span className={styles.cameraGlyph}>📸</span>
                {busy ? "Processing…" : "TAKE A PHOTO"}
              </button>
              <button className={styles.uploadPhoto} onClick={this.openAlbum} disabled={busy}>
                <span className={styles.cameraGlyph}>🖼️</span>
                {busy ? "Processing…" : "UPLOAD A PHOTO"}
              </button>
            </div>
            <div className={styles.costNote}>Costs 1 credit to upload.</div>
          </>
        ) : (
          <div className={styles.outOfCredits}>
            OUT OF CREDITS
            <div className={styles.sub}>
              {appModel.untilNextCredit > 0
                ? `Earn one when your photos get ${appModel.untilNextCredit} more upvote${
                    appModel.untilNextCredit === 1 ? "" : "s"
                  }.`
                : "You've earned all your credit rewards."}
            </div>
          </div>
        )}

        {/* TWO inputs, because `capture` is not a toggle you can flip at click time - the
            attribute has to be on the element when it is activated.

            One input with capture="environment" is what shipped, and it forces the camera on a
            phone with no way to reach the album. On a desktop the attribute is ignored and it
            behaves as a file picker, which is why this looked fine in the Test Lobby. */}
        <input
          ref={this._cameraInput}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={this.onFileChange}
        />
        <input
          ref={this._albumInput}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
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
          {/* Upper right, on the photo, and red - it is the one destructive control here.
              It only STAGES the flag; the list at the bottom is where it is confirmed. */}
          <button
            className={classNames(styles.flagCorner, {
              [styles.flagCornerOn]: appModel.hasStagedOrFlaggedCurrent,
            })}
            onClick={() => appModel.stageFlag()}
            aria-label="Flag this photo"
            title="Flag this photo"
          >
            ⚑
          </button>
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
        {/* Credits stay visible on every tab, including while voting. */}
        <div className={styles.creditStrip}>
          <span className={styles.creditCount}>
            🎞️ {appModel.credits} {appModel.credits === 1 ? "credit" : "credits"}
          </span>
          <span className={styles.creditNext}>
            {appModel.untilNextCredit > 0
              ? `next credit in ${appModel.untilNextCredit} upvote${
                  appModel.untilNextCredit === 1 ? "" : "s"
                }`
              : "all credit rewards earned"}
          </span>
        </div>
        {/* ONE screen, not two tabs: taking part on top, what is on the big screen below.
            Split across tabs, whichever one you were looking at hid the other - a player on
            Capture never saw the photo they were meant to be voting on, and a player on Vote
            had to go looking for the shutter. */}
        <div className={styles.body}>
          <div className={styles.captureSection}>{this.renderCapture()}</div>
          <div className={styles.voteSection}>{this.renderVote()}</div>
          {this.renderPendingFlags()}
        </div>
        {this.renderNotice()}
      </>
    );
  }

  // -------------------------------------------------------------------
  // Flags waiting to be confirmed.
  //
  // Nothing here has been sent yet. A flag pulls a photo out of rotation for the whole room on
  // the first one, which is too much to hang off a single tap next to the vote buttons.
  // -------------------------------------------------------------------
  private renderPendingFlags() {
    const { appModel } = this.props;
    if (!appModel || appModel.pendingFlags.length === 0) return null;

    return (
      <div className={styles.pendingFlags}>
        <div className={styles.pendingFlagsTitle}>Flag these photos?</div>
        {appModel.pendingFlags.map((pending) => (
          <div className={styles.pendingFlagRow} key={pending.photoId}>
            <img className={styles.pendingFlagThumb} src={pending.thumb} alt="flagged" />
            <span className={styles.pendingFlagName}>{pending.authorName}</span>
            <button
              className={styles.confirmFlag}
              onClick={() => appModel.confirmFlag(pending.photoId)}
            >
              Yes, Flag
            </button>
            <button
              className={styles.cancelFlag}
              onClick={() => appModel.cancelFlag(pending.photoId)}
            >
              Whoops, No
            </button>
          </div>
        ))}
      </div>
    );
  }

  // -------------------------------------------------------------------
  // A moment worth interrupting for: your photo was flagged, your first upvote landed, or the
  // whole room upvoted one. Each of them explains the credit economy, because "why can I not
  // take another photo" is the question the game otherwise never answers out loud.
  // -------------------------------------------------------------------
  private renderNotice() {
    const { appModel } = this.props;
    if (!appModel?.notice) return null;
    const notice = appModel.notice;

    return (
      <div className={styles.noticeBackdrop} onClick={() => appModel.dismissNotice()}>
        <div className={styles.noticeCard} onClick={(e) => e.stopPropagation()}>
          <div className={styles.noticeGlyph}>
            {notice.kind === "flagged" ? "⚑" : notice.kind === "sweep" ? "🏆" : "▲"}
          </div>
          <div className={styles.noticeText}>{notice.text}</div>
          <button className={styles.noticeDismiss} onClick={() => appModel.dismissNotice()}>
            Got it
          </button>
        </div>
      </div>
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
          <ClientHeader
            className={styles.header}
            title={<Wordmark />}
            history={PARTY_PIX_VERSION_HISTORY}
            avatarId={appModel?.avatarId ?? 0}
            avatarColor={appModel?.avatarColor}
            playerName={appModel?.playerName}
            onQuit={() => appModel?.quitApp()}
          />
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
