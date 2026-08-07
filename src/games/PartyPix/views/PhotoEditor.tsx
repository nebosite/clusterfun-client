import React from "react";
import styles from "./Client.module.css";
import {
  CropRect,
  CropCorner,
  FULL_CROP,
  moveCrop,
  resizeCrop,
  toCropSpace,
  brushWidthFor,
  BRUSH_COLORS,
} from "./photoEditLogic";

// ==========================================================================================
// Crop and draw, between taking a photo and sending it.
//
// The picture is shown at whatever size the phone's band allows, but NOTHING is stored in
// those coordinates: the crop is a 0..1 rect over the original image and every stroke point is
// a 0..1 position on the original image. The preview and the final full-resolution composite
// are then two renderings of the same numbers, which is what stops a stroke landing somewhere
// different in the picture that actually gets uploaded.
//
// The drawing is baked into the JPEG here, so the host needs to know nothing about any of it -
// it receives a photo with the drawing already on it, and the wire format is untouched.
// ==========================================================================================

interface Stroke {
  color: string;
  /** Points in ORIGINAL-image space, 0..1. */
  points: { x: number; y: number }[];
}

export interface PhotoEditorProps {
  /** The photo to edit, as a data URL. */
  source: string;
  onCancel: () => void;
  /** Called with the composited result - cropped, drawn on, full resolution. */
  onDone: (dataUrl: string) => void;
  busy?: boolean;
  doneLabel: string;
}

interface PhotoEditorState {
  mode: "crop" | "draw";
  crop: CropRect;
  strokes: Stroke[];
  color: string;
  loaded: boolean;
}

/** How close to a corner a touch has to land to grab it, as a fraction of the preview. */
const HANDLE_GRAB = 0.12;

export class PhotoEditor extends React.Component<PhotoEditorProps, PhotoEditorState> {
  private _canvas = React.createRef<HTMLCanvasElement>();
  private _image: HTMLImageElement | null = null;
  private _drag:
    | { kind: "move"; lastX: number; lastY: number }
    | { kind: "corner"; corner: CropCorner }
    | { kind: "draw" }
    | null = null;

  constructor(props: PhotoEditorProps) {
    super(props);
    this.state = {
      mode: "crop",
      crop: FULL_CROP,
      strokes: [],
      color: BRUSH_COLORS[0],
      loaded: false,
    };
  }

  componentDidMount() {
    const img = new Image();
    img.onload = () => {
      this._image = img;
      this.setState({ loaded: true }, () => this.paint());
    };
    img.src = this.props.source;
  }

  componentDidUpdate() {
    this.paint();
  }

  // ---- coordinates ---------------------------------------------------------
  /** A pointer event as a 0..1 position on the ORIGINAL image. */
  private toImageSpace(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const { crop } = this.state;
    // The canvas shows the CROPPED region, so a tap maps back through the crop.
    return { x: crop.x + fx * crop.width, y: crop.y + fy * crop.height };
  }

  /** In crop mode the canvas shows the WHOLE image, so the mapping is direct. */
  private toWholeImageSpace(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  private cornerNear(x: number, y: number): CropCorner | null {
    const { crop } = this.state;
    const corners: [CropCorner, number, number][] = [
      ["nw", crop.x, crop.y],
      ["ne", crop.x + crop.width, crop.y],
      ["sw", crop.x, crop.y + crop.height],
      ["se", crop.x + crop.width, crop.y + crop.height],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.abs(x - cx) < HANDLE_GRAB && Math.abs(y - cy) < HANDLE_GRAB) return name;
    }
    return null;
  }

