// The player's phone view.  Two working screens inside Playing:
//   navigate - pan/zoom the board preview and draw an outline to claim
//   camera   - the claimed outline is a live camera viewport; snap & commit
// Keep this thin - it captures input and shows feedback; the presenter owns
// the real collage.
import React from "react";
import { observer, inject } from "mobx-react";
import { CollageBoardClientModel, CollageBoardClientState } from "../models/ClientModel";
import styles from "./Client.module.css";
import classNames from "classnames";
import {
  UIProperties,
  GeneralGameState,
  SafeBrowser,
  GeneralClientGameState,
  ScaleToWidth,
  ErrorBoundary,
  ClientHeader,
} from "libs";
import Logger from "js-logger";
import {
  ZonePoint,
  ImageTransform,
  polygonBounds,
  polygonToCssClipPath,
  patchOutputSize,
  coverScale,
  initialImageTransform,
  panTransform,
  pinchTransform,
  contextBounds,
} from "../models/collageBoardLogic";
import {
  PATCH_MAX_EDGE,
  PATCH_TARGET_BYTES,
  JPEG_QUALITY_START,
  JPEG_QUALITY_MIN,
  JPEG_QUALITY_STEP,
  MAX_VIEW_ZOOM,
  CANVAS_ASPECT,
  CONTEXT_MARGIN_FACTOR,
  CONTEXT_MIN_MARGIN,
  PREVIEW_WIDTH,
  PREVIEW_HEIGHT,
  COLLAGE_BOARD_VERSION_HISTORY,
} from "../models/GameSettings";
import { startCamera, stopCamera, canvasToJpegUnderSize, loadImageFromFile } from "./cameraCapture";

// Board canvas resolution inside the 1080-wide virtual phone screen
const BOARD_W = 1000;
const BOARD_H = 562; // 16:9

type NavTool = "move" | "draw";

// -------------------------------------------------------------------
// NavigateScreen - pan/zoom the board, draw an outline, claim it
// -------------------------------------------------------------------
@inject("appModel")
@observer
class NavigateScreen extends React.Component<
  { appModel?: CollageBoardClientModel },
  { tool: NavTool; pendingPoints: ZonePoint[] | null; claiming: boolean }
