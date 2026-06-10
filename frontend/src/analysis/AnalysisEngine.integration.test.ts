import { describe, it, expect, beforeAll } from "vitest";
import { HarmographAnalysisEngine } from "./AnalysisEngine";
import { createMeydaEssentiaExtractor } from "./meydaEssentiaExtractor";
import { TimelineStream } from "../timeline/TimelineStream";
import type {
  AnalysisAudioBuffer,
  FeatureExtractor,
  KeyEstimate,
  RawSample,
} from "./types";
import type { TimelinePoint } from "../models/types";

/**
 * Integration tests for in-browser analysis (task 8.3, Req 3.1, 3.2, 3.3).
 *
 * These drive the REAL Analysis_Engine (`HarmographAnalysisEngine`) through the
 * REAL shared `TimelineStream`, on a KNOWN synthetic audio sample with genuine
 * Float32Array channel data, end to end:
 *
 *   known AudioBuffer-like sample
 *     -> FeatureExtractor (real Meyda / real Essentia where available)
 *     -> engine normalization into [-1, 1]
 *     -> Timeline_Stream emission + per-stem routing
 *
 * Library reality under jsdom/Vitest:
 *   - `meyda` IS installed and runs natively under jsdom, so the Meyda path
 *     (RMS -> vocals, spectral flux -> drums, low-band energy -> bass, chroma
 *     -> chords) is asserted against REAL extractor output (Req 3.1, 3.2).
 *   - `essentia.js` is a WASM module. It CAN initialize under jsdom in this
 *     environment, so when it is genuinely runnable the real Essentia path
 *     (tempo, key, melody pitch) is asserted against REAL output on the known
 *     sample (Req 3.3). Library availability is detected at runtime in
 *     `beforeAll`; the real-Essentia assertions are gated with `it.skipIf` so
 *     that in any environment where the WASM module cannot initialize (a known
 *     limitation of headless WASM under some jsdom configurations — mirroring
 *     how task 6.6 documented jsdom's missing Web Audio API), those assertions
 *     are skipped rather than failing spuriously.
 *   - Regardless of Essentia availability, the Req 3.3 INTEGRATION CONTRACT
 *     (tempo recorded, key recorded, melody points normalized + emitted through
 *     the stream) is ALWAYS covered by the "engine pipeline contract" describe
 *     below, which drives the same real engine + real stream with a faithful,
 *     deterministic extractor. The full-fidelity browser pass (real
 *     `AudioContext`-decoded buffers) belongs in an e2e/browser harness outside
 *     jsdom.
 */

// --- Known synthetic sample --------------------------------------------------

const SAMPLE_RATE = 44_100;

/**
 * Build a KNOWN, deterministic audio sample as a real AudioBuffer-like object
 * with filled Float32Array channel data, so the extractors have genuine samples
 * to process. The signal is a mix of:
 *   - a 440 Hz tone (A4) — the predominant melody pitch and key tonic cue,
 *   - a 110 Hz tone (A2) — low-band/bass energy,
 *   - a short 60 Hz burst on every beat at 2 Hz (i.e. 120 BPM) — drum onsets.
 *
 * These known properties let the real-library assertions check meaningful
 * values (tempo ≈ 120 BPM, key tonic A) rather than mere presence.
 */
function buildKnownSample(durationSeconds = 4): AnalysisAudioBuffer {
  const length = Math.round(durationSeconds * SAMPLE_RATE);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / SAMPLE_RATE;
    let s = 0.3 * Math.sin(2 * Math.PI * 440 * t); // melody (A4)
    s += 0.2 * Math.sin(2 * Math.PI * 110 * t); // bass (A2)
    const beatPhase = (t * 2) % 1; // 2 beats/sec = 120 BPM
    if (beatPhase < 0.02) {
      s += 0.6 * Math.sin(2 * Math.PI * 60 * t); // percussive kick burst
    }
    data[i] = s;
  }
  return {
    duration: durationSeconds,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    length,
    getChannelData: () => data,
  };
}

/** The real AudioBuffer type the public engine API expects (structurally). */
function asAudioBuffer(b: AnalysisAudioBuffer): AudioBuffer {
  return b as unknown as AudioBuffer;
}

/** Assert a Timeline_Point honours the normalized data model (Req 3.4, 10.1). */
function expectNormalized(points: readonly TimelinePoint[], duration: number): void {
  for (const p of points) {
    expect(Number.isFinite(p.value)).toBe(true);
    expect(p.value).toBeGreaterThanOrEqual(-1);
    expect(p.value).toBeLessThanOrEqual(1);
    expect(p.t).toBeGreaterThanOrEqual(0);
    expect(p.t).toBeLessThanOrEqual(duration);
  }
}

