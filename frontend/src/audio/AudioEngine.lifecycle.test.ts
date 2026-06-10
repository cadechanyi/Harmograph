import { describe, it, expect, vi } from "vitest";
import { WebAudioEngine } from "./AudioEngine";

/**
 * Playback-lifecycle unit/example tests for the Audio_Engine (task 6.5).
 *
 * Where AudioEngine.test.ts checks individual operations in isolation, this
 * file walks the engine through complete playback lifecycles and asserts the
 * four requirement-anchored behaviors end to end:
 *
 *   - Req 2.1  play-from-zero default position
 *   - Req 2.2  pause retains the current position (and resume continues from it)
 *   - Req 2.6  play with no file loaded is guarded, and the unloaded condition
 *              is observable so the Frontend can display "no audio file loaded"
 *   - Req 2.7  end-of-song suspends playback, retaining the position at duration
 *
 * Web Audio is unavailable under jsdom, so the engine is driven through the
 * same controllable AudioContext stub pattern used by AudioEngine.test.ts
 * (manually advanced clock, triggerable `onended`).
 */

/** A controllable AudioBufferSourceNode stub. */
class MockSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started: number | null = null;
  stopped = false;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn((_when?: number, offset?: number) => {
    this.started = offset ?? 0;
  });
  stop = vi.fn(() => {
    this.stopped = true;
  });
  /** Simulate the buffer reaching its natural end. */
  fireEnded() {
    this.onended?.();
  }
}

/** A controllable AudioContext stub with a manually advanced clock. */
class MockAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());
  sources: MockSource[] = [];
  /** Decoded buffer to hand back; configurable per test. */
  decodeResult: { duration: number } | "fail" = { duration: 60 };

  createBufferSource(): MockSource {
    const s = new MockSource();
    this.sources.push(s);
    return s;
  }

  decodeAudioData(
    _data: ArrayBuffer,
    onOk?: (b: unknown) => void,
    onErr?: (e: unknown) => void,
  ): Promise<unknown> {
    if (this.decodeResult === "fail") {
      const err = new Error("decode_failed");
      onErr?.(err);
      return Promise.reject(err);
    }
    const buffer = this.decodeResult;
    onOk?.(buffer);
    return Promise.resolve(buffer);
  }

  /** The most recently created source node. */
  get lastSource(): MockSource {
    return this.sources[this.sources.length - 1];
  }
}

