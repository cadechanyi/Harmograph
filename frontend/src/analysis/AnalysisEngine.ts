/**
 * Analysis_Engine implementation (design "Analysis_Engine", Req 3, 4.8, 4.10).
 *
 * Runs feature extraction (Meyda RMS + spectral onsets, Essentia tempo/key/
 * melody/chords) through an injectable {@link FeatureExtractor} seam, normalizes
 * each raw feature into `[-1, 1]`, and emits `Timeline_Point`s through the shared
 * {@link TimelineStream}. It maintains an {@link AnalysisStatus} (pending /
 * succeeded / failed plus tempo and key) and is resilient to partial and full
 * failure:
 *   - Each feature runs independently; one failing feature never suppresses the
 *     points of a feature that succeeded (Req 3.6, 3.7).
 *   - The whole run is bounded by `maxAnalysisMs`; on timeout the still-pending
 *     features are marked failed while completed features and their points are
 *     retained (Req 3.5). The Audio_Engine is untouched, so audio stays playable
 *     (Req 3.8).
 *
 * The engine never imports Meyda/Essentia statically — the default extractor in
 * {@link ./meydaEssentiaExtractor} loads them lazily — so this module imports and
 * unit-tests run with those libraries absent.
 */

import type { StemType, TimelinePoint } from "../models/types";
import type { TimelineStream } from "../timeline/TimelineStream";
import {
  ALL_FEATURES,
  type AnalysisAudioBuffer,
  type AnalysisEngine,
  type AnalysisStatus,
  type FeatureExtractor,
  type FeatureName,
  type KeyEstimate,
  type RawSample,
} from "./types";
import {
  clamp,
  DEFAULT_DOMAINS,
  normalizeToBipolar,
  type Domain,
} from "./normalize";

/** Minimal stream surface the engine needs (the concrete TimelineStream). */
export interface EmittableStream {
  emit(candidate: unknown): void;
}

/** Construction options for {@link HarmographAnalysisEngine}. */
export interface AnalysisEngineOptions {
  /** The shared Timeline_Stream emitted points are routed through. */
  stream: EmittableStream;
  /**
   * The feature extractor. Defaults to the lazily-loaded Meyda/Essentia
   * extractor. Injectable so tests can drive the engine with a mock (design
   * Testing Strategy).
   */
  extractor?: FeatureExtractor;
  /** Maximum analysis duration in ms before remaining features fail (Req 3.5). */
  maxAnalysisMs?: number;
  /** Per-stem raw normalization domains; defaults to {@link DEFAULT_DOMAINS}. */
  domains?: Record<StemType, Domain>;
}

/** Routes a single time-series feature to the stem it represents. */
interface SeriesRoute {
  stem: StemType;
  run: (b: AnalysisAudioBuffer) => Promise<RawSample[]>;
}

/** Tracks whether the current run has been aborted (e.g. by timeout). */
interface RunContext {
  aborted: boolean;
}

/**
 * Lazily constructs the default Meyda/Essentia-backed extractor. Imported
 * dynamically so the heavy libraries (and this whole code path) are skipped
 * entirely when an extractor is injected.
 */
async function defaultExtractor(): Promise<FeatureExtractor> {
  const mod = await import("./meydaEssentiaExtractor");
  return mod.createMeydaEssentiaExtractor();
}

export class HarmographAnalysisEngine implements AnalysisEngine {
  private readonly stream: EmittableStream;
  private readonly providedExtractor: FeatureExtractor | null;
  private readonly maxAnalysisMs: number;
  private readonly domains: Record<StemType, Domain>;

  private extractor: FeatureExtractor | null;
  private readonly observers: Array<(p: TimelinePoint) => void> = [];

  private status: AnalysisStatus = {
    pending: [...ALL_FEATURES],
    succeeded: [],
    failed: [],
    tempoBpm: null,
    key: null,
  };

  constructor(options: AnalysisEngineOptions) {
    this.stream = options.stream;
    this.providedExtractor = options.extractor ?? null;
    this.extractor = options.extractor ?? null;
    this.maxAnalysisMs = options.maxAnalysisMs ?? Number.POSITIVE_INFINITY;
    this.domains = options.domains ?? DEFAULT_DOMAINS;
  }

  onTimelinePoint(cb: (p: TimelinePoint) => void): void {
    this.observers.push(cb);
  }

  getStatus(): AnalysisStatus {
    // Defensive copy so callers can't mutate internal state.
    return {
      pending: [...this.status.pending],
      succeeded: [...this.status.succeeded],
      failed: [...this.status.failed],
      tempoBpm: this.status.tempoBpm,
      key: this.status.key,
    };
  }