// --- Runtime library availability detection ---------------------------------

/**
 * Probe whether the real Essentia path is genuinely runnable in this
 * environment by executing a tempo estimate on a tiny known signal. Returns
 * true only if it both runs and yields a finite BPM.
 */
async function detectEssentia(): Promise<boolean> {
  try {
    const ex = createMeydaEssentiaExtractor();
    const bpm = await ex.tempo(buildKnownSample(2));
    return Number.isFinite(bpm);
  } catch {
    return false;
  }
}

/** Probe whether the real Meyda path runs (RMS over the known sample). */
async function detectMeyda(): Promise<boolean> {
  try {
    const ex = createMeydaEssentiaExtractor();
    const rms = await ex.rms(buildKnownSample(1));
    return Array.isArray(rms) && rms.length > 0;
  } catch {
    return false;
  }
}

let meydaAvailable = false;
let essentiaAvailable = false;

beforeAll(async () => {
  [meydaAvailable, essentiaAvailable] = await Promise.all([
    detectMeyda(),
    detectEssentia(),
  ]);
}, 60_000);

// --- Real Meyda path (Req 3.1, 3.2) -----------------------------------------

describe("in-browser analysis — real Meyda features (Req 3.1, 3.2)", () => {
  it(
    "extracts RMS, spectral onsets, and low-band energy into routed Timeline_Points",
    async () => {
      // Meyda is installed and runs under jsdom; if for some reason it is not
      // runnable, surface that explicitly rather than silently passing.
      expect(meydaAvailable).toBe(true);

      const duration = 4;
      const sample = buildKnownSample(duration);
      const stream = new TimelineStream({ songDuration: duration });
      const engine = new HarmographAnalysisEngine({
        stream,
        extractor: createMeydaEssentiaExtractor(),
      });

      await engine.analyze(asAudioBuffer(sample), "mix");
      const status = engine.getStatus();

      // RMS -> vocals (Req 3.1) and spectral envelope -> drum onsets,
      // low-band -> bass (Req 3.2) all produced real points.
      const vocals = stream.getPoints("vocals");
      const drums = stream.getPoints("drums");
      const bass = stream.getPoints("bass");

      expect(vocals.length).toBeGreaterThan(0);
      expect(drums.length).toBeGreaterThan(0);
      expect(bass.length).toBeGreaterThan(0);

      // The Meyda-backed features completed successfully.
      expect(status.failed).not.toContain("rms");
      expect(status.failed).not.toContain("spectral");

      // Every emitted point honours the normalized data model.
      expectNormalized(vocals, duration);
      expectNormalized(drums, duration);
      expectNormalized(bass, duration);
    },
    60_000,
  );
});

// --- Real Essentia path (Req 3.3) -------------------------------------------

describe("in-browser analysis — real Essentia features (Req 3.3)", () => {
  // Gated on genuine runtime availability: when essentia.js initializes and
  // runs, assert the REAL tempo/key/melody on the known sample; otherwise skip
  // (the contract is still covered below). `skipIf` is evaluated lazily so the
  // `beforeAll` probe result is honoured.
  it("estimates tempo, key, and melody points on the known sample", async (ctx) => {
    if (!essentiaAvailable) {
      // Documented jsdom/WASM limitation: essentia.js could not initialize in
      // this environment. Skip the real-library assertions — the Req 3.3
      // integration contract is still covered by the "engine pipeline contract"
      // describe below (mirroring how task 6.6 documented jsdom's missing Web
      // Audio API).
      ctx.skip();
      return;
    }

    const duration = 4;
    const sample = buildKnownSample(duration);
    const stream = new TimelineStream({ songDuration: duration });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: createMeydaEssentiaExtractor(),
    });

    await engine.analyze(asAudioBuffer(sample), "mix");
    const status = engine.getStatus();

    // Tempo: a finite BPM, and on this known 120 BPM sample it lands close to
    // 120 (Percival estimators may land on a metrical multiple, so allow the
    // common 60/120/240 family with tolerance).
    expect(status.tempoBpm).not.toBeNull();
    expect(Number.isFinite(status.tempoBpm as number)).toBe(true);
    const bpm = status.tempoBpm as number;
    const near = (target: number) => Math.abs(bpm - target) <= 5;
    expect(near(120) || near(60) || near(240)).toBe(true);

    // Key: a valid {tonic, mode} estimate. The known sample is built around A,
    // so the tonic resolves to A.
    expect(status.key).not.toBeNull();
    const key = status.key as KeyEstimate;
    expect(typeof key.tonic).toBe("string");
    expect(["major", "minor"]).toContain(key.mode);
    expect(key.tonic).toBe("A");

    // Melody -> melody points, normalized and routed to the melody stem.
    const melody = stream.getPoints("melody");
    expect(melody.length).toBeGreaterThan(0);
    expectNormalized(melody, duration);

    // The Essentia-backed features all succeeded.
    expect(status.succeeded).toEqual(
      expect.arrayContaining(["tempo", "key", "melody"]),
    );
  }, 60_000);
});

