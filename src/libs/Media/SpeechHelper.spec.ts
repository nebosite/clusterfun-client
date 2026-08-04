import { SpeechHelper } from "./SpeechHelper";
import { ISpeechEngine, SpeechEngineId, SpeechVoiceOptions } from "./speech/ISpeechEngine";

// ==========================================================================================
// SpeechHelper owns POLICY, not sound.  It sits in front of an engine that may be a neural
// network tens of megabytes big, or the operating system, or nothing at all.  What matters is
// not that it speaks - it is that the GAME never waits for it and never breaks because of it:
//
//   * speak() returns immediately, always
//   * anything that is not speech-right-now makes the fallback noise instead
//   * no failure inside an engine reaches game code
//   * exactly one word is ever being said at a time
//
// Everything here drives a FAKE engine, so no test touches the network or the audio hardware.
// ==========================================================================================

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tick = async (times = 8) => {
  for (let i = 0; i < times; i++) await flush();
};

/** An engine that records what it was asked to say and finishes instantly. */
function fakeEngine(said: string[], id: SpeechEngineId = "wahwah"): ISpeechEngine {
  return {
    id,
    initialize: async () => {},
    speak: async (text) => {
      said.push(text);
    },
    dispose: () => {},
  };
}

/** An engine whose speak() only completes when the test releases it. */
function gatedEngine() {
  const inFlight: string[] = [];
  const releases: (() => void)[] = [];
  const engine: ISpeechEngine = {
    id: "wahwah",
    initialize: async () => {},
    speak: (text: string) => {
      inFlight.push(text);
      return new Promise<void>((resolve) => releases.push(resolve));
    },
    dispose: () => {},
  };
  return { engine, inFlight, releaseNext: async () => (releases.shift()!(), flush()) };
}

describe("SpeechHelper before an engine is ready", () => {
  it("makes the fallback noise instead of waiting", () => {
    const spoken: string[] = [];
    // A factory that never settles: the engine is still loading.
    const helper = new SpeechHelper(
      (text) => spoken.push(text),
      "wahwah",
      () => new Promise(() => {}),
    );

    const start = Date.now();
    helper.speak("hello");

    expect(spoken).toEqual(["hello"]);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("starts loading only once, however much is said", async () => {
    let loads = 0;
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      () => {
        loads++;
        return new Promise(() => {});
      },
    );

    helper.speak("one");
    helper.speak("two");
    helper.speak("three");
    await tick();

    expect(loads).toBe(1);
  });

  it("asks the factory for the engine the caller chose", async () => {
    const asked: SpeechEngineId[] = [];
    const helper = new SpeechHelper(
      () => {},
      "browser",
      async (id) => {
        asked.push(id);
        return fakeEngine([], id);
      },
    );
    helper.warmUp();
    await tick();

    expect(asked).toEqual(["browser"]);
    expect(helper.currentEngineId).toBe("browser");
  });
});

describe("SpeechHelper once an engine is ready", () => {
  it("speaks, and stops using the fallback", async () => {
    const spoken: string[] = [];
    const said: string[] = [];
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      "wahwah",
      async () => fakeEngine(said),
    );

    helper.warmUp();
    await tick();
    expect(helper.isReady).toBe(true);

    helper.speak("cat");
    await tick();

    expect(said).toEqual(["cat"]);
    expect(spoken).toEqual([]); // no fallback needed once it can really speak
  });

  it("passes the voice and speed through, so the teams sound different", async () => {
    const options: SpeechVoiceOptions[] = [];
    const engine: ISpeechEngine = {
      id: "wahwah",
      initialize: async () => {},
      speak: async (_t, o) => {
        options.push(o);
      },
      dispose: () => {},
    };
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async () => engine,
    );
    helper.warmUp();
    await tick();

    helper.speak("word", { voice: "second", speed: 1.2 });
    await tick();

    expect(options[0].voice).toBe("second");
    expect(options[0].speed).toBe(1.2);
  });
});