  async analyze(buffer: AudioBuffer, stem: StemType | "mix"): Promise<void> {
    const buf = buffer as unknown as AnalysisAudioBuffer;
    const duration = this.durationOf(buf);
    const extractor = await this.ensureExtractor();
    if (!extractor) {
      // No extractor available (e.g. Meyda/Essentia not installed): treat as a
      // full failure but keep audio playable (Req 3.5, 3.8).
      this.failAll(stem === "mix" ? ALL_FEATURES : [this.featureForStem(stem)]);
      return;
    }

    const jobs =
      stem === "mix"
        ? this.mixJobs(extractor, buf, duration)
        : [this.stemJob(stem, extractor, buf, duration)];

    await this.runJobs(jobs);
  }

  async deriveChords(mixBuffer: AudioBuffer): Promise<void> {
    // Chords are derived from harmonic analysis of the mix only, never from a
    // separated stem (Req 4.10).
    const buf = mixBuffer as unknown as AnalysisAudioBuffer;
    const duration = this.durationOf(buf);
    const extractor = await this.ensureExtractor();
    if (!extractor) {
      this.failAll(["chords"]);
      return;
    }
    await this.runJobs([this.chordsJob(extractor, buf, duration)]);
  }

  // --- internals -----------------------------------------------------------

  /** Resolve (and cache) the extractor, falling back to the default one. */
  private async ensureExtractor(): Promise<FeatureExtractor | null> {
    if (this.providedExtractor) return this.providedExtractor;
    if (this.extractor) return this.extractor;
    try {
      this.extractor = await defaultExtractor();
      return this.extractor;
    } catch {
      return null;
    }
  }

  private durationOf(buf: AnalysisAudioBuffer): number {
    const d = buf?.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  /** The feature whose status a per-stem analysis pass updates. */
  private featureForStem(stem: StemType): FeatureName {
    switch (stem) {
      case "drums":
        return "spectral";
      case "vocals":
        return "rms";
      case "bass":
        return "spectral";
      case "melody":
        return "melody";
      case "chords":
        return "chords";
    }
  }

  /**
   * Build the full mix-path job list. Feature points are routed to stems
   * heuristically: spectral onsets -> drums and low-band energy -> bass (both
   * under the `spectral` feature), RMS -> vocals, melody pitch -> melody, plus
   * scalar tempo and key, and harmonic chords -> chords (Req 3.1-3.4, 4.10).
   */
  private mixJobs(
    ex: FeatureExtractor,
    buf: AnalysisAudioBuffer,
    duration: number,
  ): Array<{ feature: FeatureName; run: (ctx: RunContext) => Promise<void> }> {
    return [
      {
        feature: "rms",
        run: (ctx) =>
          this.runSeries(ctx, [{ stem: "vocals", run: ex.rms }], buf, duration),
      },
      {
        feature: "spectral",
        run: (ctx) =>
          this.runSeries(
            ctx,
            [
              { stem: "drums", run: ex.spectralOnsets },
              { stem: "bass", run: ex.lowBandEnergy },
            ],
            buf,
            duration,
          ),
      },
      {
        feature: "melody",
        run: (ctx) =>
          this.runSeries(
            ctx,
            [{ stem: "melody", run: ex.melody }],
            buf,
            duration,
          ),
      },
      {
        feature: "tempo",
        run: async (ctx) => {
          const bpm = await ex.tempo(buf);
          if (ctx.aborted) return;
          if (!Number.isFinite(bpm)) throw new Error("invalid tempo");
          this.status.tempoBpm = bpm;
        },
      },
      {
        feature: "key",
        run: async (ctx) => {
          const key = await ex.key(buf);
          if (ctx.aborted) return;
          if (!isKeyEstimate(key)) throw new Error("invalid key");
          this.status.key = key;
        },
      },
      this.chordsJob(ex, buf, duration),
    ];
  }

  /** Build a single-stem job for a post-separation analysis pass (Req 4.8). */
  private stemJob(
    stem: StemType,
    ex: FeatureExtractor,
    buf: AnalysisAudioBuffer,
    duration: number,
  ): { feature: FeatureName; run: (ctx: RunContext) => Promise<void> } {
    const routes: Record<StemType, SeriesRoute> = {
      drums: { stem: "drums", run: ex.spectralOnsets },
      vocals: { stem: "vocals", run: ex.rms },
      bass: { stem: "bass", run: ex.lowBandEnergy },
      melody: { stem: "melody", run: ex.melody },
      chords: { stem: "chords", run: ex.chords },
    };
    return {
      feature: this.featureForStem(stem),
      run: (ctx) => this.runSeries(ctx, [routes[stem]], buf, duration),
    };
  }

  private chordsJob(
    ex: FeatureExtractor,
    buf: AnalysisAudioBuffer,
    duration: number,
  ): { feature: FeatureName; run: (ctx: RunContext) => Promise<void> } {
    return {
      feature: "chords",
      run: (ctx) =>
        this.runSeries(ctx, [{ stem: "chords", run: ex.chords }], buf, duration),
    };
  }

  /** Extract one or more time-series routes and emit their normalized points. */
  private async runSeries(
    ctx: RunContext,
    routes: SeriesRoute[],
    buf: AnalysisAudioBuffer,
    duration: number,
  ): Promise<void> {
    for (const route of routes) {
      const samples = await route.run(buf);
      if (ctx.aborted) return;
      this.emitSeries(route.stem, samples, duration);
    }
  }

  /** Normalize raw samples for `stem` and emit valid Timeline_Points. */
  private emitSeries(
    stem: StemType,
    samples: RawSample[],
    duration: number,
  ): void {
    if (!Array.isArray(samples)) return;
    const domain = this.domains[stem];
    const upperT = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    for (const sample of samples) {
      if (!sample || !Number.isFinite(sample.t)) continue;
      const value = normalizeToBipolar(sample.value, domain);
      if (value === null) continue;
      const t = clamp(sample.t, 0, upperT);
      const point: TimelinePoint = { t, value, stem };
      this.stream.emit(point);
      for (const observer of this.observers) observer(point);
    }
  }

  /**
   * Run a set of independent feature jobs concurrently, bounded by
   * `maxAnalysisMs`. Each job that resolves is marked succeeded; each that
   * rejects is marked failed (Req 3.6, 3.7). On timeout, the run is aborted and
   * every still-pending feature is marked failed (Req 3.5).
   */
  private async runJobs(
    jobs: Array<{ feature: FeatureName; run: (ctx: RunContext) => Promise<void> }>,
  ): Promise<void> {
    const ctx: RunContext = { aborted: false };

    const settle = Promise.allSettled(
      jobs.map(async (job) => {
        try {
          await job.run(ctx);
          if (!ctx.aborted) this.markSucceeded(job.feature);
        } catch {
          if (!ctx.aborted) this.markFailed(job.feature);
        }
      }),
    );

    if (!Number.isFinite(this.maxAnalysisMs)) {
      await settle;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.maxAnalysisMs);
    });

