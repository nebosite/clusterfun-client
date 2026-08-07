// The shared-screen view.  One page component per presenter game state, chosen by
// renderSubScreen().  All of these are observers over the presenter model - they
// render state; they never own it.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import CollageBoardAssets from "../assets/Assets";
import { COLLAGE_BOARD_VERSION_HISTORY } from "../models/GameSettings";
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
import {
  CollageBoardPresenterModel,
  CollageBoardGameState,
  CollageBoardGameEvent,
} from "../models/PresenterModel";
import { ZonePoint } from "../models/collageBoardLogic";

// The collage canvas resolution on the 1920x1080 virtual screen
const CANVAS_W = 1600;
const CANVAS_H = 900;

@inject("appModel")
@observer
class GatheringPlayersPage extends React.Component<{ appModel?: CollageBoardPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    return (
      <div>
        <h3>Welcome to {appModel.name}</h3>
        <p>Fill one big canvas together, one camera shot at a time.</p>
        <p>
          To Join: go to http://{window.location.host} and enter this room code: {appModel.roomId}
        </p>
        {appModel.players.length > 0 ? (
          <div>
            <p style={{ fontWeight: 600 }}>Artists so far:</p>
            <div className={styles.divRow}>
              {appModel.players.map((player) => (
                <div className={styles.nameBox} key={player.playerId}>
                  <PlayerAvatar avatarId={player.avatarId} size={48} />
                  <span className={styles.colorChip} style={{ backgroundColor: player.color }} />
                  {player.name}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {appModel.players.length < appModel.minPlayers ? (
          <div>{`Waiting for at least ${appModel.minPlayers} player to join ...`}</div>
        ) : (
          <button className={styles.presenterButton} onClick={() => appModel.startGame()}>
            Start collaging!
          </button>
        )}
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedGamePage extends React.Component<{ appModel?: CollageBoardPresenterModel }> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <p>{appModel.name} is paused</p>
        <p>Current players in the room:</p>
        <ul>
          {appModel.players.map((player) => (
            <li key={player.playerId}>
              <PlayerAvatar avatarId={player.avatarId} size={32} /> {player.name}
            </li>
          ))}
        </ul>
        <button
          className={styles.button}
          disabled={appModel.players.length < appModel.minPlayers}
          onClick={() => appModel.resumeGame()}
        >
          Resume Game
        </button>
      </div>
    );
  }
}

@inject("appModel")
@observer
class PlayingPage extends React.Component<{ appModel?: CollageBoardPresenterModel }> {
  // Full-resolution decoded patch images, keyed by patchId (view-only cache)
  private _patchImages = new Map<string, HTMLImageElement>();

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: Readonly<{ appModel?: CollageBoardPresenterModel }>) {
    super(props);
    props.appModel!.onTick.subscribe("collage-presenter-draw", () => this.drawCollage());
  }

  componentWillUnmount() {
    this.props.appModel?.onTick.unsubscribe("collage-presenter-draw");
  }

  // -------------------------------------------------------------------
  // drawCollage - repaint the shared canvas: patches in commit order
  // (clipped to their outlines), then every active claim's outline in
  // its owner's color.
  // -------------------------------------------------------------------
  private drawCollage() {
    const canvas = document.getElementById("collagePresenterCanvas") as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    const appModel = this.props.appModel;
    if (!canvas || !ctx || !appModel) return;

    ctx.fillStyle = "#14181d";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const toCanvas = (p: ZonePoint) => ({ x: p.x * CANVAS_W, y: p.y * CANVAS_H });

    for (const patch of appModel.patches) {
      let img = this._patchImages.get(patch.patchId);
      if (!img) {
        img = new Image();
        img.src = patch.image;
        this._patchImages.set(patch.patchId, img);
      }
      if (!img.complete || img.naturalWidth === 0) continue;
      ctx.save();
      ctx.beginPath();
      patch.points.forEach((p, i) => {
        const c = toCanvas(p);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        img,
        patch.bounds.x * CANVAS_W,
        patch.bounds.y * CANVAS_H,
        patch.bounds.width * CANVAS_W,
        patch.bounds.height * CANVAS_H,
      );
      ctx.restore();
    }

    if (appModel.patches.length === 0) {
      ctx.fillStyle = "#3a4048";
      ctx.font = "44px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "A blank canvas awaits - draw a zone on your phone!",
        CANVAS_W / 2,
        CANVAS_H / 2,
      );
      ctx.textAlign = "start";
    }

    // Active claims: outline + owner name in the owner's color
    for (const zone of appModel.zoneInfos()) {
      if (zone.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = zone.color;
      ctx.lineWidth = 5;
      ctx.setLineDash([14, 10]);
      ctx.beginPath();
      zone.points.forEach((p, i) => {
        const c = toCanvas(p);
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      const anchor = toCanvas(zone.points[0]);
      ctx.font = "600 30px sans-serif";
      const label = ` ${zone.playerName} `;
      const w = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10, 12, 16, 0.75)";
      ctx.fillRect(anchor.x, Math.max(0, anchor.y - 38), w, 38);
      ctx.fillStyle = zone.color;
      ctx.fillText(label, anchor.x, Math.max(30, anchor.y - 8));
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <div className={styles.playRow}>
          <div className={styles.gameCanvasFrame}>
            <canvas
              className={styles.gameCanvas}
              width={CANVAS_W}
              height={CANVAS_H}
              id="collagePresenterCanvas"
            />
          </div>
          <div className={styles.playerStrip}>
            {appModel.players.map((p) => (
              <div className={styles.playerItem} key={p.playerId}>
                <PlayerAvatar avatarId={p.avatarId} size={44} />
                <span className={styles.colorChip} style={{ backgroundColor: p.color }} />
                <span>
                  {p.name} ({p.photosTaken})
                </span>
              </div>
            ))}
            <div className={styles.joinHint}>
              Join at {window.location.host}
              <br />
              Code: <b>{appModel.roomId}</b>
            </div>
          </div>
        </div>
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
  appModel?: CollageBoardPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(
    props: Readonly<{ appModel?: CollageBoardPresenterModel; uiProperties: UIProperties }>,
  ) {
    super(props);

    const { appModel } = this.props;

    // Set up sound effects
    this.media = new MediaHelper();
    for (let soundName in CollageBoardAssets.sounds) {
      this.media.loadSound((CollageBoardAssets.sounds as any)[soundName]);
    }

    const sfxVolume = 1.0;

    // Game events -> sounds.  Subscribe to model events here so audio
    // stays in the view layer, out of the game logic.
    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "play joined sound", () =>
      this.media.playSound(CollageBoardAssets.sounds.hello, { volume: sfxVolume * 0.2 }),
    );
    appModel?.subscribe(CollageBoardGameEvent.ZoneClaimed, "play claim sound", () =>
      this.media.playSound(CollageBoardAssets.sounds.ding, { volume: sfxVolume * 0.4 }),
    );
    appModel?.subscribe(CollageBoardGameEvent.PhotoCommitted, "play commit sound", () =>
      this.media.playSound(CollageBoardAssets.sounds.score, { volume: sfxVolume * 0.6 }),
    );
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) {
      return <div>NO APP MODEL</div>;
    }

    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPlayersPage />;
      case CollageBoardGameState.Playing:
        return <PlayingPage />;
      case GeneralGameState.Paused:
        return <PausedGamePage />;
      case GeneralGameState.GameOver:
        return (
          <div>
            <p>The collage is finished - thanks for playing!</p>
            <button onClick={() => this.props.appModel!.startGame()}>Start a fresh canvas</button>
          </div>
        );
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
        <button
          className={classNames(styles.button)}
          style={{ marginRight: "30px" }}
          onClick={() => appModel.quitApp()}
        >
          Quit
        </button>
        <button
          className={classNames(styles.button)}
          disabled={appModel.gameState === PresenterGameState.Gathering}
          style={{ marginRight: "30px" }}
          onClick={() => appModel.pauseGame()}
        >
          Pause
        </button>
        <div className={classNames(styles.roomCode)}>Room Code: {appModel.roomId}</div>
        <DevUI context={appModel} children={<div></div>} />
        <div style={{ marginLeft: "50px" }}>
          <GameVersionTag
            title="CollageBoard"
            history={COLLAGE_BOARD_VERSION_HISTORY}
            showChanges
          />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    return (
      <UINormalizer
        className={styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        {this.renderFrame()}
        <div style={{ margin: "20px 40px" }}>{this.renderSubScreen()}</div>
      </UINormalizer>
    );
  }
}
