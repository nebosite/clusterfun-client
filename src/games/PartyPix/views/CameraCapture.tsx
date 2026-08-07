import React from "react";
import styles from "./Client.module.css";
import { nextDeviceIndex } from "./cameraSupport";

// ==========================================================================================
// The PC camera.
//
// A live preview from getUserMedia with a shutter under it. This exists because the file
// input's `capture="environment"` attribute - which is what makes "Take a Photo" open the
// camera app on a phone - is IGNORED on desktop, so on a PC that button opened a file
// browser and did the same job as "Upload a photo" beside it.
//
// Two things it must not get wrong:
//
//   - It has to RELEASE the camera. A stream left running holds the webcam light on after
//     the player has moved on, which reads as being recorded.
//   - It has to fail into the file picker rather than into a dead end. No camera, a denied
//     permission, or a camera another app already owns are all ordinary, and a player who
//     hits one still has to be able to post a picture.
// ==========================================================================================

export interface CameraCaptureProps {
  /** A full-resolution JPEG data URL of the captured frame. */
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
  /** Offered when the camera cannot be opened at all - drops the player on the file picker. */
  onUseFilePicker: () => void;
}

interface CameraCaptureState {
  devices: MediaDeviceInfo[];
  deviceIndex: number;
  error: string | null;
  ready: boolean;
}

/** Captured at the sensor's own size; imageUtil does all the downscaling afterwards. */
const CAPTURE_QUALITY = 0.92;

export class CameraCapture extends React.Component<CameraCaptureProps, CameraCaptureState> {
  private _video = React.createRef<HTMLVideoElement>();
  private _stream: MediaStream | null = null;
  private _disposed = false;

  constructor(props: CameraCaptureProps) {
    super(props);
    this.state = { devices: [], deviceIndex: 0, error: null, ready: false };
  }

  componentDidMount() {
    this.start();
  }

  componentWillUnmount() {
    this._disposed = true;
    this.stopStream();
  }

  /** Every track, every time. Stopping the stream object alone does not turn the light off. */
  private stopStream() {
    if (!this._stream) return;
    for (const track of this._stream.getTracks()) track.stop();
    this._stream = null;
    const video = this._video.current;
    if (video) video.srcObject = null;
  }

  private async start(deviceId?: string) {
    this.stopStream();
    this.setState({ ready: false, error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      // The player may have cancelled while the permission prompt was up; that unmounted us,
      // and a stream nobody is holding is exactly the light-stays-on case.
      if (this._disposed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this._stream = stream;
      const video = this._video.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      this.setState({ ready: true });
      this.loadDevices();
    } catch (err) {
      if (this._disposed) return;
      this.setState({ error: describeCameraError(err), ready: false });
    }
  }

  /** Only worth doing AFTER permission: before it, every device label is an empty string. */
  private async loadDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cameras = all.filter((d) => d.kind === "videoinput");
      if (this._disposed) return;
      this.setState({ devices: cameras });
    } catch {
      // A machine that will not enumerate still has the camera we already opened.
    }
  }

  private switchCamera = () => {
    const { devices, deviceIndex } = this.state;
    if (devices.length <= 1) return;
    const next = nextDeviceIndex(deviceIndex, devices.length);
    this.setState({ deviceIndex: next });
    this.start(devices[next].deviceId);
  };

  private takeShot = () => {
    const video = this._video.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
    this.stopStream(); // before the parent re-renders us away
    this.props.onCapture(dataUrl);
  };

  private cancel = () => {
    this.stopStream();
    this.props.onCancel();
  };

  render() {
    const { devices, error, ready } = this.state;

    if (error) {
      return (
        <div className={styles.cameraOverlay}>
          <div className={styles.cameraError}>{error}</div>
          <div className={styles.cameraActions}>
            <button className={styles.retake} onClick={this.cancel}>
              Back
            </button>
            <button className={styles.upload} onClick={this.props.onUseFilePicker}>
              Pick a file instead
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.cameraOverlay}>
        <video
          ref={this._video}
          className={styles.cameraPreview}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
        />
        <div className={styles.cameraActions}>
          <button className={styles.retake} onClick={this.cancel}>
            Cancel
          </button>
          <button className={styles.upload} onClick={this.takeShot} disabled={!ready}>
            {ready ? "📸 Snap" : "Starting camera…"}
          </button>
          {devices.length > 1 ? (
            <button className={styles.retake} onClick={this.switchCamera} title="Switch camera">
              Switch
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}

/** The three failures a player can actually do something about, named as such. */
function describeCameraError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "This browser blocked the camera. Allow camera access for this site, or pick a file instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera found on this computer. You can still pick a file instead.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and try again, or pick a file instead.";
    default:
      return "Could not start the camera. You can pick a file instead.";
  }
}
