import Logger from "js-logger";

let knownVoices:SpeechSynthesisVoice[] = [];
let voiceLoadCount = 0;

// It takes a little time for voices to load in the browser;
const loadVoices = () => {
    if(knownVoices.length > 0) return ;
    voiceLoadCount++;
    knownVoices = speechSynthesis.getVoices()
    if(!knownVoices || knownVoices.length === 0) {
        if(voiceLoadCount < 10) {
            setTimeout(loadVoices,voiceLoadCount * 50);
        }
        else {
            Logger.warn("Giving up on loading voices...")
        }
    }
    else {
        Logger.info(`Found ${knownVoices.length} voices`)
    }
}

export class SpeechHelper {

    supported = false


    volume = 1.0;
    rate = 1.0;
    pitch = 1.0;


    constructor() {
        if ('speechSynthesis' in window) {
            this.supported = true;
        }
        loadVoices();

        Logger.debug(knownVoices.map(v => v.name).join('\n'))
    }

    speak(text: string, voice: string | number | undefined = undefined) {
        Logger.debug(`Speaking '${text}' in ${voice}`)
        if(!this.supported) {
            Logger.warn("Text to speech not supported")
            return;
        }
        var msg = new SpeechSynthesisUtterance();
  
        msg.text = text;
        msg.volume = this.volume
        msg.rate = this.rate
        msg.pitch = this.pitch

        if(voice === undefined) voice = 0;

        if(Number.isInteger(voice as number)) {
            msg.voice = knownVoices[voice as number]
        }
        else {
            const foundVoice = knownVoices.find(v => v.name === voice) 
            if(!foundVoice)
            {
                Logger.warn(`could not find voice '${voice}'`)
            }
            msg.voice = foundVoice ?? knownVoices[0]
        }

        window.speechSynthesis.speak(msg);  
    }
}