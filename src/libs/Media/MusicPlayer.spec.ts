import { MusicPlayer, DEFAULT_MUSIC_VOLUME } from "./MusicPlayer";
import { IMusicSource } from "./IMusicSource";
import { ResolvedTrack } from "./MusicLibrary";

// jsdom's media elements do not play, so the element is injected.  What is being pinned
// here is the bookkeeping: that a blocked play() cannot throw into a game, and that every
// path releases the source so object URLs do not pile up over a session.

const track = (id: string): ResolvedTrack => ({
  id,
  file: `tracks/${id}.a91f3c.m4a`,
  title: id,
  seconds: 100,
  bytes: 1000,
  url: `https://music.example.com/tracks/${id}.a91f3c.m4a`,
});

class FakeElement {
  src = "";
  loop = false;
  volume = 1;
  paused = true;
  preload = "";
  playCalls = 0;
  removed = 0;
  playResult: Promise<void> = Promise.resolve();
  play() {
    this.playCalls++;
    return this.playResult.then(() => {
      this.paused = false;
    });
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.removed++;
  }
  load() {}
}

class FakeSource implements IMusicSource {
  released: string[] = [];
  urls: string[] = [];
  failWith: Error | undefined;
  async getPlayableUrl(t: ResolvedTrack) {
    if (this.failWith) throw this.failWith;
    this.urls.push(t.url);
    return `blob:${t.id}`;
  }
  release(t: ResolvedTrack) {
    this.released.push(t.id);
  }
}

function makePlayer(opts?: { defaultVolume?: number }) {
  const element = new FakeElement();
  const source = new FakeSource();
  const player = new MusicPlayer(source, {
    ...opts,
    createElement: () => element as unknown as HTMLAudioElement,
  });
  return { player, element, source };
}

describe("MusicPlayer", () => {
  it("plays the source's URL, under the sound effects by default", async () => {
    const { player, element } = makePlayer();
    await player.play(track("main"));

    expect(element.src).toBe("blob:main");
    expect(element.playCalls).toBe(1);
    expect(element.volume).toBe(DEFAULT_MUSIC_VOLUME);
    expect(player.isPlaying).toBe(true);
    expect(player.currentTrack?.id).toBe("main");
  });

  it("loops only when asked to", async () => {
    const { player, element } = makePlayer();
    await player.play(track("main"));
    expect(element.loop).toBe(false);
    await player.play(track("main"), { loop: true });
    expect(element.loop).toBe(true);
  });

  it("does not throw when the browser blocks playback", async () => {
    const { player, element } = makePlayer();
    element.playResult = Promise.reject(new DOMException("gesture required"));
    await expect(player.play(track("main"))).resolves.toBeUndefined();
    expect(player.isPlaying).toBe(false);
  });

  it("retries a blocked track on the next user input", async () => {
    const { player, element } = makePlayer();
    element.playResult = Promise.reject(new DOMException("gesture required"));
    await player.play(track("main"));
    expect(element.playCalls).toBe(1);

    element.playResult = Promise.resolve();
    document.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    expect(element.playCalls).toBe(2);
  });

  it("does not throw when the source cannot produce a URL", async () => {
    const { player, source, element } = makePlayer();
    source.failWith = new Error("cache exploded");
    await expect(player.play(track("main"))).resolves.toBeUndefined();
    expect(element.playCalls).toBe(0);
  });

  it("releases the previous track when a new one starts", async () => {
    const { player, source } = makePlayer();
    await player.play(track("main"));
    await player.play(track("fast"));
    expect(source.released).toEqual(["main"]);
  });

  it("does not release a track that is simply restarting", async () => {
    const { player, source } = makePlayer();
    await player.play(track("main"));
    await player.play(track("main"));
    expect(source.released).toEqual([]);
  });

  it("stops immediately with no fade", async () => {
    const { player, element } = makePlayer();
    await player.play(track("main"));
    player.stop();
    expect(element.paused).toBe(true);
  });

  it("fades out before pausing", async () => {
    jest.useFakeTimers();
    try {
      const { player, element } = makePlayer();
      await player.play(track("main"));
      player.stop(300);

      // Still audible, and still playing, part way through the fade
      jest.advanceTimersByTime(150);
      expect(element.paused).toBe(false);
      expect(element.volume).toBeGreaterThan(0);
      expect(element.volume).toBeLessThan(DEFAULT_MUSIC_VOLUME);

      jest.advanceTimersByTime(200);
      expect(element.volume).toBe(0);
      expect(element.paused).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("fades in from silence", async () => {
    jest.useFakeTimers();
    try {
      const { player, element } = makePlayer();
      const playing = player.play(track("main"), { fadeInMs: 300 });
      await playing;
      expect(element.volume).toBe(0);
      jest.advanceTimersByTime(400);
      expect(element.volume).toBeCloseTo(DEFAULT_MUSIC_VOLUME);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clamps the volume to 0..1", () => {
    const { player, element } = makePlayer();
    player.setVolume(5);
    expect(element.volume).toBe(1);
    player.setVolume(-2);
    expect(element.volume).toBe(0);
    player.setVolume(0.42);
    expect(element.volume).toBe(0.42);
  });

  it("honours a custom default volume", async () => {
    const { player, element } = makePlayer({ defaultVolume: 0.8 });
    await player.play(track("main"));
    expect(element.volume).toBe(0.8);
  });

  it("disposes idempotently, releasing the source exactly once", async () => {
    const { player, element, source } = makePlayer();
    await player.play(track("main"));
    player.dispose();
    player.dispose();

    expect(element.paused).toBe(true);
    expect(element.removed).toBe(1);
    expect(source.released).toEqual(["main"]);
    expect(player.isPlaying).toBe(false);
  });

  it("ignores a play that is asked for after disposal", async () => {
    const { player, element } = makePlayer();
    player.dispose();
    await player.play(track("main"));
    expect(element.playCalls).toBe(0);
  });

  it("releases a track whose URL arrived after disposal", async () => {
    const { player, source } = makePlayer();
    const playing = player.play(track("main"));
    player.dispose();
    await playing;
    expect(source.released).toEqual(["main"]);
  });
});
