import {
  DEFAULT_SPEECH_ENGINE,
  SPEECH_ENGINE_LIST,
  isSpeechEngineId,
  speechEngineInfo,
} from "./SpeechEngines";
import { WahwahSpeechEngine, hashFraction, syllableCountFor } from "./WahwahSpeechEngine";
import { pickContrastingVoices } from "./BrowserSpeechEngine";
import { getSharedAudioContext, resetSharedAudioContext } from "../audioContext";
import { playExplosion } from "../SoundEffects";

describe("the engine registry", () => {
  it("defaults to the browser's own voice: real words, no download", () => {
    expect(DEFAULT_SPEECH_ENGINE).toBe("browser");
    expect(speechEngineInfo(DEFAULT_SPEECH_ENGINE)!.downloads).toBe(false);
  });

  it("offers every engine exactly once, each with something to read", () => {
    const ids = SPEECH_ENGINE_LIST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(["browser", "wahwah"]);
    for (const engine of SPEECH_ENGINE_LIST) {
      expect(engine.label.length).toBeGreaterThan(0);
      expect(engine.description.length).toBeGreaterThan(0);
    }
  });

  it("offers nothing that costs a download", () => {
    // Kokoro and KittenTTS were removed: tens of megabytes from a CDN, and a two-second
    // freeze of the shared screen per word without a GPU.  If one ever comes back, the
    // `downloads` flag is how the picker warns a host - so this is a decision, not a bug.
    expect(SPEECH_ENGINE_LIST.filter((e) => e.downloads)).toEqual([]);
  });

  it("rejects a saved setting it no longer recognises", () => {
    // Settings outlive the code that wrote them; an engine we dropped must not be honoured.
    expect(isSpeechEngineId("wahwah")).toBe(true);
    expect(isSpeechEngineId("sam")).toBe(false);
    // A host who had picked one of the removed neural engines must land on the default,
    // not on a lookup that returns undefined halfway through a round.
    expect(isSpeechEngineId("kokoro")).toBe(false);
    expect(isSpeechEngineId("kitten")).toBe(false);
    expect(isSpeechEngineId(undefined)).toBe(false);
    expect(isSpeechEngineId(7)).toBe(false);
  });
});

