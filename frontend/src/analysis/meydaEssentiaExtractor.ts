/**
 * Meyda + Essentia-backed {@link FeatureExtractor} (design "Analysis_Engine":
 * Meyda for RMS/spectral, Essentia.js WASM for tempo/key/melody/chords).
 *
 * The heavy libraries are imported lazily through {@link loadModule} using a
 * non-literal specifier, so:
 *   - this module imports cleanly even when `meyda`/`essentia.js` are absent,
 *   - TypeScript does not try to resolve the optional dependencies, and
 *   - unit tests (which inject a mock extractor) never trigger the import.
 *
 * Each method rejects when its library is unavailable or extraction fails; the
 * engine records that feature as failed and continues with the others
 * (Req 3.6, 3.7).
 */

import type {
  AnalysisAudioBuffer,
  FeatureExtractor,
  KeyEstimate,
  RawSample,
} from "./types";
import type { PitchClass } from "../models/types";

/** Window size (samples) for framed Meyda analysis. */
const FRAME_SIZE = 512;
/** Hop size (samples) between frames. */
const HOP_SIZE = 512;

/** The twelve chromatic pitch classes, indexed 0..11 from C. */
const PITCH_CLASSES: readonly PitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * Dynamically import an optional dependency by name. The specifier is passed
 * through a variable so the TypeScript compiler treats the result as `any` and
 * does not require the module to be installed at build time. Rejects when the
 * module cannot be loaded.
 */
async function loadModule(name: string): Promise<unknown> {
  const specifier = name;
  return import(/* @vite-ignore */ specifier);
}

/** Resolve Meyda's callable namespace from its module shape. */
async function loadMeyda(): Promise<{
  extract(features: string[], signal: Float32Array): Record<string, unknown>;
}> {
  const mod = (await loadModule("meyda")) as {
    default?: unknown;
    extract?: unknown;
  };
  const meyda = (mod.default ?? mod) as {
    extract(features: string[], signal: Float32Array): Record<string, unknown>;
  };
  if (typeof meyda?.extract !== "function") {
    throw new Error("meyda unavailable");
  }
  return meyda;
}

/** Mono-mixdown the buffer's channels into a single Float32Array. */
function toMono(buffer: AnalysisAudioBuffer): Float32Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

/** The time in seconds at the start of frame `index`. */
function frameTime(index: number, sampleRate: number): number {
  return (index * HOP_SIZE) / sampleRate;
}

/** Run a Meyda feature extraction over every frame, mapping each frame's value. */
async function perFrame(
  buffer: AnalysisAudioBuffer,
  features: string[],
  map: (frame: Record<string, unknown>, prev: Record<string, unknown> | null) => number,
): Promise<RawSample[]> {
  const meyda = await loadMeyda();
  const mono = toMono(buffer);
  const samples: RawSample[] = [];
  let prev: Record<string, unknown> | null = null;
  for (let start = 0; start + FRAME_SIZE <= mono.length; start += HOP_SIZE) {
    const frame = mono.subarray(start, start + FRAME_SIZE);
    // Meyda expects a fixed-size signal; copy into a standalone buffer.
    const signal = new Float32Array(FRAME_SIZE);
    signal.set(frame);
    const extracted = meyda.extract(features, signal) ?? {};
    const value = map(extracted, prev);
    samples.push({ t: frameTime(samples.length, buffer.sampleRate), value });
    prev = extracted;
  }
  return samples;
}

/** Sum the lower fraction of an amplitude spectrum (low-band energy). */
function lowBand(spectrum: ArrayLike<number> | undefined): number {
  if (!spectrum || spectrum.length === 0) return 0;
  const cutoff = Math.max(1, Math.floor(spectrum.length * 0.1));
  let sum = 0;
  for (let i = 0; i < cutoff; i++) sum += spectrum[i];
  return sum / cutoff;
}

/** Positive spectral flux between consecutive amplitude spectra (onset cue). */
function spectralFlux(
  curr: ArrayLike<number> | undefined,
  prev: ArrayLike<number> | undefined,
): number {
  if (!curr || !prev) return 0;
  const n = Math.min(curr.length, prev.length);
  let flux = 0;
  for (let i = 0; i < n; i++) {
    const diff = curr[i] - prev[i];
    if (diff > 0) flux += diff;
  }
  return flux;
}

/** Initialize an Essentia.js instance from its WASM backend. */
async function loadEssentia(): Promise<Record<string, (...args: unknown[]) => unknown>> {
  const mod = (await loadModule("essentia.js")) as {
    Essentia?: new (wasm: unknown) => Record<string, (...a: unknown[]) => unknown>;
    EssentiaWASM?: unknown;
    default?: { Essentia?: new (wasm: unknown) => Record<string, (...a: unknown[]) => unknown>; EssentiaWASM?: unknown };
  };
  const ns = mod.default ?? mod;
  const Essentia = ns.Essentia;
  const wasm = ns.EssentiaWASM;
  if (!Essentia || !wasm) throw new Error("essentia.js unavailable");
  const instance = new Essentia(wasm);
  return instance as unknown as Record<string, (...args: unknown[]) => unknown>;
}

