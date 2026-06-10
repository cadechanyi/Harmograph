// Feature: harmograph, Property 9: Partial analysis failure does not suppress succeeded features
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { HarmographAnalysisEngine } from "./AnalysisEngine";
import { TimelineStream } from "../timeline/TimelineStream";
import type { FeatureExtractor, KeyEstimate, RawSample } from "./types";
import type { StemType } from "../models/types";

/**
 * Property 9 (design "Correctness Properties", Req 3.7):
 *
 *   For any subset of features marked as failed, the Analysis_Engine still
 *   emits Timeline_Points for every feature that succeeded.
 *
 * The engine depends only on the injectable {@link FeatureExtractor} seam, so we
 * drive it with a MOCK extractor (no real Meyda/Essentia load). We randomize
 * which of the time-series-producing features fail (their extractor methods
 * reject) and assert that every feature whose extractor succeeded both lands in
 * `status.succeeded` and produces points on the stream, while every failed
 * feature lands in `status.failed` and does not suppress the others.
 */

/** A lightweight AudioBuffer stub with duration > 0 (the only field used here). */
function fakeBuffer(durationSeconds: number): AudioBuffer {
  return {
    duration: durationSeconds,
    sampleRate: 44_100,
    numberOfChannels: 1,
    length: Math.max(1, Math.round(durationSeconds * 44_100)),
    getChannelData: () => new Float32Array(0),
  } as unknown as AudioBuffer;
}

/**
 * The time-series-producing features and the stems each routes points to in the
 * mix path:
 *   - rms      -> vocals          (ex.rms)
 *   - spectral -> drums + bass     (ex.spectralOnsets + ex.lowBandEnergy)
 *   - melody   -> melody           (ex.melody)
 *   - chords   -> chords           (ex.chords)
 *
 * tempo and key are scalar features (they set status, not points) and are not
 * part of this property's randomization; they always succeed here.
 */
const SERIES_FEATURES = ["rms", "spectral", "melody", "chords"] as const;
type SeriesFeature = (typeof SERIES_FEATURES)[number];

const FEATURE_STEMS: Record<SeriesFeature, StemType[]> = {
  rms: ["vocals"],
  spectral: ["drums", "bass"],
  melody: ["melody"],
  chords: ["chords"],
};

/**
 * Build a mock extractor where the given features fail (their methods reject)
 * and all others succeed with non-empty, in-domain samples that normalize to
 * valid Timeline_Points. When `spectral` fails, BOTH of its underlying methods
 * reject so neither drums nor bass is emitted.
 */
function buildExtractor(failSet: ReadonlySet<SeriesFeature>): FeatureExtractor {
  const ok = (v: number) => (): Promise<RawSample[]> =>
    Promise.resolve([
      { t: 0, value: v },
      { t: 0, value: v },
    ]);
  const boom = (): Promise<RawSample[]> => Promise.reject(new Error("feature failed"));
  const key: KeyEstimate = { tonic: "A", mode: "minor" };

  return {
    rms: failSet.has("rms") ? boom : ok(0.5),
    spectralOnsets: failSet.has("spectral") ? boom : ok(0.8),
    lowBandEnergy: failSet.has("spectral") ? boom : ok(0.3),
    melody: failSet.has("melody") ? boom : ok(440),
    chords: failSet.has("chords") ? boom : ok(0.6),
    tempo: async () => 120,
    key: async () => key,
  };
}

describe("Analysis_Engine partial-failure resilience (Property 9, Req 3.7)", () => {
  it("emits points for every succeeded feature regardless of which features fail", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          rms: fc.boolean(),
          spectral: fc.boolean(),
          melody: fc.boolean(),
          chords: fc.boolean(),
        }),
        fc.integer({ min: 1, max: 600 }),
        async (fails, duration) => {
          const failSet = new Set<SeriesFeature>(
            SERIES_FEATURES.filter((f) => fails[f]),
          );

          const stream = new TimelineStream({ songDuration: duration });
          const engine = new HarmographAnalysisEngine({
            stream,
            extractor: buildExtractor(failSet),
            // maxAnalysisMs left at the default (infinite): the mocked extractor
            // resolves synchronously, so no timeout is needed.
          });

          await engine.analyze(fakeBuffer(duration), "mix");
          const status = engine.getStatus();

          for (const feature of SERIES_FEATURES) {
            const stems = FEATURE_STEMS[feature];
            if (failSet.has(feature)) {
              // A failed feature is reported failed and suppresses only itself.
              expect(status.failed).toContain(feature);
              for (const s of stems) {
                expect(stream.getPoints(s)).toEqual([]);
              }
            } else {
              // A succeeded feature is reported succeeded AND its points survive,
              // independent of any other feature's failure.
              expect(status.succeeded).toContain(feature);
              for (const s of stems) {
                expect(stream.getPoints(s).length).toBeGreaterThan(0);
              }
            }
          }

          // No feature is left dangling: partial failure resolves every feature.
          expect(status.pending).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
