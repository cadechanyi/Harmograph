import { describe, it, expect, vi } from "vitest";
import { clampSeek, WebAudioEngine } from "./AudioEngine";

/**
 * Example/unit tests for the Audio_Engine (task 6.3).
 *
 * These verify concrete behaviors of the decode/playback wrapper using a
 * lightweight, controllable AudioContext stub (Web Audio is unavailable under
 * jsdom). The exhaustive seek-clamp property (Property 2) and the full
 * playback lifecycle suite land in tasks 6.4 and 6.5.
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
  /** Simulate the buffer reaching its end. */
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
  decodeResult: { duration: number } | "fail" = { duration: 42 };

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

describe("clampSeek", () => {
  it("returns the requested time when inside [0, duration] (Req 2.3)", () => {
    expect(clampSeek(5, 10)).toBe(5);
    expect(clampSeek(0, 10)).toBe(0);
    expect(clampSeek(10, 10)).toBe(10);
  });

  it("clamps to the nearest boundary when outside the range (Req 2.5)", () => {
    expect(clampSeek(-3, 10)).toBe(0);
    expect(clampSeek(99, 10)).toBe(10);
  });

  it("collapses to 0 for a non-positive or non-finite duration", () => {
    expect(clampSeek(5, 0)).toBe(0);
    expect(clampSeek(5, -1)).toBe(0);
    expect(clampSeek(Number.NaN, 10)).toBe(0);
  });
});

describe("WebAudioEngine.load", () => {
  it("decodes a valid file and reports a positive duration (Req 1.1, 1.6)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);

    const result = await engine.load(fakeFile());

    expect(result).toEqual({ ok: true, durationSeconds: 42 });
    expect(engine.isLoaded()).toBe(true);
    expect(engine.getDuration()).toBe(42);
  });

  it("reports decode_failed for undecodable contents and stays unloaded (Req 1.5)", async () => {
    const ctx = new MockAudioContext();
    ctx.decodeResult = "fail";
    const engine = makeEngine(ctx);

    const result = await engine.load(fakeFile());

    expect(result).toEqual({ ok: false, reason: "decode_failed" });
    expect(engine.isLoaded()).toBe(false);
    expect(engine.getDuration()).toBe(0);
  });

  it("treats a zero-duration decode as decode_failed (Req 1.6)", async () => {
    const ctx = new MockAudioContext();
    ctx.decodeResult = { duration: 0 };
    const engine = makeEngine(ctx);

    const result = await engine.load(fakeFile());

    expect(result).toEqual({ ok: false, reason: "decode_failed" });
    expect(engine.isLoaded()).toBe(false);
  });
});

describe("WebAudioEngine playback", () => {
  it("does not begin playback when no file is loaded (Req 2.6)", () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);

    engine.play();

    expect(ctx.sources).toHaveLength(0);
    expect(engine.getCurrentTime()).toBe(0);
  });

  it("plays from position 0 by default (Req 2.1)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    engine.play();

    expect(ctx.lastSource.started).toBe(0);
  });

  it("reports the live time from the context clock while playing (Req 2.4)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    ctx.currentTime = 100;
    engine.play();
    ctx.currentTime = 102.5; // 2.5s elapsed since play

    expect(engine.getCurrentTime()).toBeCloseTo(2.5, 5);
  });

  it("retains the current position on pause (Req 2.2)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    engine.play();
    ctx.currentTime = 3; // 3s elapsed
    engine.pause();

    expect(ctx.lastSource.stopped).toBe(true);
    expect(engine.getCurrentTime()).toBeCloseTo(3, 5);

    // Position is held after pause even as the context clock advances.
    ctx.currentTime = 9;
    expect(engine.getCurrentTime()).toBeCloseTo(3, 5);
  });

  it("resumes from the retained position after pause (Req 2.1)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    engine.play();
    ctx.currentTime = 4;
    engine.pause();
    engine.play();

    expect(ctx.lastSource.started).toBeCloseTo(4, 5);
  });

  it("seek while playing restarts the source from the clamped position (Req 2.3, 2.5)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile()); // duration 42

    engine.play();
    engine.seek(100); // beyond duration -> clamps to 42

    expect(engine.getCurrentTime()).toBe(42);
    expect(ctx.lastSource.started).toBe(42);
  });

  it("seek while paused updates the retained position only (Req 2.3)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    engine.seek(10);

    expect(engine.getCurrentTime()).toBe(10);
    expect(ctx.sources).toHaveLength(0); // no playback started
  });

  it("suspends at the duration and fires onEnded at natural end (Req 2.7)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile()); // duration 42

    const ended = vi.fn();
    engine.onEnded(ended);

    engine.play();
    ctx.lastSource.fireEnded();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(engine.getCurrentTime()).toBe(42);
  });

  it("does not fire onEnded when a source is stopped for pause (Req 2.7)", async () => {
    const ctx = new MockAudioContext();
    const engine = makeEngine(ctx);
    await engine.load(fakeFile());

    const ended = vi.fn();
    engine.onEnded(ended);

    engine.play();
    const source = ctx.lastSource;
    engine.pause();
    source.fireEnded(); // late 'ended' from the manually stopped node

    expect(ended).not.toHaveBeenCalled();
  });
});
