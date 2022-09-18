import { SoundHelper } from "./SoundHelper";


export interface IMediaHelper
{
    loadSound(name: string): void;
    playSound(name: string, options?: SoundPlayOptions): void;

}

export interface SoundPlayOptions
{
    volume: number;
}

export class MediaHelper implements IMediaHelper {
    soundHelper: SoundHelper;

    constructor()
    {
        this.soundHelper = new SoundHelper();
    }

    loadSound(name: string) { this.soundHelper.loadSound(name);}
    playSound(name: string, options?: SoundPlayOptions) {this.soundHelper.play(name, options)}
    repeatSound(name: string, count: number, delay_ms: number, options?: SoundPlayOptions,) {
        for (let i = 0; i < count; i++) {
            setTimeout(() => this.playSound(name, options), delay_ms * i)
        }
    }
}