/** A minimal File-like with an arrayBuffer() method for jsdom. */
function fakeFile(): File {
  return {
    name: "song.wav",
    type: "audio/wav",
    size: 1024,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as File;
}

function makeEngine(ctx: MockAudioContext): WebAudioEngine {
  return new WebAudioEngine({
    audioContextFactory: () => ctx as unknown as AudioContext,
  });
}

describe("Audio_Engine playback lifecycle", () => {
  describe("play-from-zero default (Req 2.1)", () => {
    it("starts a freshly loaded song at position 0 with no prior seek or playback", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile());

      // Before any playback the current position defaults to 0.
      expect(engine.getCurrentTime()).toBe(0);

      ctx.currentTime = 10; // arbitrary context clock offset at play time
      engine.play();

      // The source begins from the buffer's start, and the live position
      // measured from the clock is 0 at the instant playback begins.
      expect(ctx.lastSource.started).toBe(0);
      expect(engine.getCurrentTime()).toBe(0);
    });

    it("keeps the default position at 0 even when the context clock is already non-zero", async () => {
      const ctx = new MockAudioContext();
      ctx.currentTime = 123.4; // clock running before the engine ever plays
      const engine = makeEngine(ctx);
      await engine.load(fakeFile());

      // A non-zero clock must not leak into the default playback position.
      expect(engine.getCurrentTime()).toBe(0);
      engine.play();
      expect(ctx.lastSource.started).toBe(0);
    });
  });

  describe("pause retains position (Req 2.2)", () => {
    it("holds the position through pause and resumes playback from it", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile()); // duration 60

      engine.play();
      ctx.currentTime = 12; // 12s of playback elapsed
      engine.pause();

      // The retained position equals the elapsed playback time and is held
      // even as the context clock keeps advancing while paused.
      expect(engine.getCurrentTime()).toBeCloseTo(12, 5);
      ctx.currentTime = 30;
      expect(engine.getCurrentTime()).toBeCloseTo(12, 5);

      // Resuming starts a new source from the retained offset, and playback
      // time continues forward from there.
      engine.play();
      expect(ctx.lastSource.started).toBeCloseTo(12, 5);
      ctx.currentTime = 35; // 5s past the resume point (clock was 30 at resume)
      expect(engine.getCurrentTime()).toBeCloseTo(17, 5);
    });

    it("survives repeated pause/resume cycles, accumulating only played time", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile());

      engine.play(); // clock 0
      ctx.currentTime = 5;
      engine.pause(); // retained 5
      expect(engine.getCurrentTime()).toBeCloseTo(5, 5);

      ctx.currentTime = 100; // long idle while paused — must not count
      engine.play(); // resume from 5 at clock 100
      ctx.currentTime = 107;
      engine.pause(); // retained 5 + 7 = 12
      expect(engine.getCurrentTime()).toBeCloseTo(12, 5);
    });
  });

  describe("play with no file loaded guard (Req 2.6)", () => {
    it("does not begin playback and the unloaded state is observable for the UI message", () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);

      // The Frontend keys the "no audio file loaded" message off isLoaded().
      expect(engine.isLoaded()).toBe(false);

      engine.play();

      // No source node was created and the position never advances.
      expect(ctx.sources).toHaveLength(0);
      expect(engine.getCurrentTime()).toBe(0);
      expect(engine.isLoaded()).toBe(false);
    });

    it("remains guarded after a failed decode, then plays once a valid file loads", async () => {
      const ctx = new MockAudioContext();
      ctx.decodeResult = "fail";
      const engine = makeEngine(ctx);

      const failed = await engine.load(fakeFile());
      expect(failed.ok).toBe(false);
      expect(engine.isLoaded()).toBe(false);

      engine.play(); // still no file loaded -> guarded
      expect(ctx.sources).toHaveLength(0);

      // A subsequent successful load lifts the guard.
      ctx.decodeResult = { duration: 60 };
      const ok = await engine.load(fakeFile());
      expect(ok.ok).toBe(true);
      expect(engine.isLoaded()).toBe(true);

      engine.play();
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.lastSource.started).toBe(0);
    });
  });

  describe("end-of-song suspend (Req 2.7)", () => {
    it("suspends at the duration, retains the position, and notifies subscribers", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile()); // duration 60

      const ended = vi.fn();
      engine.onEnded(ended);

      engine.play();
      ctx.lastSource.fireEnded(); // natural end of the buffer

      // Playback is suspended with the position pinned at the song duration,
      // and that position is held as the context clock continues to advance.
      expect(engine.getCurrentTime()).toBe(60);
      ctx.currentTime = 90;
      expect(engine.getCurrentTime()).toBe(60);
      expect(ended).toHaveBeenCalledTimes(1);
    });

    it("notifies every registered onEnded subscriber exactly once", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile());

      const a = vi.fn();
      const b = vi.fn();
      engine.onEnded(a);
      engine.onEnded(b);

      engine.play();
      ctx.lastSource.fireEnded();

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it("can replay from the retained end position after a natural end", async () => {
      const ctx = new MockAudioContext();
      const engine = makeEngine(ctx);
      await engine.load(fakeFile()); // duration 60

      engine.play();
      ctx.lastSource.fireEnded();
      expect(engine.getCurrentTime()).toBe(60);

      // Pressing play again resumes from the retained end position (Req 2.1
      // semantics: play begins from the current position, here the duration).
      engine.play();
      expect(ctx.lastSource.started).toBe(60);
    });
  });
});
