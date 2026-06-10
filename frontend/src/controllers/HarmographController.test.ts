import { describe, it, expect, vi } from "vitest";
import {
  HarmographController,
  DECODE_FAILED_MESSAGE,
} from "./HarmographController";
import { STEM_SEPARATION_UNAVAILABLE_MESSAGE } from "@/demucs";
import type { AudioEngine } from "@/audio";
import type {
  AnalysisEngine,
  EmittableStream,
} from "@/analysis";
import { BaseStemRenderer } from "@/render";
import type { StemType } from "@/models";
import type { AppConfig } from "@/config/appConfig";

/**
 * Integration-style wiring tests for the HarmographController (task 17.1).
 *
 * The controller orchestrates upload → load → in-browser analysis → timeline →
 * renderer, then Demucs separation → per-stem analysis → chords. Here we exercise
 * that wiring with the browser-bound seams mocked (Audio decode, p5 mount, and
 * the network), while using the real TimelineStream + GraphRenderer + Demucs
 * client so routing and renderer ingestion are genuinely exercised.
 *
 * Covers: a valid upload triggers load → analyze → emit → renderer ingestion
 * (Req 3.4, 5.1); a returned stem set triggers one analysis pass per stem
 * (Req 4.8) with `other → melody` (Req 4.9) plus deriveChords from the mix only
 * (Req 4.10); an unreachable service surfaces the unavailable message and
 * retains the loaded file + in-browser analysis (Req 12.6).
 */

const TEST_CONFIG: AppConfig = {
  maxUploadBytes: 104_857_600,
  maxAnalysisMs: 60_000,
  plausibleTempo: [40, 250],
  demucsEndpoint: "http://demucs.test",
};

/** A lightweight AudioBuffer stand-in (only `duration` is read downstream). */
function fakeBuffer(duration = 60): AudioBuffer {
  return {
    duration,
    sampleRate: 44_100,
    numberOfChannels: 2,
    length: Math.floor(duration * 44_100),
    getChannelData: () => new Float32Array(0),
  } as unknown as AudioBuffer;
}

/** A mock Audio_Engine: load succeeds/fails per options; exposes a mix buffer. */
function makeFakeAudioEngine(opts: { loadOk?: boolean; duration?: number } = {}): {
  engine: AudioEngine;
  triggerEnded: () => void;
} {
  const loadOk = opts.loadOk ?? true;
  const duration = opts.duration ?? 60;
  let loaded = false;
  let endedCb: (() => void) | null = null;
  const buffer = fakeBuffer(duration);

  const engine = {
    load: vi.fn(async () => {
      if (loadOk) {
        loaded = true;
        return { ok: true as const, durationSeconds: duration };
      }
      loaded = false;
      return { ok: false as const, reason: "decode_failed" as const };
    }),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => (loaded ? duration : 0)),
    isLoaded: vi.fn(() => loaded),
    onEnded: vi.fn((cb: () => void) => {
      endedCb = cb;
    }),
    getBuffer: vi.fn(() => (loaded ? buffer : null)),
  } as unknown as AudioEngine;

  return { engine, triggerEnded: () => endedCb?.() };
}

/**
 * A mock Analysis_Engine factory that records analyze/deriveChords calls and
 * emits a Timeline_Point per pass into the shared stream so renderer ingestion
 * can be observed without Meyda/Essentia.
 */
function makeAnalysisEngineFactory() {
  const analyzeCalls: Array<StemType | "mix"> = [];
  let deriveChordsCount = 0;

  const factory = ({ stream }: { stream: EmittableStream }): AnalysisEngine =>
    ({
      analyze: vi.fn(async (_buffer: AudioBuffer, stem: StemType | "mix") => {
        analyzeCalls.push(stem);
        if (stem === "mix") {
          // In-browser mix pass routes points to several stems (Req 3.4).
          stream.emit({ t: 0, value: 0.5, stem: "vocals" });
          stream.emit({ t: 1, value: -0.3, stem: "drums" });
          stream.emit({ t: 0.5, value: 0.2, stem: "melody" });
        } else {
          stream.emit({ t: 0.25, value: 0.4, stem });
        }
      }),
      deriveChords: vi.fn(async () => {
        deriveChordsCount += 1;
        stream.emit({ t: 0, value: 0.1, stem: "chords" });
      }),
      getStatus: vi.fn(() => ({
        pending: [],
        succeeded: ["rms", "spectral", "melody", "tempo", "key", "chords"],
        failed: [],
        tempoBpm: 120,
        key: { tonic: "C", mode: "major" },
      })),
      onTimelinePoint: vi.fn(),
    }) as unknown as AnalysisEngine;

  return {
    factory,
    analyzeCalls,
    get deriveChordsCount() {
      return deriveChordsCount;
    },
  };
}