describe("SpeechHelper when things go wrong", () => {
  it("falls back for good when the engine will not load", async () => {
    const spoken: string[] = [];
    let attempts = 0;
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      "browser",
      async () => {
        attempts++;
        throw new Error("offline");
      },
    );

    helper.speak("first");
    await tick();
    helper.speak("second");
    await tick();

    expect(spoken).toEqual(["first", "second"]);
    // The point of giving up: a hopeless download is not retried on every word.
    expect(attempts).toBe(1);
  });

  it("falls back when initialize throws, not just the import", async () => {
    const spoken: string[] = [];
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      "browser",
      async () => ({
        id: "browser" as SpeechEngineId,
        initialize: async () => {
          throw new Error("no voices installed");
        },
        speak: async () => {},
        dispose: () => {},
      }),
    );

    helper.speak("hello");
    await tick();
    expect(spoken).toEqual(["hello"]);
    expect(helper.isReady).toBe(false);
  });

  it("beeps and keeps going when one word fails to synthesise", async () => {
    const spoken: string[] = [];
    const said: string[] = [];
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      "wahwah",
      async () => ({
        id: "wahwah" as SpeechEngineId,
        initialize: async () => {},
        speak: async (text: string) => {
          if (text === "bad") throw new Error("nope");
          said.push(text);
        },
        dispose: () => {},
      }),
    );
    helper.warmUp();
    await tick();

    helper.speak("bad");
    helper.speak("good");
    await tick();

    expect(spoken).toEqual(["bad"]);
    expect(said).toEqual(["good"]);
  });

  it("does not throw when the fallback itself throws", () => {
    const helper = new SpeechHelper(
      () => {
        throw new Error("no sound card");
      },
      "wahwah",
      () => new Promise(() => {}),
    );
    expect(() => helper.speak("hello")).not.toThrow();
  });

  it("ignores empty text without touching anything", () => {
    let calls = 0;
    const helper = new SpeechHelper(
      () => calls++,
      "wahwah",
      () => new Promise(() => {}),
    );
    helper.speak("");
    helper.speak("   ");
    expect(calls).toBe(0);
  });
});

