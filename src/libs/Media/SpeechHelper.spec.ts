import {
  SpeechHelper,
  encodeWavBuffer,
  pickSpeechDevice,
  KokoroLike,
  RawAudioLike,
} from "./SpeechHelper";

// ==========================================================================================
// The speech system sits in front of a neural network that is tens of megabytes and may not
// arrive at all.  What matters is not that it speaks - it is that the GAME never waits for it
// and never breaks because of it:
//
//   * speak() returns immediately, always
//   * anything that is not speech-right-now makes the fallback noise instead
//   * no failure inside it reaches game code
// ==========================================================================================

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// jsdom has no object-URL API, and the real one is a browser concern anyway.
beforeAll(() => {
  (URL as any).createObjectURL = () => "blob:fake";
  (URL as any).revokeObjectURL = () => {};
});

function fakeAudio(): RawAudioLike {
  return { toBlob: () => new Blob(["fake"], { type: "audio/wav" }) };
}

function fakeTts(onGenerate?: (text: string, options?: any) => void): KokoroLike {
  return {
    generate: (text, options) => {
      onGenerate?.(text, options);
      return Promise.resolve(fakeAudio());
    },
  };
}

describe("SpeechHelper before the model has arrived", () => {
  it("makes the fallback noise instead of waiting", () => {
    const spoken: string[] = [];
    // A loader that never settles: the model is still downloading.
    const helper = new SpeechHelper(
      (text) => spoken.push(text),
      () => new Promise(() => {}),
    );

    helper.speak("hello");

    expect(spoken).toEqual(["hello"]);
    expect(helper.isReady).toBe(false);
  });

  it("returns straight away rather than blocking on the download", () => {
    const helper = new SpeechHelper(
      () => {},
      () => new Promise(() => {}),
    );
    const start = Date.now();
    helper.speak("hello");
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("starts the download only once, however much is said", async () => {
    let loads = 0;
    const helper = new SpeechHelper(
      () => {},
      () => {
        loads++;
        return new Promise(() => {});
      },
    );

    helper.speak("one");
    helper.speak("two");
    helper.speak("three");
    await flush();

    expect(loads).toBe(1);
  });
});

describe("SpeechHelper once the model is loaded", () => {
  it("speaks, and stops using the fallback", async () => {
    const spoken: string[] = [];
    const played: string[] = [];
    const said: string[] = [];
    const helper = new SpeechHelper(
      (text) => spoken.push(text),
      async () => fakeTts((text) => said.push(text)),
      (url) => played.push(url),
    );

    helper.warmUp();
    await flush();
    expect(helper.isReady).toBe(true);

    helper.speak("cat");
    await flush();
    await flush();

    expect(said).toEqual(["cat"]);
    expect(played.length).toBe(1);
    expect(spoken).toEqual([]); // no fallback needed once it can really speak
  });

  it("passes the voice and speed through, so the teams sound different", async () => {
    const options: any[] = [];
    const helper = new SpeechHelper(
      () => {},
      async () => fakeTts((_text, o) => options.push(o)),
      () => {},
    );
    helper.warmUp();
    await flush();

    helper.speak("word", { voice: "am_michael", speed: 1.2 });
    await flush();

    expect(options[0].voice).toBe("am_michael");
    expect(options[0].speed).toBe(1.2);
  });
});

describe("SpeechHelper when things go wrong", () => {
  it("falls back for good when the model will not load", async () => {
    const spoken: string[] = [];
    const helper = new SpeechHelper(
      (text) => spoken.push(text),
      async () => {
        throw new Error("offline");
      },
    );

    helper.speak("first");
    await flush();
    helper.speak("second");
    await flush();

    expect(spoken).toEqual(["first", "second"]);
    expect(helper.isReady).toBe(false);
  });

  it("does not retry a hopeless download on every word", async () => {
    let loads = 0;
    const helper = new SpeechHelper(
      () => {},
      async () => {
        loads++;
        throw new Error("offline");
      },
    );

    helper.speak("one");
    await flush();
    helper.speak("two");
    await flush();
    helper.speak("three");
    await flush();

    expect(loads).toBe(1);
  });

  it("falls back when generating the audio throws", async () => {
    const spoken: string[] = [];
    const helper = new SpeechHelper(
      (text) => spoken.push(text),
      async () => ({
        generate: () => Promise.reject(new Error("synthesis blew up")),
      }),
      () => {},
    );
    helper.warmUp();
    await flush();

    helper.speak("boom");
    await flush();
    await flush();

    expect(spoken).toEqual(["boom"]);
  });

  it("does not throw when the fallback itself throws", () => {
    const helper = new SpeechHelper(
      () => {
        throw new Error("no sound either");
      },
      () => new Promise(() => {}),
    );
    // Nothing about speech is worth taking a game down for.
    expect(() => helper.speak("hello")).not.toThrow();
  });

  it("ignores empty text without touching anything", () => {
    let loads = 0;
    const spoken: string[] = [];
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      () => {
        loads++;
        return new Promise(() => {});
      },
    );

    helper.speak("");
    helper.speak("   ");

    expect(spoken).toEqual([]);
    expect(loads).toBe(0);
  });
});

describe("encodeWav", () => {
  it("writes a RIFF/WAVE header the browser will accept", () => {
    const bytes = new Uint8Array(encodeWavBuffer(new Float32Array([0, 0.5, -0.5]), 24000));
    const text = (from: number, length: number) =>
      String.fromCharCode(...Array.from(bytes.slice(from, from + length)));

    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(36, 4)).toBe("data");
    // 44-byte header plus two bytes per sample.
    expect(bytes.length).toBe(44 + 3 * 2);
  });

  it("clamps rather than wrapping, so a hot sample does not crack", () => {
    // 1.5 scaled directly would overflow int16 and come out as a loud click.
    const view = new DataView(encodeWavBuffer(new Float32Array([1.5, -1.5]), 24000));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x7fff);
  });
});

describe("choosing a backend", () => {
  const originalGpu = (navigator as any).gpu;
  afterEach(() => {
    (navigator as any).gpu = originalGpu;
  });

  it("uses wasm when the browser has no WebGPU at all", async () => {
    (navigator as any).gpu = undefined;
    expect(await pickSpeechDevice()).toBe("wasm");
  });

  it("uses wasm when WebGPU exists but has no adapter", async () => {
    // Exactly the headless / no-GPU case.  Getting this wrong meant trying
    // webgpu first, poisoning onnxruntime's backend registration, and leaving
    // the machine with no speech at all rather than falling back.
    (navigator as any).gpu = { requestAdapter: async () => null };
    expect(await pickSpeechDevice()).toBe("wasm");
  });

  it("uses wasm when asking for an adapter throws", async () => {
    (navigator as any).gpu = {
      requestAdapter: async () => {
        throw new Error("no gpu here");
      },
    };
    expect(await pickSpeechDevice()).toBe("wasm");
  });

  it("uses webgpu when an adapter really is available", async () => {
    (navigator as any).gpu = { requestAdapter: async () => ({ name: "fake adapter" }) };
    expect(await pickSpeechDevice()).toBe("webgpu");
  });
});