/** A four-stem `/separate` success body. */
function successBody() {
  return {
    job_id: "job-1",
    duration_seconds: 60,
    format: "wav",
    stems: {
      drums: { url: "/stems/job-1/drums.wav", bytes: 10 },
      bass: { url: "/stems/job-1/bass.wav", bytes: 11 },
      vocals: { url: "/stems/job-1/vocals.wav", bytes: 12 },
      other: { url: "/stems/job-1/other.wav", bytes: 13 },
    },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function audioFile(name = "song.wav"): File {
  return new File(["audio-bytes"], name, { type: "audio/wav" });
}

describe("HarmographController wiring (task 17.1)", () => {
  it("a valid upload loads, runs the mix pass, emits points, and the renderer ingests them (Req 3.4, 5.1)", async () => {
    const { engine } = makeFakeAudioEngine({ duration: 90 });
    const analysis = makeAnalysisEngineFactory();
    const onStatusMessage = vi.fn();
    const onPlayback = vi.fn();
    const onPointCounts = vi.fn();

    const controller = new HarmographController({
      config: TEST_CONFIG,
      audioEngineFactory: () => engine,
      analysisEngineFactory: analysis.factory,
      decodeStem: async () => fakeBuffer(),
      fetchFn: vi.fn(async () => jsonResponse(successBody())) as unknown as typeof fetch,
      callbacks: { onStatusMessage, onPlayback, onPointCounts },
    });

    await controller.handleUpload(audioFile());

    // Audio_Engine was loaded and the song duration propagated to the timeline.
    expect(engine.load).toHaveBeenCalledTimes(1);
    expect(controller.getTimeline().getSongDuration()).toBe(90);

    // The mix pass ran and emitted points that the Graph_Renderer ingested.
    expect(analysis.analyzeCalls).toContain("mix");
    const vocals = controller.getGraphRenderer().getStemRenderer("vocals") as BaseStemRenderer;
    const drums = controller.getGraphRenderer().getStemRenderer("drums") as BaseStemRenderer;
    expect(vocals.pointCount()).toBeGreaterThan(0);
    expect(drums.pointCount()).toBeGreaterThan(0);

    // Playback state surfaced as loaded.
    expect(onPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ isLoaded: true, duration: 90 }),
    );
  });

  it("a returned stem set triggers one analysis pass per stem + deriveChords from the mix (Req 4.8, 4.9, 4.10)", async () => {
    const { engine } = makeFakeAudioEngine();
    const analysis = makeAnalysisEngineFactory();
    const decodeStem = vi.fn(async () => fakeBuffer());
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).endsWith("/separate")) return jsonResponse(successBody());
      return jsonResponse({});
    });

    const controller = new HarmographController({
      config: TEST_CONFIG,
      audioEngineFactory: () => engine,
      analysisEngineFactory: analysis.factory,
      decodeStem,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await controller.handleUpload(audioFile());

    // Exactly one analysis pass per returned stem, with `other → melody`
    // (Req 4.8, 4.9). The four Demucs stems route to drums/bass/vocals/melody.
    const stemPasses = analysis.analyzeCalls.filter((s) => s !== "mix");
    expect(stemPasses.sort()).toEqual(["bass", "drums", "melody", "vocals"]);

    // Chords are never analyzed as a separated stem — only derived from the mix
    // (Req 4.10).
    expect(stemPasses).not.toContain("chords");
    expect(analysis.deriveChordsCount).toBe(1);

    // One decode per returned stem.
    expect(decodeStem).toHaveBeenCalledTimes(4);

    // Chord points reached the renderer via deriveChords.
    const chords = controller.getGraphRenderer().getStemRenderer("chords") as BaseStemRenderer;
    expect(chords.pointCount()).toBeGreaterThan(0);
  });

  it("an unreachable separation surfaces the unavailable message and retains the loaded file + analysis (Req 12.6)", async () => {
    const { engine } = makeFakeAudioEngine();
    const analysis = makeAnalysisEngineFactory();
    const onStatusMessage = vi.fn();

    // /separate rejects (network error); stem fetches never happen.
    const fetchFn = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const controller = new HarmographController({
      config: TEST_CONFIG,
      audioEngineFactory: () => engine,
      analysisEngineFactory: analysis.factory,
      decodeStem: async () => fakeBuffer(),
      fetchFn: fetchFn as unknown as typeof fetch,
      callbacks: { onStatusMessage },
    });

    const outcome = await controller.handleUpload(audioFile());
    expect(outcome).toEqual({ ok: true });

    // The unavailable message is surfaced for the StatusBanner (Req 12.6).
    const messages = onStatusMessage.mock.calls.map((c) => c[0]).filter(Boolean);
    expect(
      messages.some((m) => String(m).includes(STEM_SEPARATION_UNAVAILABLE_MESSAGE)),
    ).toBe(true);

    // The loaded file is retained: the engine is still loaded and the in-browser
    // mix analysis points remain on the timeline (no per-stem passes ran).
    expect(engine.isLoaded()).toBe(true);
    expect(controller.getTimeline().getPoints("vocals").length).toBeGreaterThan(0);
    const stemPasses = analysis.analyzeCalls.filter((s) => s !== "mix");
    expect(stemPasses).toHaveLength(0);
  });

  it("rejects an invalid upload with a message and never loads it (Req 1.2)", async () => {
    const { engine } = makeFakeAudioEngine();
    const onStatusMessage = vi.fn();
    const controller = new HarmographController({
      config: TEST_CONFIG,
      audioEngineFactory: () => engine,
      analysisEngineFactory: makeAnalysisEngineFactory().factory,
      callbacks: { onStatusMessage },
    });

    const outcome = await controller.handleUpload(
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );

    expect(outcome).toEqual({
      ok: false,
      stage: "validation",
      reason: "unsupported_format",
    });
    expect(engine.load).not.toHaveBeenCalled();
    expect(onStatusMessage).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("surfaces a decode-failure message when the Audio_Engine cannot decode (Req 1.5)", async () => {
    const { engine } = makeFakeAudioEngine({ loadOk: false });
    const onStatusMessage = vi.fn();
    const controller = new HarmographController({
      config: TEST_CONFIG,
      audioEngineFactory: () => engine,
      analysisEngineFactory: makeAnalysisEngineFactory().factory,
      callbacks: { onStatusMessage },
    });

    const outcome = await controller.handleUpload(audioFile());

    expect(outcome).toEqual({ ok: false, stage: "decode" });
    expect(onStatusMessage).toHaveBeenCalledWith(DECODE_FAILED_MESSAGE, "error");
    expect(engine.isLoaded()).toBe(false);
  });
});
