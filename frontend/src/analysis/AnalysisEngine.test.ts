import { describe, it, expect, vi } from "vitest";
import { HarmographAnalysisEngine } from "./AnalysisEngine";
import { TimelineStream } from "../timeline/TimelineStream";
import type { FeatureExtractor, KeyEstimate, RawSample } from "./types";
import type { StemType, TimelinePoint } from "../models/types";

/** A lightweight AudioBuffer stub sufficient for the extractor seam. */
function fakeBuffer(durationSeconds = 10): AudioBuffer {
  return {
    duration: durationSeconds,
    sampleRate: 44_100,
    numberOfChannels: 1,
    length: durationSeconds * 44_100,
    getChannelData: () => new Float32Array(0),
  } as unknown as AudioBuffer;
}

/** A fully-succeeding mock extractor with overridable per-feature behavior. */
function mockExtractor(
  overrides: Partial<FeatureExtractor> = {},
): FeatureExtractor {
  const series = (v: number): RawSample[] => [
    { t: 0, value: v },
    { t: 1, value: v },
  ];
  const key: KeyEstimate = { tonic: "A", mode: "minor" };
  return {
    rms: async () => series(0.5),
    spectralOnsets: async () => series(0.8),
    lowBandEnergy: async () => series(0.3),
    melody: async () => series(440),
    tempo: async () => 120,
    key: async () => key,
    chords: async () => series(0.6),
    ...overrides,
  };
}

describe("HarmographAnalysisEngine mix analysis (Req 3.1-3.4)", () => {
  it("emits normalized points routed to the correct stems", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: mockExtractor(),
    });

    await engine.analyze(fakeBuffer(10), "mix");

    // spectral onsets -> drums, low-band -> bass, rms -> vocals, melody -> melody,
    // chords -> chords (Req 3.4 routing).
    expect(stream.getPoints("drums").length).toBeGreaterThan(0);
    expect(stream.getPoints("bass").length).toBeGreaterThan(0);
    expect(stream.getPoints("vocals").length).toBeGreaterThan(0);
    expect(stream.getPoints("melody").length).toBeGreaterThan(0);
    expect(stream.getPoints("chords").length).toBeGreaterThan(0);
  });

  it("normalizes every emitted value into [-1, 1] (Req 3.4, 10.1)", async () => {
    const observed: TimelinePoint[] = [];
    const stream = new TimelineStream({ songDuration: 10 });
    const engine = new HarmographAnalysisEngine({
      stream,
      // Deliberately out-of-domain raw values to exercise clamping.
      extractor: mockExtractor({
        rms: async () => [{ t: 0, value: 99 }],
        melody: async () => [{ t: 0, value: -50 }],
      }),
    });
    engine.onTimelinePoint((p) => observed.push(p));

    await engine.analyze(fakeBuffer(10), "mix");

    expect(observed.length).toBeGreaterThan(0);
    for (const p of observed) {
      expect(p.value).toBeGreaterThanOrEqual(-1);
      expect(p.value).toBeLessThanOrEqual(1);
      expect(p.t).toBeGreaterThanOrEqual(0);
      expect(p.t).toBeLessThanOrEqual(10);
    }
  });

  it("records tempo and key in the status (Req 8.1, 8.3)", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: mockExtractor(),
    });

    await engine.analyze(fakeBuffer(10), "mix");
    const status = engine.getStatus();

    expect(status.tempoBpm).toBe(120);
    expect(status.key).toEqual({ tonic: "A", mode: "minor" });
    expect(status.failed).toEqual([]);
    expect(status.pending).toEqual([]);
  });
});

describe("HarmographAnalysisEngine partial failure (Req 3.6, 3.7)", () => {
  it("still emits succeeded features when one feature fails", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: mockExtractor({
        melody: async () => {
          throw new Error("melody boom");
        },
      }),
    });

    await engine.analyze(fakeBuffer(10), "mix");
    const status = engine.getStatus();

    expect(status.failed).toContain("melody");
    expect(status.succeeded).toContain("rms");
    expect(status.succeeded).toContain("spectral");
    // Succeeded features still produced points.
    expect(stream.getPoints("drums").length).toBeGreaterThan(0);
    expect(stream.getPoints("vocals").length).toBeGreaterThan(0);
    // The failed feature produced none.
    expect(stream.getPoints("melody")).toEqual([]);
  });
});

