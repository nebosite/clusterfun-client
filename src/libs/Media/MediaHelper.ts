import { SoundHelper } from "./SoundHelper";

export interface IMediaHelper {
  loadSound(name: string): void;
  playSound(name: string, options?: SoundPlayOptions): void;
  setVolume(volume: number): void;
}

export interface SoundPlayOptions {
  volume: number;
  // Playback speed, which also shifts the pitch.  1 is the sample as recorded.
  rate?: number;
}

export class MediaHelper implements IMediaHelper {
  soundHelper: SoundHelper;

  constructor() {
    this.soundHelper = new SoundHelper();
  }

  loadSound(name: string) {
    this.soundHelper.loadSound(name);
  }
  playSound(name: string, options?: SoundPlayOptions) {
    this.soundHelper.play(name, options);
  }
  repeatSound(name: string, count: number, delay_ms: number, options?: SoundPlayOptions) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.playSound(name, options), delay_ms * i);
    }
  }

  /** Master volume for every sound effect, 0..1 - what a host's volume slider drives. */
  setVolume(volume: number) {
    this.soundHelper.setMasterVolume(volume);
  }

  get volume(): number {
    return this.soundHelper.volume;
  }
}
