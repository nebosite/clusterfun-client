// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import {
  MediaHelper,
  UIProperties,
  PresenterGameState,
  GeneralGameState,
  UINormalizer,
} from "libs";
import PartyPixAssets from "../assets/Assets";
import { PartyPixVersion } from "../models/GameSettings";
import {
  PartyPixPresenterModel,
  PartyPixGameState,
  PartyPixGameEvent,
  PartyPixPlayer,
} from "../models/PresenterModel";

const Wordmark: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`${styles.wordmark} ${className ?? ""}`}>
    PARTY<span className={styles.pix}>PIX</span>
  </span>
);

// -------------------------------------------------------------------
// Gathering / Join screen
// -------------------------------------------------------------------
@inject("appModel")
@observer
class JoinPage extends React.Component<{ appModel?: PartyPixPresenterModel }> {
  private renderFolder(appModel: PartyPixPresenterModel) {
    switch (appModel.folderStatus) {
      case "connected":
        return (
          <span className={styles.folderConnected}>
            💾 Saving photos to <b>{appModel.folderName}</b>
          </span>
        );
      case "needsReconnect":
        return (
          <button className={styles.folderButton} onClick={() => appModel.reconnectFolder()}>
            Reconnect photo folder{appModel.folderName ? ` · ${appModel.folderName}` : ""}
          </button>
        );
      case "unsupported":
        return (
          <span className={styles.folderNote}>
            Photo saving needs Chrome or Edge — photos are kept for this session only.
          </span>
        );
      case "none":
      default:
        return (
          <>
            <button className={styles.folderButton} onClick={() => appModel.chooseFolder()}>
              Choose a photo folder
            </button>
            <label className={styles.folderCheck}>
              <input
                type="checkbox"
                checked={appModel.includeExistingChoice}
                onChange={(e) => appModel.setIncludeExistingChoice(e.target.checked)}
              />
              Include photos already in the folder
            </label>
            <span className={styles.folderNote}>
              Saves photos so the slideshow survives a refresh. Optional.
            </span>
          </>
        );
    }
  }

  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div className={styles.join}>
        <Wordmark className={styles.joinWordmark} />
        <div className={styles.joinTagline}>Snap the party. Vote the best.</div>

        <div className={styles.joinCard}>
          <div className={styles.joinCol}>
            <span className={styles.joinLabel}>Join at</span>
            <span className={styles.joinUrl}>{window.location.host}</span>
          </div>
          <div className={styles.joinDivider} />
          <div className={styles.joinCol}>
            <span className={styles.joinLabel}>Room code</span>
            <span className={styles.joinCode}>{appModel.roomId}</span>
          </div>
        </div>

        <div className={styles.joinHint}>
          Everyone starts with <b>3 photo credits</b>. The slideshow begins with the first photo.
        </div>

        <div className={styles.folderCard}>{this.renderFolder(appModel)}</div>