> {
  canvasDomId: string;
  private _previewImage: HTMLImageElement | null = null;
  private _previewImageSrc: string | null = null;

  // Live pointer state (screen fractions of the canvas, 0..1)
  private _pointers = new Map<number, { fx: number; fy: number }>();
  private _drawingPoints: ZonePoint[] | null = null;
  private _lastPinchDist = 0;

  constructor(props: { appModel?: CollageBoardClientModel }) {
    super(props);
    this.state = { tool: "move", pendingPoints: null, claiming: false };
    this.canvasDomId = "CollageNavCanvas" + this.props.appModel!.playerId;
    props.appModel!.onTick.subscribe("collage-nav-draw", () => this.drawBoard());
  }

  componentWillUnmount() {
    this.props.appModel?.onTick.unsubscribe("collage-nav-draw");
  }

  // ---- coordinate helpers -------------------------------------------------
  private canvasFraction(e: { clientX: number; clientY: number }) {
    const canvas = document.getElementById(this.canvasDomId) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      fx: (e.clientX - rect.left) / rect.width,
      fy: (e.clientY - rect.top) / rect.height,
    };
  }

  private toBoard(fx: number, fy: number): ZonePoint {
    const m = this.props.appModel!;
    const span = 1 / m.viewScale;
    return { x: m.viewX + fx * span, y: m.viewY + fy * span };
  }

  // ---- pointer handling ---------------------------------------------------
  private handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort: synthetic/stale pointerIds throw NotFoundError
    }
    const f = this.canvasFraction(e);
    this._pointers.set(e.pointerId, f);

    if (this.state.tool === "draw" && this._pointers.size === 1) {
      this._drawingPoints = [this.toBoard(f.fx, f.fy)];
      this.setState({ pendingPoints: null });
    }
    if (this._pointers.size === 2) {
      this._drawingPoints = null; // second finger = pinch, not draw
      this._lastPinchDist = this.pinchDistance();
    }
  };

  private handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!this._pointers.has(e.pointerId)) return;
    const prev = this._pointers.get(e.pointerId)!;
    const f = this.canvasFraction(e);
    this._pointers.set(e.pointerId, f);
    const m = this.props.appModel!;

    if (this._pointers.size === 2) {
      // Pinch zoom around the midpoint
      const dist = this.pinchDistance();
      if (this._lastPinchDist > 0.001 && dist > 0.001) {
        const mid = this.pinchMidpoint();
        const boardMid = this.toBoard(mid.fx, mid.fy);
        const newScale = Math.min(
          MAX_VIEW_ZOOM,
          Math.max(1, m.viewScale * (dist / this._lastPinchDist)),
        );
        m.setView(newScale, boardMid.x - mid.fx / newScale, boardMid.y - mid.fy / newScale);
      }
      this._lastPinchDist = dist;
      return;
    }

    if (this.state.tool === "draw" && this._drawingPoints) {
      const p = this.toBoard(f.fx, f.fy);
      const last = this._drawingPoints[this._drawingPoints.length - 1];
      const minStep = 0.004 / m.viewScale;
      if (Math.hypot(p.x - last.x, p.y - last.y) > minStep) this._drawingPoints.push(p);
    } else if (this.state.tool === "move") {
      const span = 1 / m.viewScale;
      m.setView(m.viewScale, m.viewX - (f.fx - prev.fx) * span, m.viewY - (f.fy - prev.fy) * span);
    }
  };

  private handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    this._pointers.delete(e.pointerId);
    this._lastPinchDist = 0;
    if (this.state.tool === "draw" && this._drawingPoints && this._pointers.size === 0) {
      const points = this._drawingPoints;
      this._drawingPoints = null;
      if (points.length >= 3) this.setState({ pendingPoints: points });
    }
  };

  private pinchDistance() {
    const [a, b] = Array.from(this._pointers.values());
    return Math.hypot(a.fx - b.fx, a.fy - b.fy);
  }

  private pinchMidpoint() {
    const [a, b] = Array.from(this._pointers.values());
    return { fx: (a.fx + b.fx) / 2, fy: (a.fy + b.fy) / 2 };
  }

  private zoomBy(factor: number) {
    const m = this.props.appModel!;
    const newScale = Math.min(MAX_VIEW_ZOOM, Math.max(1, m.viewScale * factor));
    const span = 1 / m.viewScale;
    const newSpan = 1 / newScale;
    // Zoom around the viewport center
    m.setView(newScale, m.viewX + span / 2 - newSpan / 2, m.viewY + span / 2 - newSpan / 2);
  }

  // ---- rendering ----------------------------------------------------------
  private drawBoard() {
    const canvas = document.getElementById(this.canvasDomId) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    const m = this.props.appModel;
    if (!canvas || !ctx || !m) return;

    ctx.fillStyle = "#14181d";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    const scale = m.viewScale;
    const toCanvas = (p: ZonePoint) => ({
      x: (p.x - m.viewX) * scale * BOARD_W,
      y: (p.y - m.viewY) * scale * BOARD_H,
    });

    // The collage preview
    if (m.preview) {
      if (this._previewImageSrc !== m.preview) {
        this._previewImageSrc = m.preview;
        const img = new Image();
        img.onload = () => (this._previewImage = img);
        img.src = m.preview;
      }
      if (this._previewImage) {
        const origin = toCanvas({ x: 0, y: 0 });
        ctx.drawImage(this._previewImage, origin.x, origin.y, scale * BOARD_W, scale * BOARD_H);
      }
    } else {
      ctx.fillStyle = "#3a4048";
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "Blank canvas - draw a zone and take the first picture!",
        BOARD_W / 2,
        BOARD_H / 2,
      );
      ctx.textAlign = "start";
    }

    // Board edge so you can tell where the canvas ends when zoomed
    const o = toCanvas({ x: 0, y: 0 });
    ctx.strokeStyle = "#5a626e";
    ctx.lineWidth = 2;
    ctx.strokeRect(o.x, o.y, scale * BOARD_W, scale * BOARD_H);

    // Active zones (everyone's)
    for (const zone of m.zones) {
      this.strokePolygon(ctx, zone.points.map(toCanvas), zone.color, true);
    }

    // The outline being drawn / awaiting confirmation, in my color
    const working = this._drawingPoints ?? this.state.pendingPoints;
    if (working && working.length > 1) {
      this.strokePolygon(ctx, working.map(toCanvas), m.myColor, false, !this._drawingPoints);
    }
  }

  private strokePolygon(
    ctx: CanvasRenderingContext2D,
    pts: { x: number; y: number }[],
    color: string,
    dashed: boolean,
    close = true,
  ) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.setLineDash(dashed ? [10, 8] : []);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (close) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private claimPending = async () => {
    const points = this.state.pendingPoints;
    if (!points) return;
    this.setState({ claiming: true });
    const granted = await this.props.appModel!.claimZone(points);
    this.setState({ claiming: false, pendingPoints: granted ? null : this.state.pendingPoints });
  };

  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APPMODEL</div>;
    const { tool, pendingPoints, claiming } = this.state;

    return (
      <div>
        <div className={styles.toolRow}>
          <button
            className={classNames(styles.toolButton, { [styles.toolActive]: tool === "move" })}
            onClick={() => this.setState({ tool: "move" })}
          >
            ✋ Move
          </button>
          <button
            className={classNames(styles.toolButton, { [styles.toolActive]: tool === "draw" })}
            onClick={() => this.setState({ tool: "draw" })}
          >
            ✏️ Draw
          </button>
          <button className={styles.toolButton} onClick={() => this.zoomBy(1.5)}>
            ➕
          </button>
          <button className={styles.toolButton} onClick={() => this.zoomBy(1 / 1.5)}>
            ➖
          </button>
        </div>

        <div className={styles.boardFrame}>
          <canvas
            id={this.canvasDomId}
            width={BOARD_W}
            height={BOARD_H}
            className={styles.boardCanvas}
            style={{ touchAction: "none" }}
            onPointerDown={this.handlePointerDown}
            onPointerMove={this.handlePointerMove}
            onPointerUp={this.handlePointerUp}
            onPointerCancel={this.handlePointerUp}
          />
        </div>

        {appModel.claimError ? <div className={styles.errorText}>{appModel.claimError}</div> : null}

        {pendingPoints ? (
          <div className={styles.confirmRow}>
            <button
              className={styles.primaryButton}
              disabled={claiming}
              onClick={this.claimPending}
            >
              {claiming ? "Claiming..." : "📸 Claim this zone"}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={claiming}
              onClick={() => this.setState({ pendingPoints: null })}
            >
              Clear
            </button>
          </div>
        ) : (
          <div className={styles.hintText}>
            {tool === "draw"
              ? "Drag to outline the spot you want to fill"
              : "Drag to pan, pinch or ➕/➖ to zoom"}
          </div>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// CameraScreen - the claimed zone is a live viewport for the camera
// -------------------------------------------------------------------
@inject("appModel")
@observer
class CameraScreen extends React.Component<
  { appModel?: CollageBoardClientModel },
  {
    capturePath: "choose" | "camera";
    // A shot has been taken/picked and is being framed (pan/zoom/tilt).
    editing: boolean;
    cameraFailed: boolean;
    committing: boolean;
  }
> {
  videoDomId: string;
  editorDomId: string;
  private _stream: MediaStream | null = null;

  // The frozen shot being framed, plus the pan/zoom/tilt transform that maps
  // it into the zone's bounding-box output canvas.
  private _source: CanvasImageSource | null = null;
  private _srcW = 0;
  private _srcH = 0;
  private _outW = 0;
  private _outH = 0;
  private _transform: ImageTransform = { scale: 1, rotation: 0, cx: 0, cy: 0 };
  private _minScale = 0.1;
  private _maxScale = 10;

  // Live pointer positions on the editor canvas (output-space pixels).
  private _editPointers = new Map<number, { x: number; y: number }>();
  private _lastPinchDist = 0;
  private _lastPinchAngle = 0;

  constructor(props: { appModel?: CollageBoardClientModel }) {
    super(props);
    // Start on the chooser: the player picks camera vs upload, so we don't
    // pop a camera-permission prompt on someone who only wants to upload.
    this.state = { capturePath: "choose", editing: false, cameraFailed: false, committing: false };
    this.videoDomId = "CollageCamera" + this.props.appModel!.playerId;
    this.editorDomId = "CollageEditor" + this.props.appModel!.playerId;
  }

  componentDidUpdate() {
    // Redraw the framing editor / re-bind the live stream when they (re)mount.
    if (this.state.editing) this.drawEditor();
    else if (this.state.capturePath === "camera" && !this.state.cameraFailed) this.attachStream();
  }

  componentWillUnmount() {
    stopCamera(this._stream);
    this._stream = null;
  }

  // ---- camera path: open the live rear camera into the zone viewport ------
  private chooseCamera = () => {
    this.setState({ capturePath: "camera" });
    startCamera()
      .then((stream) => {
        this._stream = stream;
        this.attachStream();
      })
      .catch((err) => {
        Logger.info(`Camera unavailable, falling back to file capture: ${err}`);
        this.setState({ cameraFailed: true });
      });
  };

  private attachStream() {
    if (!this._stream) return;
    const video = document.getElementById(this.videoDomId) as HTMLVideoElement | null;
    if (video && video.srcObject !== this._stream) video.srcObject = this._stream;
  }

  // ---- take/pick a shot, then move into the framing editor ----------------
  private snap = () => {
    const zone = this.props.appModel?.claimedZone;
    const video = document.getElementById(this.videoDomId) as HTMLVideoElement | null;
    if (!zone || !video || video.videoWidth === 0) return;
    // Freeze the current video frame into an offscreen canvas so we can frame it.
    const frame = document.createElement("canvas");
    frame.width = video.videoWidth;
    frame.height = video.videoHeight;
    frame.getContext("2d")?.drawImage(video, 0, 0);
    this.beginEditing(frame, video.videoWidth, video.videoHeight, zone);
  };

  private handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const zone = this.props.appModel?.claimedZone;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!zone || !file) return;
    try {
      const img = await loadImageFromFile(file);
      this.beginEditing(img, img.naturalWidth, img.naturalHeight, zone);
    } catch (err) {
      Logger.warn(`Could not read the picked file: ${err}`);
    }
  };

  private beginEditing(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    zone: { points: ZonePoint[] },
  ) {
    const out = patchOutputSize(polygonBounds(zone.points), 1920, 1080, PATCH_MAX_EDGE);
    this._source = source;
    this._srcW = srcW;
    this._srcH = srcH;
    this._outW = out.width;
    this._outH = out.height;
    const base = coverScale(srcW, srcH, out.width, out.height);
    this._minScale = base * 0.25;
    this._maxScale = base * 8;
    this._transform = initialImageTransform(srcW, srcH, out.width, out.height);
    this._editPointers.clear();
    this.setState({ editing: true });
  }

  private retake = () => {
    this._source = null;
    this._editPointers.clear();
    this.setState({ editing: false });
  };

  // ---- framing: pan / zoom / tilt the shot inside the zone ----------------
  private drawEditor() {
    const canvas = document.getElementById(this.editorDomId) as HTMLCanvasElement | null;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !this._source) return;
    if (canvas.width !== this._outW) canvas.width = this._outW;
    if (canvas.height !== this._outH) canvas.height = this._outH;
    const t = this._transform;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, this._outW, this._outH);
    ctx.translate(t.cx, t.cy);
    ctx.rotate(t.rotation);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(this._source, -this._srcW / 2, -this._srcH / 2, this._srcW, this._srcH);
  }

  private editorPoint(e: { clientX: number; clientY: number }) {
    const canvas = document.getElementById(this.editorDomId) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * this._outW,
      y: ((e.clientY - rect.top) / rect.height) * this._outH,
    };
  }

  private handleEditPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    } catch {
      // Best-effort: synthetic/stale pointerIds throw NotFoundError
    }
    this._editPointers.set(e.pointerId, this.editorPoint(e));
    if (this._editPointers.size === 2) {
      this._lastPinchDist = this.pinchDistance();
      this._lastPinchAngle = this.pinchAngle();
    }
  };

  private handleEditPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!this._editPointers.has(e.pointerId)) return;
    const prev = this._editPointers.get(e.pointerId)!;
    const p = this.editorPoint(e);
    this._editPointers.set(e.pointerId, p);

    if (this._editPointers.size >= 2) {
      const dist = this.pinchDistance();
      const angle = this.pinchAngle();
      const mid = this.pinchMidpoint();
      const factor = this._lastPinchDist > 0.001 ? dist / this._lastPinchDist : 1;
      // Shortest angular delta so a wrap past ±180° doesn't spin the image.
      let dRot = angle - this._lastPinchAngle;
      dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot));
      this._transform = pinchTransform(
        this._transform,
        mid.x,
        mid.y,
        factor,
        dRot,
        this._minScale,
        this._maxScale,
      );
      this._lastPinchDist = dist;
      this._lastPinchAngle = angle;
    } else {
      this._transform = panTransform(this._transform, p.x - prev.x, p.y - prev.y);
    }
    this.drawEditor();
  };

  private handleEditPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    this._editPointers.delete(e.pointerId);
    if (this._editPointers.size < 2) {
      this._lastPinchDist = 0;
      this._lastPinchAngle = 0;
    }
  };

  private pinchPair() {
    return Array.from(this._editPointers.values());
  }
  private pinchDistance() {
    const [a, b] = this.pinchPair();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  private pinchAngle() {
    const [a, b] = this.pinchPair();
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  private pinchMidpoint() {
    const [a, b] = this.pinchPair();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // Button controls (desktop / fine adjust): zoom & tilt about the center.
  private adjust(scaleFactor: number, deltaRotation: number) {
    this._transform = pinchTransform(
      this._transform,
      this._outW / 2,
      this._outH / 2,
      scaleFactor,
      deltaRotation,
      this._minScale,
      this._maxScale,
    );
    this.drawEditor();
  }

  private commit = async () => {
    const canvas = document.getElementById(this.editorDomId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const jpeg = canvasToJpegUnderSize(
      canvas,
      PATCH_TARGET_BYTES,
      JPEG_QUALITY_START,
      JPEG_QUALITY_MIN,
      JPEG_QUALITY_STEP,
    );
    this.setState({ committing: true });
    const res = await this.props.appModel!.commitPhoto(jpeg);
    if (!res.ok) this.setState({ committing: false });
    // On success the model flips back to navigate and this screen unmounts
  };

  render() {
    const { appModel } = this.props;
    const zone = appModel?.claimedZone;
    if (!appModel || !zone) return <div>No zone selected</div>;
    const { capturePath, editing, cameraFailed, committing } = this.state;

    // Fit a padded "context" box around the zone (16:9 board units ->
    // physical aspect) into the available virtual space, so the frame shows
    // some of the surrounding collage rather than just the bare outline.
    const bounds = polygonBounds(zone.points);
    const padded = contextBounds(bounds, CANVAS_ASPECT, CONTEXT_MARGIN_FACTOR, CONTEXT_MIN_MARGIN);
    const physicalAspect = (padded.width * CANVAS_ASPECT) / Math.max(0.0001, padded.height);
    const maxW = 980;
    const maxH = 1000;
    let frameW = maxW;
    let frameH = frameW / physicalAspect;
    if (frameH > maxH) {
      frameH = maxH;
      frameW = frameH * physicalAspect;
    }

    // Where the zone's own bounding box sits inside the padded frame - the
    // live camera/edit surface is positioned to just that sub-rect so it
    // lines up with the backdrop underneath it.
    const zoneRectStyle = {
      left: `${((bounds.x - padded.x) / (padded.width || 1)) * 100}%`,
      top: `${((bounds.y - padded.y) / (padded.height || 1)) * 100}%`,
      width: `${(bounds.width / (padded.width || 1)) * 100}%`,
      height: `${(bounds.height / (padded.height || 1)) * 100}%`,
    };

    const clipPath = polygonToCssClipPath(zone.points, bounds);
    const svgPoints = zone.points
      .map((p) => {
        const px = ((p.x - padded.x) / (padded.width || 1)) * 100;
        const py = ((p.y - padded.y) / (padded.height || 1)) * 100;
        return `${px},${py}`;
      })
      .join(" ");

    // Backdrop: the surrounding collage, cropped to the padded box and
    // scaled to exactly fill the frame (uniform scale - the preview image
    // shares the board's 16:9 shape, so no skew).
    const backdropScale = frameW / (padded.width * PREVIEW_WIDTH);
    const backdropStyle = appModel.preview
      ? {
          left: `${-padded.x * PREVIEW_WIDTH * backdropScale}px`,
          top: `${-padded.y * PREVIEW_HEIGHT * backdropScale}px`,
          width: `${PREVIEW_WIDTH * backdropScale}px`,
          height: `${PREVIEW_HEIGHT * backdropScale}px`,
        }
      : null;

    const liveCamera = capturePath === "camera" && !cameraFailed;
    const hint = editing
      ? "Drag to pan · pinch to zoom · twist to tilt"
      : liveCamera
        ? "Line up your shot inside your zone"
        : cameraFailed
          ? "No camera here - take one with your device"
          : "Take a picture or upload one for your zone";

    return (
      <div>
        <div className={styles.hintText}>{hint}</div>
        <div className={styles.cameraFrame} style={{ width: `${frameW}px`, height: `${frameH}px` }}>
          {backdropStyle ? (
            <img
              src={appModel.preview!}
              alt=""
              className={styles.contextBackdrop}
              style={backdropStyle}
            />
          ) : null}
          {editing ? (
            <canvas
              id={this.editorDomId}
              className={styles.cameraFill}
              style={{ ...zoneRectStyle, clipPath, touchAction: "none" }}
              onPointerDown={this.handleEditPointerDown}
              onPointerMove={this.handleEditPointerMove}
              onPointerUp={this.handleEditPointerUp}
              onPointerCancel={this.handleEditPointerUp}
            />
          ) : liveCamera ? (
            <video
              id={this.videoDomId}
              className={styles.cameraFill}
              style={{ ...zoneRectStyle, clipPath, objectFit: "cover" }}
              autoPlay
              playsInline
              muted
            />
          ) : (
            <div className={styles.cameraFallback} style={{ ...zoneRectStyle, clipPath }}>
              <span className={styles.fallbackIcon}>🖼️</span>
            </div>
          )}
          <svg className={styles.zoneOutline} viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon
              points={svgPoints}
              fill="none"
              stroke={appModel.myColor}
              strokeWidth={0.8}
              strokeDasharray="3 2"
            />
          </svg>
        </div>

        {editing ? (
          <div className={styles.toolRow}>
            <button className={styles.toolButton} onClick={() => this.adjust(1, -Math.PI / 12)}>
              ↺
            </button>
            <button className={styles.toolButton} onClick={() => this.adjust(1 / 1.25, 0)}>
              ➖
            </button>
            <button className={styles.toolButton} onClick={() => this.adjust(1.25, 0)}>
              ➕
            </button>
            <button className={styles.toolButton} onClick={() => this.adjust(1, Math.PI / 12)}>
              ↻
            </button>
          </div>
        ) : null}

        {appModel.claimError ? <div className={styles.errorText}>{appModel.claimError}</div> : null}

        <div className={styles.confirmRow}>
          {editing ? (
            <React.Fragment>
              <button className={styles.primaryButton} disabled={committing} onClick={this.commit}>
                {committing ? "Sending..." : "✅ Use it"}
              </button>
              <button
                className={styles.secondaryButton}
                disabled={committing}
                onClick={this.retake}
              >
                🔄 Retake
              </button>
            </React.Fragment>
          ) : liveCamera ? (
            <button className={styles.primaryButton} onClick={this.snap}>
              📸 Snap
            </button>
          ) : cameraFailed ? (
            <label className={styles.primaryButton}>
              📷 Take a picture
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={this.handleFilePicked}
              />
            </label>
          ) : (
            <React.Fragment>
              <button className={styles.primaryButton} onClick={this.chooseCamera}>
                📷 Take a picture
              </button>
              <label className={styles.secondaryButton}>
                🖼️ Upload a picture
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={this.handleFilePicked}
                />
              </label>
            </React.Fragment>
          )}
          <button
            className={styles.secondaryButton}
            disabled={committing}
            onClick={() => appModel.cancelClaim()}
          >
            ✖ Cancel
          </button>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// PlayingScreen - switch between navigation and the camera
// -------------------------------------------------------------------
@inject("appModel")
@observer
class PlayingScreen extends React.Component<{ appModel?: CollageBoardClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APPMODEL</div>;
    return appModel.mode === "camera" && appModel.claimedZone ? (
      <CameraScreen />
    ) : (
      <NavigateScreen />
    );
  }
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: CollageBoardClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;

  // -------------------------------------------------------------------
  // Do something to alert the user if the game state changed
  // -------------------------------------------------------------------
  alertUser() {
    const { appModel } = this.props;
    if (appModel!.gameState !== this.lastState) {
      SafeBrowser.vibrate([50, 50, 50, 50]);
    }
    this.lastState = appModel!.gameState as string;
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;

    switch (appModel!.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return (
          <div className={styles.wait_text}>
            Sit tight, we are waiting for the host to start the collage...
          </div>
        );
      case CollageBoardClientState.Playing:
        this.alertUser();
        return <PlayingScreen />;
      case GeneralClientGameState.Paused:
        return <div className={styles.wait_text}>The game is paused...</div>;
      case GeneralGameState.GameOver:
        return (
          <React.Fragment>
            <p>The collage is done, thanks for playing!</p>
            <div>
              <button onClick={() => this.props.appModel!.quitApp()}>Quit</button>
            </div>
          </React.Fragment>
        );
      case GeneralClientGameState.JoinError:
        return <p>Could not join the game because: {this.props.appModel!.joinError}</p>;
      default:
        return <div>These are not the droids you are looking for...</div>;
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    return (
      <div>
        <ScaleToWidth
          virtualWidth={1080}
          virtualHeight={1920}
          containerWidth={this.props.uiProperties.containerWidth}
          containerHeight={this.props.uiProperties.containerHeight}
          hoverScrollbar
          fillHeight
        >
          <div className={styles.gameclient}>
            {/* The bar keeps this player's own colour - it is how you tell your patches
                from everybody else's on the shared board. */}
            <ClientHeader
              className={styles.topbar}
              style={{ backgroundColor: appModel?.myColor ?? "#ffffff" }}
              title="CollageBoard"
              history={COLLAGE_BOARD_VERSION_HISTORY}
              avatarId={appModel?.avatarId ?? 0}
              avatarColor={appModel?.avatarColor}
              playerName={appModel?.playerName}
              onQuit={() => appModel?.quitApp()}
            />
            <div className={styles.clientBody}>
              <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
            </div>
          </div>
        </ScaleToWidth>
      </div>
    );
  }
}