describe("HarmographAnalysisEngine timeout (Req 3.5, 3.8)", () => {
  it("marks unfinished features failed and keeps emitted points", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const slow = (): Promise<RawSample[]> =>
      new Promise((resolve) =>
        setTimeout(() => resolve([{ t: 0, value: 0.5 }]), 200),
      );
    const engine = new HarmographAnalysisEngine({
      stream,
      maxAnalysisMs: 5,
      extractor: mockExtractor({
        rms: slow,
        spectralOnsets: slow,
        lowBandEnergy: slow,
        melody: slow,
        chords: slow,
        tempo: () => new Promise((r) => setTimeout(() => r(120), 200)),
        key: () =>
          new Promise((r) =>
            setTimeout(() => r({ tonic: "C", mode: "major" }), 200),
          ),
      }),
    });

    await engine.analyze(fakeBuffer(10), "mix");
    const status = engine.getStatus();

    // Everything timed out -> all failed, nothing pending (full failure).
    expect(status.failed.length).toBeGreaterThan(0);
    expect(status.pending).toEqual([]);
    expect(status.succeeded).toEqual([]);
  });
});

describe("HarmographAnalysisEngine per-stem and chords (Req 4.8, 4.10)", () => {
  it("routes a per-stem pass to that stem only", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: mockExtractor(),
    });

    await engine.analyze(fakeBuffer(10), "drums");

    expect(stream.getPoints("drums").length).toBeGreaterThan(0);
    expect(stream.getPoints("vocals")).toEqual([]);
    expect(stream.getPoints("melody")).toEqual([]);
  });

  it("deriveChords emits only chord points", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    const chordsSpy = vi.fn(async () => [{ t: 0, value: 0.6 }]);
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: mockExtractor({ chords: chordsSpy }),
    });

    await engine.deriveChords(fakeBuffer(10));

    expect(chordsSpy).toHaveBeenCalledTimes(1);
    expect(stream.getPoints("chords").length).toBeGreaterThan(0);
    const others: StemType[] = ["drums", "bass", "vocals", "melody"];
    for (const s of others) expect(stream.getPoints(s)).toEqual([]);
    expect(engine.getStatus().succeeded).toContain("chords");
  });
});

describe("HarmographAnalysisEngine no extractor available (Req 3.5, 3.8)", () => {
  it("marks features failed when the default extractor cannot load", async () => {
    const stream = new TimelineStream({ songDuration: 10 });
    // Inject an extractor whose every method rejects, deterministically
    // exercising the full-failure path regardless of which optional libraries
    // (meyda/essentia) happen to be installed in the test environment.
    const failingExtractor: FeatureExtractor = {
      rms: async () => {
        throw new Error("unavailable");
      },
      spectralOnsets: async () => {
        throw new Error("unavailable");
      },
      lowBandEnergy: async () => {
        throw new Error("unavailable");
      },
      melody: async () => {
        throw new Error("unavailable");
      },
      tempo: async () => {
        throw new Error("unavailable");
      },
      key: async () => {
        throw new Error("unavailable");
      },
      chords: async () => {
        throw new Error("unavailable");
      },
    };
    const engine = new HarmographAnalysisEngine({
      stream,
      extractor: failingExtractor,
    });

    await engine.analyze(fakeBuffer(10), "mix");
    const status = engine.getStatus();

    // No working extractor -> every targeted feature is marked failed.
    expect(status.succeeded).toEqual([]);
    expect(status.failed.length).toBe(6);
    expect(status.pending).toEqual([]);
    // Pure-logic safety: no points emitted to any stem, stream still usable.
    const allStems: StemType[] = ["drums", "bass", "vocals", "melody", "chords"];
    for (const s of allStems) expect(stream.getPoints(s)).toEqual([]);
  });
});