        <div className={styles.playerStrip}>
          <span className={styles.playerCount}>{appModel.players.length} players in</span>
          {appModel.players.length > 0 ? (
            <div className={styles.playerChips}>
              {appModel.players.map((p) => (
                <span className={styles.chip} key={p.playerId}>
                  {p.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Slideshow
// -------------------------------------------------------------------
@inject("appModel")
@observer
class SlideshowPage extends React.Component<
  { appModel?: PartyPixPresenterModel; media: MediaHelper },
  { banner: string | null; toast: string | null }
> {
  private _bannerTimer: any;
  private _toastTimer: any;

  constructor(props: { appModel?: PartyPixPresenterModel; media: MediaHelper }) {
    super(props);
    this.state = { banner: null, toast: null };

    const { appModel } = props;
    appModel?.subscribe(
      PartyPixGameEvent.PhotoUploaded,
      "presenterNewPhoto",
      (p: PartyPixPlayer) => {
        props.media.playSound(PartyPixAssets.sounds.ding, { volume: 0.6 });
        this.flashBanner(`NEW PHOTO by ${p.name}`);
      },
    );
    appModel?.subscribe(
      PartyPixGameEvent.CreditGranted,
      "presenterCreditGranted",
      (p: PartyPixPlayer) => {
        this.flashToast(`${p.name} earned a credit!`);
      },
    );
  }

  componentWillUnmount() {
    clearTimeout(this._bannerTimer);
    clearTimeout(this._toastTimer);
  }

  flashBanner(text: string) {
    this.setState({ banner: text });
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.setState({ banner: null }), 2600);
  }

  flashToast(text: string) {
    this.setState({ toast: text });
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.setState({ toast: null }), 2600);
  }

  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const photo = appModel.currentPhoto;

    return (
      <div className={styles.show}>
        <Wordmark className={styles.showWordmark} />
        <div className={styles.showTopRight}>
          Join at {window.location.host} · <b>{appModel.roomId}</b>
        </div>
        {appModel.folderStatus === "needsReconnect" ? (
          <button className={styles.reconnectChip} onClick={() => appModel.reconnectFolder()}>
            ⚠ Reconnect photo folder to keep saving
          </button>
        ) : null}

        {this.state.banner ? <div className={styles.banner}>{this.state.banner}</div> : null}
        {this.state.toast ? <div className={styles.toast}>🎉 {this.state.toast}</div> : null}

        {photo ? (
          <>
            <div className={styles.stage}>
              <img className={styles.stagePhoto} src={photo.full} alt="party" />
            </div>
            <div className={styles.photoBar}>
              <div className={styles.author}>
                <span className={styles.authorDot} />
                📸 {photo.authorName}
              </div>
              <div className={styles.barSpacer} />
              <span className={`${styles.tally} ${styles.tallyUp}`}>
                <span className={styles.tallyIcon}>▲</span>
                {photo.up}
              </span>
              <span className={`${styles.tally} ${styles.tallyDown}`}>
                <span className={styles.tallyIcon}>▼</span>
                {photo.down}
              </span>
              <span className={styles.photoCounter}>
                {appModel.photos.indexOf(photo) + 1} / {appModel.photos.length}
              </span>
            </div>
          </>
        ) : (
          <div className={styles.emptyShow}>
            <div>Waiting for the first photo…</div>
            <div style={{ fontSize: 26 }}>
              Join at {window.location.host} · code {appModel.roomId}
            </div>
          </div>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Presenter root
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Presenter extends React.Component<{
  appModel?: PartyPixPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  constructor(props: Readonly<{ appModel?: PartyPixPresenterModel; uiProperties: UIProperties }>) {
    super(props);
    const { appModel } = this.props;
    this.media = new MediaHelper();
    for (const soundName in PartyPixAssets.sounds) {
      this.media.loadSound((PartyPixAssets.sounds as any)[soundName]);
    }
    appModel?.subscribe("PlayerJoined", "partyPixJoinSound", () =>
      this.media.playSound(PartyPixAssets.sounds.hello, { volume: 0.25 }),
    );
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <JoinPage />;
      case PartyPixGameState.Slideshow:
        return <SlideshowPage media={this.media} />;
      case GeneralGameState.Paused:
        return (
          <div className={styles.centerMsg}>
            <h2>Paused</h2>
            <p>Waiting for players to rejoin…</p>
          </div>
        );
      case GeneralGameState.GameOver:
        return (
          <div className={styles.centerMsg}>
            <h2>That's a wrap!</h2>
            <p>Thanks for shooting the party.</p>
          </div>
        );
      default:
        return <div className={styles.centerMsg}>Unhandled state: {appModel.gameState}</div>;
    }
  }

  private renderFrame() {
    const { appModel } = this.props;
    if (!appModel) return null;
    return (
      <div className={styles.frame}>
        <button className={styles.hostButton} onClick={() => appModel.quitApp()}>
          Quit
        </button>
        <button
          className={styles.hostButton}
          disabled={appModel.gameState === PresenterGameState.Gathering}
          onClick={() => appModel.pauseGame()}
        >
          Pause
        </button>
        <div className={styles.frameSpacer} />
        <div className={styles.frameRoom}>
          Room <b>{appModel.roomId}</b>
        </div>
        <div className={styles.frameVersion}>v{PartyPixVersion}</div>
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
        <div className={styles.glowCyan} />
        <div className={styles.glowMagenta} />
        {this.renderFrame()}
        <div className={styles.content}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