describe("wahwah", () => {
  it("takes longer to say a longer word", () => {
    expect(syllableCountFor("at")).toBeLessThan(syllableCountFor("astonishing"));
  });

  it("always says something, even for one letter", () => {
    expect(syllableCountFor("a")).toBeGreaterThanOrEqual(1);
    expect(syllableCountFor("")).toBeGreaterThanOrEqual(1);
  });

  it("does not run on forever for a sentence", () => {
    const taunt = "In competition, there must be a winner, and we surmise it might as well be us.";
    expect(syllableCountFor(taunt)).toBeLessThanOrEqual(7);
  });

  it("says the same word the same way every time", () => {
    // Otherwise the noise feels random rather than attached to the word.
    expect(hashFraction("otter", 0)).toBe(hashFraction("otter", 0));
    expect(hashFraction("otter", 0)).not.toBe(hashFraction("otter", 1));
    expect(hashFraction("otter", 0)).not.toBe(hashFraction("ottor", 0));
  });

  it("stays inside 0..1 whatever it is given", () => {
    for (const word of ["", "a", "ZZZZZZZZZZZZ", "ünïcödé", "12345"]) {
      const f = hashFraction(word, 3);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("refuses to initialize where there is no Web Audio, rather than going quiet", async () => {
    // jsdom has no AudioContext, which is exactly the browser we are guarding against.
    await expect(new WahwahSpeechEngine().initialize()).rejects.toThrow(/Web Audio/);
  });

  it("never throws out of speak, even with no audio context", async () => {
    await expect(new WahwahSpeechEngine().speak("hello", {})).resolves.toBeUndefined();
  });
});

describe("browser voices", () => {
  const voice = (name: string, lang: string, localService = true) =>
    ({ name, lang, localService }) as SpeechSynthesisVoice;

  it("copes with a machine that has no voices", () => {
    expect(pickContrastingVoices([])).toEqual([undefined, undefined]);
  });

  it("uses the one voice twice rather than leaving a team silent", () => {
    const only = voice("Alex", "en-US");
    expect(pickContrastingVoices([only])).toEqual([only, only]);
  });

  it("picks two different voices when it can", () => {
    const voices = [voice("Alex", "en-US"), voice("Fred", "en-US"), voice("Kate", "en-GB")];
    const [first, second] = pickContrastingVoices(voices);
    expect(first).not.toBe(second);
  });

  it("prefers English voices", () => {
    const voices = [voice("Yuna", "ko-KR"), voice("Alex", "en-US"), voice("Kate", "en-GB")];
    const picked = pickContrastingVoices(voices);
    expect(picked.every((v) => v!.lang.startsWith("en"))).toBe(true);
  });

  it("prefers local voices, which do not need the network per word", () => {
    const voices = [voice("Cloud", "en-US", false), voice("Alex", "en-US", true)];
    const picked = pickContrastingVoices(voices);
    expect(picked.every((v) => v!.localService)).toBe(true);
  });

  it("falls back to non-English rather than picking nothing", () => {
    const voices = [voice("Yuna", "ko-KR"), voice("Milena", "ru-RU")];
    const [first] = pickContrastingVoices(voices);
    expect(first).toBeDefined();
  });
});

// ==========================================================================================
// Sound effects and speech coexist.
//
// They are different subsystems - Web Audio graphs on one side, speechSynthesis on the other -
// and they mix in the output device rather than in the browser, so neither cancels the other.
// The thing that DID silence an effect was our own doing: the shared AudioContext is created
// lazily, autoplay policy hands it back SUSPENDED, and a suspended context does not advance
// currentTime, so anything scheduled on it never plays at all.
// ==========================================================================================
describe("the shared audio context", () => {
  const realAudioContext = (window as any).AudioContext;
  afterEach(() => {
    (window as any).AudioContext = realAudioContext;
    resetSharedAudioContext();
  });

  function fakeContext(state: string) {
    const resumed: string[] = [];
    const ctx = {
      state,
      resume: () => {
        resumed.push("resume");
        ctx.state = "running";
        return Promise.resolve();
      },
    };
    (window as any).AudioContext = function () {
      return ctx;
    };
    return { ctx, resumed };
  }

  it("resumes a context that was born suspended, on the FIRST call", () => {
    // The bug this pins: resuming only happened on the second and later calls, so the very
    // first sound of a session was scheduled onto a stopped clock and silently dropped.
    const { resumed } = fakeContext("suspended");
    getSharedAudioContext();
    expect(resumed).toEqual(["resume"]);
  });

  it("does not bother resuming one that is already running", () => {
    const { resumed } = fakeContext("running");
    getSharedAudioContext();
    expect(resumed).toEqual([]);
  });

  it("hands back the same context every time", () => {
    fakeContext("running");
    expect(getSharedAudioContext()).toBe(getSharedAudioContext());
  });

  it("returns undefined where there is no Web Audio, rather than throwing", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    expect(getSharedAudioContext()).toBeUndefined();
  });

  it("survives a constructor that throws", () => {
    (window as any).AudioContext = function () {
      throw new Error("no device");
    };
    expect(getSharedAudioContext()).toBeUndefined();
  });
});

describe("playExplosion", () => {
  const realAudioContext = (window as any).AudioContext;
  afterEach(() => {
    (window as any).AudioContext = realAudioContext;
    resetSharedAudioContext();
  });

  it("never throws when there is no audio at all", () => {
    (window as any).AudioContext = undefined;
    (window as any).webkitAudioContext = undefined;
    expect(() => playExplosion()).not.toThrow();
  });

  it("builds a crack, a body and a tail - one layer is not an explosion", () => {
    const made: string[] = [];
    const param = () => ({
      value: 0,
      setValueAtTime: () => param(),
      exponentialRampToValueAtTime: () => param(),
      linearRampToValueAtTime: () => param(),
    });
    const node = () => ({
      connect: (next: any) => next,
      start: () => {},
      stop: () => {},
      frequency: param(),
      gain: param(),
      Q: { value: 0 },
      type: "",
      buffer: null as any,
    });
    (window as any).AudioContext = function () {
      return {
        state: "running",
        currentTime: 0,
        sampleRate: 48000,
        destination: {},
        resume: () => Promise.resolve(),
        createBuffer: (_c: number, frames: number) => ({
          getChannelData: () => new Float32Array(frames),
        }),
        createBufferSource: () => (made.push("noise"), node()),
        createOscillator: () => (made.push("osc"), node()),
        createBiquadFilter: () => (made.push("filter"), node()),
        createGain: () => (made.push("gain"), node()),
      };
    };
    playExplosion();
    expect(made.filter((m) => m === "noise").length).toBe(2); // crack + tail
    expect(made.filter((m) => m === "osc").length).toBe(1); // body
    expect(made.filter((m) => m === "gain").length).toBe(3);
  });
});