  // ---- pointer handling ----------------------------------------------------
  private onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Best-effort: a synthetic or stale pointerId throws NotFoundError, and losing capture
      // only means a stroke stops early if the finger leaves the canvas.
    }
    if (this.state.mode === "draw") {
      const p = this.toImageSpace(e);
      this._drag = { kind: "draw" };
      this.setState((s) => ({ strokes: [...s.strokes, { color: s.color, points: [p] }] }));
      return;
    }
    const p = this.toWholeImageSpace(e);
    const corner = this.cornerNear(p.x, p.y);
    this._drag = corner ? { kind: "corner", corner } : { kind: "move", lastX: p.x, lastY: p.y };
  };

  private onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!this._drag) return;
    if (this._drag.kind === "draw") {
      const p = this.toImageSpace(e);
      this.setState((s) => {
        const strokes = s.strokes.slice();
        const last = strokes[strokes.length - 1];
        if (last) strokes[strokes.length - 1] = { ...last, points: [...last.points, p] };
        return { strokes };
      });
      return;
    }
    const p = this.toWholeImageSpace(e);
    if (this._drag.kind === "corner") {
      this.setState((s) => ({ crop: resizeCrop(s.crop, (this._drag as any).corner, p.x, p.y) }));
    } else {
      const dx = p.x - this._drag.lastX;
      const dy = p.y - this._drag.lastY;
      this._drag = { kind: "move", lastX: p.x, lastY: p.y };
      this.setState((s) => ({ crop: moveCrop(s.crop, dx, dy) }));
    }
  };

  private onPointerUp = () => {
    this._drag = null;
  };

  // ---- rendering -----------------------------------------------------------
  /** Draw the working preview: cropped view when drawing, whole image + frame when cropping. */
  private paint() {
    const canvas = this._canvas.current;
    const img = this._image;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { crop, mode, strokes } = this.state;

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;

    if (mode === "crop") {
      // Whole image, with everything outside the crop dimmed and a frame on the crop itself.
      canvas.width = iw;
      canvas.height = ih;
      ctx.clearRect(0, 0, iw, ih);
      ctx.drawImage(img, 0, 0, iw, ih);
      this.paintStrokes(ctx, strokes, FULL_CROP, iw, ih);

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, iw, crop.y * ih);
      ctx.fillRect(0, (crop.y + crop.height) * ih, iw, ih);
      ctx.fillRect(0, crop.y * ih, crop.x * iw, crop.height * ih);
      ctx.fillRect((crop.x + crop.width) * iw, crop.y * ih, iw, crop.height * ih);

      const lw = Math.max(2, Math.round(Math.min(iw, ih) * 0.006));
      ctx.strokeStyle = "#22e0ff";
      ctx.lineWidth = lw;
      ctx.strokeRect(crop.x * iw, crop.y * ih, crop.width * iw, crop.height * ih);
      // Corner grips, so the handles are findable with a thumb.
      const g = Math.round(Math.min(iw, ih) * 0.05);
      ctx.fillStyle = "#22e0ff";
      for (const [cx, cy] of [
        [crop.x, crop.y],
        [crop.x + crop.width, crop.y],
        [crop.x, crop.y + crop.height],
        [crop.x + crop.width, crop.y + crop.height],
      ]) {
        ctx.fillRect(cx * iw - g / 2, cy * ih - g / 2, g, g);
      }
      return;
    }

    // Draw mode: show exactly what will be uploaded.
    const cw = Math.max(1, Math.round(crop.width * iw));
    const ch = Math.max(1, Math.round(crop.height * ih));
    canvas.width = cw;
    canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, crop.x * iw, crop.y * ih, cw, ch, 0, 0, cw, ch);
    this.paintStrokes(ctx, strokes, crop, cw, ch);
  }

  /** Strokes are image-space; this is the only place they become pixels. */
  private paintStrokes(
    ctx: CanvasRenderingContext2D,
    strokes: Stroke[],
    crop: CropRect,
    width: number,
    height: number,
  ) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushWidthFor(width, height);
    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.beginPath();
      stroke.points.forEach((p, i) => {
        const c = toCropSpace(p, crop);
        const x = c.x * width;
        const y = c.y * height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (stroke.points.length === 1) {
        // A tap is a dot, not nothing.
        const c = toCropSpace(stroke.points[0], crop);
        ctx.lineTo(c.x * width + 0.01, c.y * height);
      }
      ctx.stroke();
    }
  }

  /** Composite at full resolution and hand it back. */
  private finish = () => {
    const img = this._image;
    if (!img) return;
    const { crop, strokes } = this.state;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const cw = Math.max(1, Math.round(crop.width * iw));
    const ch = Math.max(1, Math.round(crop.height * ih));

    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, crop.x * iw, crop.y * ih, cw, ch, 0, 0, cw, ch);
    this.paintStrokes(ctx, strokes, crop, cw, ch);
    this.props.onDone(out.toDataURL("image/jpeg", 0.92));
  };

  private undo = () => this.setState((s) => ({ strokes: s.strokes.slice(0, -1) }));
  private resetCrop = () => this.setState({ crop: FULL_CROP });

  render() {
    const { mode, color, strokes, crop } = this.state;
    const cropped = crop.width < 0.999 || crop.height < 0.999;

    return (
      <div className={styles.editorOverlay}>
        <div className={styles.editorTabs}>
          <button
            className={mode === "crop" ? styles.editorTabOn : styles.editorTab}
            onClick={() => this.setState({ mode: "crop" })}
          >
            ⤢ Crop
          </button>
          <button
            className={mode === "draw" ? styles.editorTabOn : styles.editorTab}
            onClick={() => this.setState({ mode: "draw" })}
          >
            ✎ Draw
          </button>
          {mode === "crop" && cropped ? (
            <button className={styles.editorMinor} onClick={this.resetCrop}>
              Reset
            </button>
          ) : null}
          {mode === "draw" && strokes.length > 0 ? (
            <button className={styles.editorMinor} onClick={this.undo}>
              Undo
            </button>
          ) : null}
        </div>

        <canvas
          ref={this._canvas}
          className={styles.editorCanvas}
          onPointerDown={this.onPointerDown}
          onPointerMove={this.onPointerMove}
          onPointerUp={this.onPointerUp}
          onPointerCancel={this.onPointerUp}
        />

        {mode === "draw" ? (
          <div className={styles.palette}>
            {BRUSH_COLORS.map((c) => (
              <button
                key={c}
                className={c === color ? styles.swatchOn : styles.swatch}
                style={{ background: c }}
                aria-label={`brush colour ${c}`}
                onClick={() => this.setState({ color: c })}
              />
            ))}
          </div>
        ) : (
          <div className={styles.editorHint}>Drag a corner to crop, or drag inside to move.</div>
        )}

        <div className={styles.reviewActions}>
          <button
            className={styles.retake}
            onClick={this.props.onCancel}
            disabled={this.props.busy}
          >
            Retake
          </button>
          <button className={styles.upload} onClick={this.finish} disabled={this.props.busy}>
            {this.props.doneLabel}
          </button>
        </div>
      </div>
    );
  }
}