/** Convert a mono Float32Array to an Essentia vector via the instance helper. */
function toVector(
  essentia: Record<string, (...args: unknown[]) => unknown>,
  mono: Float32Array,
): unknown {
  const convert = essentia.arrayToVector as
    | ((a: Float32Array) => unknown)
    | undefined;
  // Essentia algorithm methods are bound to the WASM-backed instance; calling
  // them detached drops `this` and throws inside the WASM glue. Invoke on the
  // instance via `.call`.
  return convert ? convert.call(essentia, mono) : mono;
}

/**
 * Create the default Meyda/Essentia-backed extractor. All library access is
 * lazy and guarded, so constructing the extractor is cheap and side-effect free.
 */
export function createMeydaEssentiaExtractor(): FeatureExtractor {
  return {
    async rms(buffer) {
      return perFrame(buffer, ["rms"], (f) =>
        typeof f.rms === "number" ? f.rms : 0,
      );
    },

    async spectralOnsets(buffer) {
      return perFrame(buffer, ["amplitudeSpectrum"], (f, prev) =>
        spectralFlux(
          f.amplitudeSpectrum as ArrayLike<number> | undefined,
          prev?.amplitudeSpectrum as ArrayLike<number> | undefined,
        ),
      );
    },

    async lowBandEnergy(buffer) {
      return perFrame(buffer, ["amplitudeSpectrum"], (f) =>
        lowBand(f.amplitudeSpectrum as ArrayLike<number> | undefined),
      );
    },

    async melody(buffer) {
      const essentia = await loadEssentia();
      const mono = toMono(buffer);
      const vector = toVector(essentia, mono);
      const extractor = essentia.PredominantPitchMelodia as
        | ((v: unknown) => { pitch?: unknown })
        | undefined;
      if (!extractor) throw new Error("melody extractor unavailable");
      const result = extractor.call(essentia, vector) ?? {};
      const pitches = vectorToArray(essentia, result.pitch);
      const hop = 128; // Essentia melodia default hop size
      return pitches.map((value, i) => ({
        t: (i * hop) / buffer.sampleRate,
        value,
      }));
    },

    async tempo(buffer) {
      const essentia = await loadEssentia();
      const vector = toVector(essentia, toMono(buffer));
      const extractor = essentia.PercivalBpmEstimator as
        | ((v: unknown) => { bpm?: unknown })
        | undefined;
      if (!extractor) throw new Error("tempo extractor unavailable");
      const result = extractor.call(essentia, vector) ?? {};
      const bpm = Number(result.bpm);
      if (!Number.isFinite(bpm)) throw new Error("invalid tempo");
      return bpm;
    },

    async key(buffer) {
      const essentia = await loadEssentia();
      const vector = toVector(essentia, toMono(buffer));
      const extractor = essentia.KeyExtractor as
        | ((v: unknown) => { key?: unknown; scale?: unknown })
        | undefined;
      if (!extractor) throw new Error("key extractor unavailable");
      const result = extractor.call(essentia, vector) ?? {};
      return toKeyEstimate(result.key, result.scale);
    },

    async chords(buffer) {
      // Harmonic analysis of the mix only (Req 4.10). Use HPCP magnitude as a
      // proxy for chord strength over time.
      return perFrame(buffer, ["chroma"], (f) => {
        const chroma = f.chroma as ArrayLike<number> | undefined;
        if (!chroma || chroma.length === 0) return 0;
        let max = 0;
        for (let i = 0; i < chroma.length; i++) {
          if (chroma[i] > max) max = chroma[i];
        }
        return max;
      });
    },
  };
}

/** Convert an Essentia vector (or plain array) into a number[]. */
function vectorToArray(
  essentia: Record<string, (...args: unknown[]) => unknown>,
  vector: unknown,
): number[] {
  if (Array.isArray(vector)) return vector.map(Number);
  const convert = essentia.vectorToArray as ((v: unknown) => unknown) | undefined;
  // Bound WASM method — invoke on the instance (see toVector).
  const arr = convert ? convert.call(essentia, vector) : vector;
  if (Array.isArray(arr)) return arr.map(Number);
  if (arr && typeof (arr as ArrayLike<number>).length === "number") {
    return Array.from(arr as ArrayLike<number>, Number);
  }
  return [];
}

/** Build a {@link KeyEstimate} from an Essentia key/scale pair. */
function toKeyEstimate(key: unknown, scale: unknown): KeyEstimate {
  const tonic = PITCH_CLASSES.find((pc) => pc === key);
  const mode = scale === "minor" ? "minor" : scale === "major" ? "major" : null;
  if (!tonic || !mode) throw new Error("invalid key");
  return { tonic, mode };
}
