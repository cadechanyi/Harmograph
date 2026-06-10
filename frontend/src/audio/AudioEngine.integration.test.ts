import { describe, it, expect, vi } from "vitest";
import { WebAudioEngine } from "./AudioEngine";

/**
 * Integration tests for browser audio (task 6.6).
 *
 * These exercise the Audio_Engine end to end — `File.arrayBuffer()` → decode →
 * load result → playback clock — using inputs and a decoder that are as close
 * to "real" as is feasible under jsdom.
 *
 * jsdom limitation: the real Web Audio API (`AudioContext`/`decodeAudioData`)
 * is NOT implemented under jsdom, and jsdom's `File`/`Blob` does not implement
 * `arrayBuffer()` either, so a genuine browser decode cannot run here. To keep
 * the test faithful we build a REAL, well-formed WAV byte stream (via
 * `buildWavFile`), carry those exact bytes through a `File` (supplying the
 * jsdom-missing `arrayBuffer()` so the real bytes reach the decoder), and
 * decode them with a `FaithfulWavContext` double whose `decodeAudioData`
 * actually parses the RIFF/WAVE header and derives the duration the same way a
 * real decoder would (data-chunk bytes ÷ byte-rate). Wherever a real-browser
 * behavior is stood in for by a double, it is called out with a "jsdom:"
 * comment below. The full-fidelity browser pass (real `AudioContext` and real
 * `File.arrayBuffer()`) belongs in an e2e/browser harness outside jsdom.
 *
 * Coverage:
 *   - Req 1.1 / 1.6: a valid WAV loads → { ok: true, durationSeconds > 0 }.
 *   - Req 1.5:       a corrupt/undecodable file → { ok: false, decode_failed }
 *                    and the engine stays unloaded.
 *   - Req 2.4:       getCurrentTime can be polled at ≥ 30 Hz and tracks the
 *                    advancing playback clock.
 */

// --- Real WAV byte construction ---------------------------------------------

/**
 * Build a real, standards-compliant 16-bit PCM WAV file as bytes.
 *
 * The bytes are a genuine RIFF/WAVE container (not a stub), so the decoder
 * below performs an authentic header parse to recover the duration.
 */
function buildWavFile(opts: {
  durationSeconds: number;
  sampleRate?: number;
  channels?: number;
}): Uint8Array {
  const sampleRate = opts.sampleRate ?? 44100;
  const channels = opts.channels ?? 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.round(opts.durationSeconds * sampleRate);
  const dataSize = frameCount * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // chunk size
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  // A quiet sine so the PCM region is real audio data, not zero padding.
  for (let frame = 0; frame < frameCount; frame += 1) {
    const t = frame / sampleRate;
    const amplitude = Math.round(Math.sin(2 * Math.PI * 220 * t) * 8000);
    for (let ch = 0; ch < channels; ch += 1) {
      view.setInt16(44 + (frame * channels + ch) * bytesPerSample, amplitude, true);
    }
  }

  return new Uint8Array(buffer);
}

/** An AudioBuffer-like object, mirroring the shape the engine reads. */
interface DecodedBuffer {
  duration: number;
  sampleRate: number;
  length: number;
  numberOfChannels: number;
}

/**
 * Authentic WAV header parse — the same arithmetic a real decoder uses to
 * report duration. Throws on anything that is not a decodable WAV, exactly as
 * `decodeAudioData` would reject undecodable contents.
 */
function decodeWavHeader(bytes: Uint8Array): DecodedBuffer {
  if (bytes.byteLength < 44) {
    throw new Error("too short to be a WAV");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, len: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(offset, offset + len)));

  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE container");
  }

  // Walk the chunk list to find `fmt ` and `data` (faithful to real parsing).
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = -1;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      sampleRate = view.getUint32(offset + 12, true);
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === "data") {
      dataSize = size;
    }
    offset += 8 + size;
  }

  if (sampleRate <= 0 || byteRate <= 0 || dataSize < 0) {
    throw new Error("missing fmt/data chunk");
  }

  const duration = dataSize / byteRate;
  return {
    duration,
    sampleRate,
    length: Math.round(duration * sampleRate),
    numberOfChannels: 1,
  };
}

// --- jsdom AudioContext double ----------------------------------------------

/** A single-use source node stub (jsdom: no real AudioBufferSourceNode). */
class IntegrationSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

/**
 * A faithful AudioContext double.
 *
 * jsdom: the browser `AudioContext` is unavailable, so this stands in for it.
 * It is deliberately faithful — `decodeAudioData` performs a real WAV header
 * parse rather than returning a canned duration, and `currentTime` is an
 * explicit clock the test advances to simulate the audio hardware clock.
 */
class FaithfulWavContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => Promise.resolve());

  decodeAudioData(
    data: ArrayBuffer,
    onOk?: (b: unknown) => void,
    onErr?: (e: unknown) => void,
  ): Promise<unknown> {
    try {
      const decoded = decodeWavHeader(new Uint8Array(data));
      onOk?.(decoded);
      return Promise.resolve(decoded);
    } catch (err) {
      onErr?.(err);
      return Promise.reject(err instanceof Error ? err : new Error("decode_failed"));
    }
  }

  createBufferSource(): IntegrationSource {
    return new IntegrationSource();
  }
}

function makeEngine(ctx: FaithfulWavContext): WebAudioEngine {
  return new WebAudioEngine({
    audioContextFactory: () => ctx as unknown as AudioContext,
  });
}

