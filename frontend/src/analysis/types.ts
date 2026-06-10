/**
 * Analysis_Engine types (design "Analysis_Engine" component, Req 3, 4.8, 4.10).
 *
 * The Analysis_Engine runs Meyda.js (RMS, spectral envelope -> drum onsets) and
 * Essentia.js (tempo, key, melody pitch, chords), normalizes each raw feature
 * into `[-1, 1]`, and emits `Timeline_Point`s onto the Timeline_Stream.
 *
 * These types are framework-free and contain no static dependency on Meyda or
 * Essentia, so the module imports (and unit tests run) even when those heavy
 * libraries are not installed. The concrete library-backed extractor lives in
 * {@link ./meydaEssentiaExtractor} and only loads the libraries lazily.
 */

import type { PitchClass, StemType, TimelinePoint } from "../models/types";

/**
 * The six features the Analysis_Engine tracks the status of. Mirrors the
 * design's `FeatureName` (Req 3.1-3.3, 3.6).
 */
export type FeatureName =
  | "rms"
  | "spectral"
  | "tempo"
  | "key"
  | "melody"
  | "chords";

/** The canonical list of every tracked feature. */
export const ALL_FEATURES: readonly FeatureName[] = [
  "rms",
  "spectral",
  "tempo",
  "key",
  "melody",
  "chords",
] as const;

/** An estimated musical key (Req 8.3). */
export interface KeyEstimate {
  tonic: PitchClass;
  mode: "major" | "minor";
}

/**
 * Per-feature analysis status plus the estimated tempo and key. Mirrors the
 * design's `AnalysisStatus` (Req 3.6, 8.1-8.4).
 */
export interface AnalysisStatus {
  /** Features that have not yet completed. */
  pending: FeatureName[];
  /** Features that extracted successfully. */
  succeeded: FeatureName[];
  /** Features that failed to extract (Req 3.6). */
  failed: FeatureName[];
  /** The estimated tempo in BPM, or null when unknown (Req 8.1, 8.2). */
  tempoBpm: number | null;
  /** The estimated key, or null when unknown (Req 8.3, 8.4). */
  key: KeyEstimate | null;
}

/**
 * A single raw (un-normalized) feature sample produced by an extractor. `t` is
 * in seconds; `value` is the raw measured magnitude/frequency for that feature.
 * The engine normalizes `value` into `[-1, 1]` before emitting a Timeline_Point.
 */
export interface RawSample {
  t: number;
  value: number;
}

/**
 * The minimal audio-buffer surface the extractors require. The DOM `AudioBuffer`
 * is structurally assignable to this, so the public engine API can accept a real
 * `AudioBuffer` while tests can supply a lightweight stub.
 */
export interface AnalysisAudioBuffer {
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * The feature-extraction seam. The engine depends only on this interface, never
 * on Meyda/Essentia directly, so a mocked extractor can drive the engine in
 * tests (design Testing Strategy: "the Analysis_Engine dispatch property uses a
 * mocked engine").
 *
 * Time-series methods return raw samples over `[0, duration]`. Scalar methods
 * return a single estimate. Any method may reject to signal that its feature
 * failed; the engine records the failure and continues with the others
 * (Req 3.6, 3.7).
 */
export interface FeatureExtractor {
  /** Per-frame RMS magnitude (-> vocals envelope, Req 3.1, 5.5). */
  rms(buffer: AnalysisAudioBuffer): Promise<RawSample[]>;
  /** Spectral-flux onset strength (-> drum onsets, Req 3.2, 5.2). */
  spectralOnsets(buffer: AnalysisAudioBuffer): Promise<RawSample[]>;
  /** Low-frequency band energy (-> bass amplitude, Req 5.4). */
  lowBandEnergy(buffer: AnalysisAudioBuffer): Promise<RawSample[]>;
  /** Predominant melody pitch in Hz (-> melody curve, Req 3.3, 5.3). */
  melody(buffer: AnalysisAudioBuffer): Promise<RawSample[]>;
  /** Estimated tempo in BPM (Req 3.3, 8.1). */
  tempo(buffer: AnalysisAudioBuffer): Promise<number>;
  /** Estimated musical key (Req 3.3, 8.3). */
  key(buffer: AnalysisAudioBuffer): Promise<KeyEstimate>;
  /** Harmonic chord strength over time (-> chords, Req 4.10, 5.6). */
  chords(buffer: AnalysisAudioBuffer): Promise<RawSample[]>;
}

/**
 * The public Analysis_Engine surface (design "Analysis_Engine" interface).
 */
export interface AnalysisEngine {
  /**
   * Analyze an audio buffer and emit Timeline_Points. When `stem` is `"mix"`,
   * the full feature pipeline runs and points are routed to stems heuristically
   * (Req 3.1-3.4). When `stem` is a specific Stem_Type, the stem-appropriate
   * feature is extracted and all points are tagged with that stem (Req 4.8).
   */
  analyze(buffer: AudioBuffer, stem: StemType | "mix"): Promise<void>;
  /**
   * Derive chord points from harmonic analysis of the mix only — never from
   * stem separation (Req 4.10).
   */
  deriveChords(mixBuffer: AudioBuffer): Promise<void>;
  /** The current per-feature status, tempo, and key. */
  getStatus(): AnalysisStatus;
  /** Register an observer notified of every emitted Timeline_Point (Req 3.4). */
  onTimelinePoint(cb: (p: TimelinePoint) => void): void;
}
