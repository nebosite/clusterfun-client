

// ----------------------------------------------------------------------------------------
// Abstracted interaction with AudioContext
// https://www.html5rocks.com/en/tutorials/webaudio/intro

import { SoundPlayOptions } from "./MediaHelper";

// ----------------------------------------------------------------------------------------
export class SoundHelper
{
    sounds = new Map<string, AudioBuffer >();
    context?: AudioContext

    initialization: Promise<void>

    // ----------------------------------------------------------------------------------------
    // ctor
    // ----------------------------------------------------------------------------------------
    constructor ()
    {
        this.initialization = new Promise<void>(resolve => {
            this.context = new AudioContext();
            resolve()
        })
    }

    // ----------------------------------------------------------------------------------------
    // pre-load a sound into memory
    // ----------------------------------------------------------------------------------------
    loadSound = async (soundName: string) =>
    {
        return new Promise<void>(async(resolve, reject) => {
            await this.initialization;
            var request = new XMLHttpRequest();
            request.open('GET', soundName, true);
            request.responseType = 'arraybuffer';
        
            // Decode asynchronously
            request.onload = () => {
                this.context?.decodeAudioData(
                    request.response, 
                    (buffer: AudioBuffer ) => { 
                        this.sounds.set(soundName, buffer)
                        resolve()
                    }, 
                    (error: any) => {
                        console.error(`ERROR loading sound: ${soundName}: ${error}`)
                        reject(error);
                    }
                );
            }
            request.onerror = (err) => {
                console.error(`ERROR loading sound: ${soundName}: ${err}`)
                reject(err)
            }
            request.send();        
        })

    }

    // ----------------------------------------------------------------------------------------
    // 
    // ----------------------------------------------------------------------------------------
    async play(soundName: string, options?: SoundPlayOptions)
    {
        if(!this.context) return;
        await this.initialization
        if(!options) options = {} as SoundPlayOptions;

        if(!this.sounds.has(soundName))
        {
            console.log("Error: Tried to play non-existent sound: " + soundName);
            return;
        }

        let sound = this.sounds.get(soundName);
        let source = this.context.createBufferSource();
        source.buffer = sound as AudioBuffer;
        const gainNode = this.context.createGain();
        const volume = options.volume ?? 1.0;
        gainNode.gain.value = volume * volume;
        source.connect(gainNode);
        gainNode.connect(this.context.destination);
        source.start(0);
    }
}

