
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
            console.warn("Giving up on loading voices...")
        }
    }
    else {
        console.info(`Found ${knownVoices.length} voices`)
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

        console.debug(knownVoices.map(v => v.name).join('\n'))
    }

    speak(text: string, voice: string | number | undefined = undefined) {
        console.debug(`Speaking '${text}' in ${voice}`)
        if(!this.supported) {
            console.warn("Text to speech not supported")
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
                console.warn(`could not find voice '${voice}'`)
            }
            msg.voice = foundVoice ?? knownVoices[0]
        }

        window.speechSynthesis.speak(msg);  
    }
}