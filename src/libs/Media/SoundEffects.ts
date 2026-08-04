import Logger from "js-logger";
import { getSharedAudioContext } from "./audioContext";

// ==========================================================================================
// Small synthesised sound effects.
//
// Synthesised rather than shipped as files on purpose: an explosion is under a second of
// shaped noise, and the code that makes one is smaller than the mp3 of it - which would also
// have to go down the wire to a phone, and onto the Pi's SD card, for every deploy.
//
// These share the page's AudioContext, and Web Audio is a COMPLETELY SEPARATE PATH from
// speechSynthesis: the two mix in the output device, not in the browser, so an effect and a
// spoken word can play at the same time and neither cancels the other.  What they do compete
// for is the listener - see the loudness note on playExplosion.
//
// Everything here is best-effort.  No Web Audio, a suspended context, a browser that refuses:
// all of them mean silence, never an exception into game code.
// ==========================================================================================

/** White noise into a reusable buffer. */
function noiseBuffer(ctx: AudioContext, seconds: number, shape: (t: number) => number) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * shape(i / frames);
  }
  return buffer;
}

/**
 * The explosion a tile makes when it is taken off the other team - the sound of the firework
 * that goes with it.
 *
 * Three layers, because one is not an explosion:
 *
 *   CRACK  a bright high-passed transient. This is the part that survives being played at
 *          the same time as a spoken word, which is the situation it is always in.
 *   BODY   a sine swept from 160Hz down to 40Hz - the thump you feel more than hear.
 *   TAIL   filtered noise decaying over half a second, so it ends rather than stops.
 *
 * It replaced a single 280ms lowpassed puff at a third of this gain, which was inaudible on
 * television speakers under the word being read out. Loudness here is not decoration: this
 * fires only on a steal, a few times a round, and it is meant to be noticed.
 */
export function playExplosion(volume: number = 0.9) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime + 0.01;

    // --- CRACK -------------------------------------------------------------
    const crack = ctx.createBufferSource();
    crack.buffer = noiseBuffer(ctx, 0.09, (t) => Math.pow(1 - t, 2));
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 1200;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(volume, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    crack.connect(crackFilter).connect(crackGain).connect(ctx.destination);
    crack.start(now);
    crack.stop(now + 0.1);

    // --- BODY --------------------------------------------------------------
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(160, now);
    body.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(volume * 0.8, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    body.connect(bodyGain).connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.35);

    // --- TAIL --------------------------------------------------------------
    const tail = ctx.createBufferSource();
    tail.buffer = noiseBuffer(ctx, 0.55, (t) => Math.pow(1 - t, 3));
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = "bandpass";
    tailFilter.frequency.setValueAtTime(2400, now);
    tailFilter.frequency.exponentialRampToValueAtTime(400, now + 0.55);
    tailFilter.Q.value = 0.8;
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(volume * 0.55, now + 0.02);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    tail.connect(tailFilter).connect(tailGain).connect(ctx.destination);
    tail.start(now + 0.02);
    tail.stop(now + 0.6);
  } catch (err) {
    Logger.warn(`Could not play the explosion: ${err}`);
  }
}