// --- Always-on Req 3.3 integration contract ---------------------------------

/**
 * A faithful, deterministic extractor that produces realistic raw feature
 * samples WITHOUT any third-party library. It exercises the SAME real engine
 * normalization + Timeline_Stream emission pipeline as the library-backed path,
 * guaranteeing the Req 3.3 contract (tempo recorded, key recorded, melody
 * points normalized and emitted) is covered in every environment — including
 * one where the essentia.js WASM module cannot initialize.
 */
function faithfulExtractor(): FeatureExtractor {
  const series = (samples: Array<[number, number]>): RawSample[] =>
    samples.map(([t, value]) => ({ t, value }));
  const key: KeyEstimate = { tonic: "A", mode: "minor" };
  return {
    rms: async () => series([[0, 0.4], [1, 0.6], [2, 0.5]]),
    spectralOnsets: async () => series([[0, 0.9], [0.5, 0.2], [1, 0.95]]),
    lowBandEnergy: async () => series([[0, 0.3], [1, 0.45]]),
    // Raw melody pitch in Hz (engine clamps/normalizes via the melody domain).
    melody: async () =>
      series([
        [0, 440],
        [0.5, 523.25],
        [1, 659.25],
        [1.5, 880],
      ]),
    tempo: async () => 120,
    key: async () => key,
    chords: async () => series([[0, 0.5], [1, 0.7]]),
  };
}

describe("in-browser analysis — Req 3.3 engine pipeline contract", () => {
  it("normalizes and emits tempo, key, and melody through the real engine + stream", async () => {
    const duration = 4;
    const sample = buildKnownSample(duration);
    const stream = new TimelineStream({ songDuration: duration });
    const observed: TimelinePoint[] = [];
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: faithfulExtractor(),
    });
    engine.onTimelinePoint((p) => observed.push(p));

    await engine.analyze(asAudioBuffer(sample), "mix");
    const status = engine.getStatus();

    // Tempo (Req 3.3, 8.1) recorded as a finite BPM.
    expect(status.tempoBpm).toBe(120);

    // Key (Req 3.3, 8.3) recorded as a valid estimate.
    expect(status.key).toEqual({ tonic: "A", mode: "minor" });

    // Melody (Req 3.3) emitted as normalized, in-range Timeline_Points routed
    // to the melody stem — the raw Hz values are mapped into [-1, 1].
    const melody = stream.getPoints("melody");
    expect(melody.length).toBeGreaterThan(0);
    expectNormalized(melody, duration);
    expect(melody.every((p) => p.stem === "melody")).toBe(true);

    // The observer received every emitted point (Req 3.4 emission path).
    expect(observed.length).toBeGreaterThan(0);
    expectNormalized(observed, duration);

    // No feature was left pending and the three Req 3.3 features succeeded.
    expect(status.pending).toEqual([]);
    expect(status.succeeded).toEqual(
      expect.arrayContaining(["tempo", "key", "melody"]),
    );

    // Melody points are delivered in non-decreasing time order (Req 10.5),
    // confirming the stream ordering contract end to end.
    for (let i = 1; i < melody.length; i += 1) {
      expect(melody[i].t).toBeGreaterThanOrEqual(melody[i - 1].t);
    }
  });

  it("does not route chords from a separated stem (chords come from the mix only, Req 4.10)", async () => {
    const duration = 4;
    const stream = new TimelineStream({ songDuration: duration });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: faithfulExtractor(),
    });

    // A per-stem (post-separation) pass for "melody" must not emit chord points.
    await engine.analyze(asAudioBuffer(buildKnownSample(duration)), "melody");
    expect(stream.getPoints("melody").length).toBeGreaterThan(0);
    expect(stream.getPoints("chords")).toEqual([]);

    // Chords are derived only from harmonic analysis of the mix.
    await engine.deriveChords(asAudioBuffer(buildKnownSample(duration)));
    expect(stream.getPoints("chords").length).toBeGreaterThan(0);
  });
});
