declare module "sam-js" {
    export interface SamJsOptions {
        phonetic?: boolean,
        singmode?: boolean,
        debug?: boolean,
        pitch?: number,
        speed?: number,
        mouth?: number,
        throat?: number
    }
    export default class SamJs{
        /**
         * @param {object}  [options]
         * @param {Boolean} [options.phonetic] Default false.
         * @param {Boolean} [options.singmode] Default false.
         * @param {Boolean} [options.debug]    Default false.
         * @param {Number}  [options.pitch]    Default 64.
         * @param {Number}  [options.speed]    Default 72.
         * @param {Number}  [options.mouth]    Default 128.
         * @param {Number}  [options.throat]   Default 128.
         *
         * @constructor
         */
        constructor(options?: SamJsOptions);
        /**
         * Render the passed text as 8bit wave buffer array.
         *
         * @param {string}  text       The text to render or phoneme string.
         * @param {boolean} [phonetic] Flag if the input text is already phonetic data.
         *
         * @return {Uint8Array|Boolean}
         */
        buf8(text: string, phonetic?: boolean);
        /**
         * Render the passed text as 32bit wave buffer array.
         *
         * @param {string}  text       The text to render or phoneme string.
         * @param {boolean} [phonetic] Flag if the input text is already phonetic data.
         *
         * @return {Float32Array|Boolean}
         */
        buf32(text: string, phonetic?: boolean);;
        /**
         * Render the passed text as wave buffer and play it over the speakers.
         *
         * @param {string}  text       The text to render or phoneme string.
         * @param {boolean} [phonetic] Flag if the input text is already phonetic data.
         *
         * @return {Promise}
         */
        speak(text: string, phonetic?: boolean);
        /**
         * Render the passed text as wave buffer and download it via URL API.
         *
         * @param {string}  text       The text to render or phoneme string.
         * @param {boolean} [phonetic] Flag if the input text is already phonetic data.
         *
         * @return void
         */
        download(text: string, phonetic?: boolean);
    }
}