// ==========================================================================================
// One word at a time.
//
// Two syntheses in flight share the engine's runtime and come back interleaved, and two clips
// started together simply play over each other.  Either way the room hears mush.  In Lexible
// this is the common case, not the rare one: both teams score constantly, and the win taunt
// is a whole sentence fired off while a word is still being read.
// ==========================================================================================
describe("SpeechHelper serialises speech", () => {
  it("never has two words in flight at once", async () => {
    const gate = gatedEngine();
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async () => gate.engine,
    );
    helper.warmUp();
    await tick();

    helper.speak("first");
    helper.speak("second");
    await tick();

    // The mutation this catches: drop the `draining` guard and both start here.
    expect(gate.inFlight).toEqual(["first"]);

    await gate.releaseNext();
    await tick();
    expect(gate.inFlight).toEqual(["first", "second"]);
  });

  it("speaks them in the order they were said", async () => {
    const said: string[] = [];
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async () => fakeEngine(said),
    );
    helper.warmUp();
    await tick();

    helper.speak("alpha");
    helper.speak("beta");
    helper.speak("gamma");
    await tick(12);

    expect(said).toEqual(["alpha", "beta", "gamma"]);
  });

  it("beeps rather than queues once the backlog is full", async () => {
    const beeped: string[] = [];
    const gate = gatedEngine();
    const helper = new SpeechHelper(
      (t) => beeped.push(t),
      "wahwah",
      async () => gate.engine,
    );
    helper.warmUp();
    await tick();

    // "a" starts speaking; b and c fill the queue; d and e push the oldest out.
    for (const word of ["a", "b", "c", "d", "e"]) helper.speak(word);
    await flush();

    expect(beeped).toEqual(["b", "c"]);
    expect(helper.pendingCount).toBe(2);
  });

  it("recovers when an engine never finishes a word", async () => {
    // A blocked autoplay policy, or an utterance whose "end" never fires, leaves the promise
    // hanging forever.  Without the timeout the queue wedges and the game is silent for the
    // rest of the night.
    jest.useFakeTimers();
    try {
      const said: string[] = [];
      const helper = new SpeechHelper(
        () => {},
        "wahwah",
        async () => ({
          id: "wahwah" as SpeechEngineId,
          initialize: async () => {},
          speak: (text: string) => {
            said.push(text);
            return new Promise<void>(() => {});
          },
          dispose: () => {},
        }),
      );
      helper.warmUp();
      for (let i = 0; i < 8; i++) await Promise.resolve();

      helper.speak("stuck");
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(said).toEqual(["stuck"]);

      jest.advanceTimersByTime(20000);
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // The queue let go of it, so a word said now is still spoken.
      helper.speak("later");
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(said).toEqual(["stuck", "later"]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("SpeechHelper switching engines", () => {
  it("loads the new engine and drops the old one", async () => {
    const disposed: SpeechEngineId[] = [];
    const asked: SpeechEngineId[] = [];
    const said: string[] = [];
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async (id) => {
        asked.push(id);
        return {
          id,
          initialize: async () => {},
          speak: async (t: string) => {
            said.push(`${id}:${t}`);
          },
          dispose: () => disposed.push(id),
        };
      },
    );
    helper.warmUp();
    await tick();
    helper.speak("before");
    await tick();

    helper.setEngine("browser");
    expect(disposed).toEqual(["wahwah"]);
    expect(helper.isReady).toBe(false);

    helper.warmUp();
    await tick();
    helper.speak("after");
    await tick();

    expect(asked).toEqual(["wahwah", "browser"]);
    expect(said).toEqual(["wahwah:before", "browser:after"]);
  });

  it("does nothing when asked for the engine it already has", async () => {
    let loads = 0;
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async (id) => {
        loads++;
        return fakeEngine([], id);
      },
    );
    helper.warmUp();
    await tick();

    helper.setEngine("wahwah");
    helper.warmUp();
    await tick();

    expect(loads).toBe(1);
    expect(helper.isReady).toBe(true);
  });

  it("lets a failed engine be retried by choosing another one", async () => {
    const spoken: string[] = [];
    const said: string[] = [];
    const helper = new SpeechHelper(
      (t) => spoken.push(t),
      "browser",
      async (id) => {
        if (id === "browser") throw new Error("CDN blocked");
        return fakeEngine(said, id);
      },
    );
    helper.speak("nope");
    await tick();
    expect(spoken).toEqual(["nope"]);

    helper.setEngine("wahwah");
    helper.warmUp();
    await tick();
    helper.speak("yes");
    await tick();

    expect(said).toEqual(["yes"]);
  });

  it("discards an engine that finished loading after the host changed their mind", async () => {
    // The slow one must not win a race it started first.
    let releaseSlow: ((e: ISpeechEngine) => void) | undefined;
    const disposed: SpeechEngineId[] = [];
    const helper = new SpeechHelper(
      () => {},
      "browser",
      (id) => {
        if (id === "browser") {
          return new Promise<ISpeechEngine>((resolve) => (releaseSlow = resolve));
        }
        return Promise.resolve(fakeEngine([], id));
      },
    );
    helper.warmUp();
    await tick();

    helper.setEngine("wahwah");
    helper.warmUp();
    await tick();
    expect(helper.currentEngineId).toBe("wahwah");

    releaseSlow!({
      id: "browser",
      initialize: async () => {},
      speak: async () => {},
      dispose: () => disposed.push("browser"),
    });
    await tick();

    expect(disposed).toEqual(["browser"]);
    expect(helper.currentEngineId).toBe("wahwah");
  });

  it("shutdown lets go of the engine", async () => {
    const disposed: SpeechEngineId[] = [];
    const helper = new SpeechHelper(
      () => {},
      "wahwah",
      async (id) => ({
        id,
        initialize: async () => {},
        speak: async () => {},
        dispose: () => disposed.push(id),
      }),
    );
    helper.warmUp();
    await tick();

    helper.shutdown();
    expect(disposed).toEqual(["wahwah"]);
    expect(helper.isReady).toBe(false);
  });
});