    const outcome = await Promise.race([settle.then(() => "done" as const), timeout]);
    if (timer) clearTimeout(timer);

    if (outcome === "timeout") {
      // Abort: keep already-emitted points and completed statuses, fail the rest
      // (Req 3.5). The Audio_Engine is never touched, so audio stays playable
      // (Req 3.8).
      ctx.aborted = true;
      for (const job of jobs) {
        if (this.status.pending.includes(job.feature)) {
          this.markFailed(job.feature);
        }
      }
    }
  }

  private markSucceeded(feature: FeatureName): void {
    this.status.pending = this.status.pending.filter((f) => f !== feature);
    if (
      !this.status.succeeded.includes(feature) &&
      !this.status.failed.includes(feature)
    ) {
      this.status.succeeded.push(feature);
    }
  }

  private markFailed(feature: FeatureName): void {
    this.status.pending = this.status.pending.filter((f) => f !== feature);
    if (
      !this.status.failed.includes(feature) &&
      !this.status.succeeded.includes(feature)
    ) {
      this.status.failed.push(feature);
    }
  }

  private failAll(features: readonly FeatureName[]): void {
    for (const feature of features) this.markFailed(feature);
  }
}

/** True when `x` is a structurally valid {@link KeyEstimate}. */
function isKeyEstimate(x: unknown): x is KeyEstimate {
  if (typeof x !== "object" || x === null) return false;
  const { tonic, mode } = x as { tonic?: unknown; mode?: unknown };
  return (
    typeof tonic === "string" && (mode === "major" || mode === "minor")
  );
}

/** Factory for a fresh Analysis_Engine. */
export function createAnalysisEngine(
  options: AnalysisEngineOptions,
): AnalysisEngine {
  return new HarmographAnalysisEngine(options);
}

/** Re-export so callers can pass the concrete stream type. */
export type { TimelineStream };
