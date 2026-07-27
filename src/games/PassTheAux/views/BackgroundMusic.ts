// Presenter-only looping background music, one bed per game phase, crossfaded on phase change.
// A single <audio loop> element whose src is swapped with a short volume ramp (fade the old
// bed down, swap, fade the new bed up).  Autoplay is often blocked until the first user
// gesture; play() rejections are swallowed and `kick()` retries the current bed after the
// host's first interaction (e.g. clicking "Start the show").
export class BackgroundMusic {
  private audio: HTMLAudioElement;
  private currentSrc: string | null = null;
  private targetVolume: number;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(volume = 0.5) {
    this.targetVolume = volume;
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = "auto";
    this.audio.volume = 0;
  }

  // Switch to `src` (or null to fade out silence).  Re-calling with the same src is a no-op
  // beyond making sure it is actually playing.
  setTrack(src: string | null) {
    if (src === this.currentSrc) {
      this.kick();
      return;
    }
    this.currentSrc = src;
    if (!src) {
      this.fadeTo(0, 400, () => this.audio.pause());
      return;
    }
    this.fadeTo(0, 300, () => {
      this.audio.src = src;
      try {
        this.audio.currentTime = 0;
      } catch {}
      this.play();
      this.fadeTo(this.targetVolume, 500);
    });
  }

  // Retry playback of the current bed (call after a user gesture unblocks autoplay).
  kick() {
    if (this.currentSrc && this.audio.paused) this.play();
  }

  dispose() {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    try {
      this.audio.pause();
    } catch {}
    this.audio.src = "";
  }

  private play() {
    const p = this.audio.play();
    // Autoplay policy may reject until a gesture; ignore and let kick() retry later.
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  private fadeTo(target: number, ms: number, onDone?: () => void) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const from = this.audio.volume;
    const stepMs = 40;
    const steps = Math.max(1, Math.round(ms / stepMs));
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i++;
      this.audio.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i >= steps) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        onDone?.();
      }
    }, stepMs);
  }
}