/** Wrap real WAV bytes in a File whose `arrayBuffer()` yields those bytes. */
function wavFile(bytes: Uint8Array, name = "song.wav"): File {
  // jsdom: its `Blob`/`File` does not implement `arrayBuffer()` (the method the
  // engine calls), so a plain `new File([bytes])` would make decode throw for
  // reasons unrelated to the audio. We therefore construct a real `File` for
  // its name/type/size metadata and attach an `arrayBuffer()` that returns the
  // SAME real WAV bytes built above. The byte stream flowing into the decoder
  // is genuine and the header parse below is authentic; only the jsdom-missing
  // transport method is supplied. In a real browser `File.arrayBuffer()` exists
  // and this shim is unnecessary.
  const file = new File([bytes], name, { type: "audio/wav" });
  const copy = bytes.slice();
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: () =>
      Promise.resolve(
        copy.buffer.slice(
          copy.byteOffset,
          copy.byteOffset + copy.byteLength,
        ) as ArrayBuffer,
      ),
  });
  return file;
}

describe("AudioEngine integration — loading real audio (Req 1.1, 1.6)", () => {
  it("loads a real WAV and reports a positive duration from the parsed header", async () => {
    const wavBytes = buildWavFile({ durationSeconds: 3, sampleRate: 44100 });
    const engine = makeEngine(new FaithfulWavContext());

    const result = await engine.load(wavFile(wavBytes));

    expect(result.ok).toBe(true);
    if (result.ok) {
      // 3 s of 44.1 kHz mono 16-bit audio → duration parsed back as ~3 s.
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(result.durationSeconds).toBeCloseTo(3, 3);
    }
    expect(engine.isLoaded()).toBe(true);
    expect(engine.getDuration()).toBeGreaterThan(0);
    expect(engine.getDuration()).toBeCloseTo(3, 3);
  });

  it("recovers the duration of a different real WAV (stereo, 48 kHz)", async () => {
    const wavBytes = buildWavFile({
      durationSeconds: 1.5,
      sampleRate: 48000,
      channels: 2,
    });
    const engine = makeEngine(new FaithfulWavContext());

    const result = await engine.load(wavFile(wavBytes));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationSeconds).toBeCloseTo(1.5, 3);
    }
  });
});

describe("AudioEngine integration — corrupt audio (Req 1.5)", () => {
  it("rejects undecodable contents with decode_failed and stays unloaded", async () => {
    // Real bytes, but not a valid WAV container: a genuine decode failure.
    const garbage = new Uint8Array(2048);
    for (let i = 0; i < garbage.length; i += 1) {
      garbage[i] = (i * 37 + 11) & 0xff;
    }
    const engine = makeEngine(new FaithfulWavContext());

    const result = await engine.load(wavFile(garbage, "broken.wav"));

    expect(result).toEqual({ ok: false, reason: "decode_failed" });
    expect(engine.isLoaded()).toBe(false);
    expect(engine.getDuration()).toBe(0);
  });

  it("rejects a WAV whose header is truncated", async () => {
    const wavBytes = buildWavFile({ durationSeconds: 2 });
    const truncated = wavBytes.subarray(0, 20); // header chopped off
    const engine = makeEngine(new FaithfulWavContext());

    const result = await engine.load(wavFile(truncated, "truncated.wav"));

    expect(result).toEqual({ ok: false, reason: "decode_failed" });
    expect(engine.isLoaded()).toBe(false);
  });
});

describe("AudioEngine integration — getCurrentTime cadence ≥ 30 Hz (Req 2.4)", () => {
  it("can be polled at ≥ 30 Hz and tracks the advancing playback clock", async () => {
    const wavBytes = buildWavFile({ durationSeconds: 10, sampleRate: 44100 });
    const ctx = new FaithfulWavContext();
    const engine = makeEngine(ctx);
    await engine.load(wavFile(wavBytes));

    engine.play();

    // jsdom: there is no real audio hardware clock, so we drive `currentTime`
    // forward in fixed 1/30 s steps to simulate one second of playback and
    // poll getCurrentTime once per step. 30 fresh samples across one simulated
    // second demonstrates the value updates/can be read at ≥ 30 Hz (Req 2.4).
    const hz = 30;
    const dt = 1 / hz;
    const startContextTime = ctx.currentTime;
    const samples: number[] = [];

    for (let i = 1; i <= hz; i += 1) {
      ctx.currentTime = startContextTime + i * dt;
      samples.push(engine.getCurrentTime());
    }

    // We obtained at least 30 readings within one simulated second of playback.
    expect(samples).toHaveLength(hz);

    // Every reading is fresh (strictly advancing) — no staleness/quantization
    // that would drop the effective update rate below 30 Hz.
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }

    // Each reading tracks the elapsed context time it was sampled at.
    for (let i = 0; i < samples.length; i += 1) {
      expect(samples[i]).toBeCloseTo((i + 1) * dt, 5);
    }

    // The per-sample spacing is ~1/30 s, confirming the ≥ 30 Hz cadence.
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i] - samples[i - 1]).toBeCloseTo(dt, 5);
    }
  });

  it("reflects sub-frame clock movement between polls (live, not frame-quantized)", async () => {
    const wavBytes = buildWavFile({ durationSeconds: 10 });
    const ctx = new FaithfulWavContext();
    const engine = makeEngine(ctx);
    await engine.load(wavFile(wavBytes));

    engine.play();

    // Two polls spaced well under one 30 Hz frame (1/120 s) must still differ,
    // showing getCurrentTime derives from the live clock rather than a capped
    // internal tick (Req 2.4).
    const fineDt = 1 / 120;
    const before = engine.getCurrentTime();
    ctx.currentTime += fineDt;
    const after = engine.getCurrentTime();

    expect(after - before).toBeCloseTo(fineDt, 5);
  });
});
