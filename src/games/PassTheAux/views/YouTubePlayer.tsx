// A thin React wrapper over the YouTube IFrame Player API.  A bare <iframe> can autoplay but
// gives no volume control and no "actually started playing" signal - both of which Pass the AUX now
// needs:
//   - Presenter: fade the audio in on start / out before advancing, and arm the metadata-reveal
//     timer only once playback truly begins (buffering must not eat the mystery window).
//   - Client: play a short fine-tune preview of a chosen start offset, then stop.
// The component is remounted (via a React `key`) whenever the video changes, so it never has to
// reconcile a videoId prop change - each instance owns exactly one track.
import React from "react";

// -------------------------------------------------------------------
// Singleton loader for the IFrame API script (only injected once per page).
// -------------------------------------------------------------------
let apiPromise: Promise<any> | null = null;
function loadApi(): Promise<any> {
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      resolve(w.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

interface Props {
  videoId: string;
  startSec: number;
  autoplay?: boolean; // presenter: start the 30s snippet immediately
  fadeInMs?: number; // presenter: ramp volume 0 -> 100 once playback begins
  onPlaying?: (videoId: string) => void; // fired the first time state becomes PLAYING
  fill?: boolean; // presenter: fill the parent tile (absolute inset:0)
  hidden?: boolean; // client: audio-only, parked offscreen
}

export class YouTubePlayer extends React.Component<Props> {
  private host = React.createRef<HTMLDivElement>();
  private player: any = null;
  private ready = false;
  private disposed = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private announcedPlaying = false;

  componentDidMount() {
    loadApi().then((YT) => {
      if (this.disposed || !this.host.current) return;
      this.player = new YT.Player(this.host.current, {
        width: "100%",
        height: "100%",
        videoId: this.props.videoId,
        playerVars: {
          autoplay: this.props.autoplay ? 1 : 0,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          iv_load_policy: 3,
          playsinline: 1,
          start: Math.max(0, Math.floor(this.props.startSec)),
        },
        events: {
          onReady: (e: any) => {
            this.ready = true;
            // Start silent if we intend to fade in; otherwise full volume.
            try {
              e.target.setVolume(this.props.fadeInMs ? 0 : 100);
            } catch {}
          },
          onStateChange: (e: any) => {
            const ns = (window as any).YT;
            if (e.data === ns?.PlayerState?.PLAYING && !this.announcedPlaying) {
              this.announcedPlaying = true;
              if (this.props.fadeInMs) this.fadeTo(100, this.props.fadeInMs);
              this.props.onPlaying?.(this.props.videoId);
            }
          },
        },
      });
    });
  }

  componentWillUnmount() {
    this.disposed = true;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    if (this.previewTimer) clearTimeout(this.previewTimer);
    try {
      this.player?.destroy?.();
    } catch {}
  }

  // Ramp the player volume to `target` (0-100) over `ms`.
  private fadeTo(target: number, ms: number, onDone?: () => void) {
    if (!this.player) return;
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    let from = 0;
    try {
      from = this.player.getVolume() ?? 0;
    } catch {}
    const stepMs = 50;
    const steps = Math.max(1, Math.round(ms / stepMs));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      const v = from + (target - from) * (i / steps);
      try {
        this.player.setVolume(Math.max(0, Math.min(100, v)));
      } catch {}
      if (i >= steps) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        onDone?.();
      }
    }, stepMs);
  }

  // ---- public imperative API ----

  // Presenter: fade the audio out (called ~1s before the model advances the song).
  fadeOut(ms: number) {
    this.fadeTo(0, ms);
  }

  // Client: play `ms` of the track from `startSec`, then pause (fine-tune preview).
  playPreview(startSec: number, ms: number) {
    if (!this.player || !this.ready) return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    try {
      this.player.seekTo(Math.max(0, startSec), true);
      this.player.setVolume(100);
      this.player.playVideo();
    } catch {}
    this.previewTimer = setTimeout(() => {
      try {
        this.player.pauseVideo();
      } catch {}
    }, ms);
  }

  stop() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (this.fadeTimer) {
      clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    try {
      this.player?.pauseVideo?.();
    } catch {}
  }

  render() {
    // The API replaces the inner div with an <iframe>; the wrapper keeps sizing stable.
    const style: React.CSSProperties = this.props.hidden
      ? {
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
          left: -9999,
        }
      : this.props.fill
        ? { position: "absolute", inset: 0 }
        : {};
    return (
      <div style={style}>
        <div ref={this.host} />
      </div>
    );
  }
}
