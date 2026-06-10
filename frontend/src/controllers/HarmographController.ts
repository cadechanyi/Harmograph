/**
 * Harmograph_Controller — the non-React orchestration layer that wires the
 * Frontend's engines together for the full end-to-end flow (task 17.1):
 *
 *   UploadPanel → validateUpload → Audio_Engine.load → in-browser
 *   Analysis_Engine pass (mix) → Timeline_Stream → Graph_Renderer,
 *   then Demucs separation → per-stem Analysis_Engine passes → deriveChords,
 *   surfacing analysis / separation / connectivity states for the StatusBanner.
 *
 * It owns the plain-TypeScript engines (Audio_Engine, Analysis_Engine,
 * Timeline_Stream, Coordinate_System, Graph_Renderer, Demucs client) and exposes
 * a small imperative surface the React layer drives. Every engine/client is
 * created through an injectable factory so the controller can be unit- and
 * integration-tested under jsdom with mocked browser decode, p5 mounting, and
 * network (design Testing Strategy).
 *
 * The controller never mutates the requirements-owned engines' internals; it
 * coordinates them. Browser-bound side effects (decoding, p5 canvas, the
 * playback poll loop) are isolated behind seams so importing this module is
 * free of DOM side effects.
 *
 * Requirements covered by this wiring: 3.4 (emit Timeline_Points from the
 * in-browser mix pass), 4.8 (one analysis pass per returned stem), 4.9
 * (`other → melody`), 4.10 (chords derived from the mix only), 5.1 (playhead
 * uses the Audio_Engine time as the renderer time source), 12.4/12.5
 * (non-separation processing stays in the browser; audio sent only for
 * separation), 12.6 (unreachable separation surfaces a message and retains the
 * loaded file + analysis).
 */

import { appConfig as defaultAppConfig, type AppConfig } from "../config/appConfig";
import { validateUpload } from "../upload/validateUpload";
import { createAudioEngine, type AudioEngine } from "../audio";
import { createAnalysisEngine, type EmittableStream } from "../analysis/AnalysisEngine";
import type {
  AnalysisEngine,
  AnalysisStatus,
  FeatureExtractor,
} from "../analysis/types";
import { TimelineStream } from "../timeline";
import { createCoordinateSystem, type CoordinateSystem } from "../coordinate";
import {
  createGraphRenderer,
  type GraphRendererImpl,
  type P5Factory,
} from "../render";
import {
  createDemucsClient,
  STEM_SEPARATION_UNAVAILABLE_MESSAGE,
  type DemucsClient,
  type DemucsClientOptions,
  type SeparatedStem,
  type StemAnalysisDispatcher,
} from "../demucs";
import {
  STEM_TYPES,
  type GraphStyle,
  type StemConfigMap,
  type StemType,
  type YUnit,
} from "../models";
import { createInitialStemConfig } from "../stores/stemConfigStore";
import { createEmptyPointCounts, type StemPointCounts } from "../stores/timelineIndexStore";

/** Message shown when a loaded file's contents cannot be decoded (Req 1.5). */
export const DECODE_FAILED_MESSAGE =
  "The file could not be decoded. Please try a different MP3 or WAV file.";

/** Tone for a StatusBanner message. */
export type StatusTone = "info" | "error";

/** A snapshot of playback state the UI mirrors (Req 2.x display). */
export interface PlaybackSnapshot {
  isLoaded: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

/**
 * The callbacks the React layer registers so engine state changes flow into the
 * stores and overlay. Each is optional so the controller is usable headless in
 * tests.
 */
export interface HarmographControllerCallbacks {
  /** Mirror playback state (loaded / playing / time / duration) into the UI. */
  onPlayback?(snapshot: PlaybackSnapshot): void;
  /** Mirror the Analysis_Engine status (pending/succeeded/failed, tempo, key). */
  onAnalysisStatus?(status: AnalysisStatus): void;
  /** Mirror per-stem Timeline_Point counts so style availability/gating works. */
  onPointCounts?(counts: StemPointCounts): void;
  /** Reset the stem configuration to all-enabled defaults on a new load (Req 6.4). */
  onStemConfig?(config: StemConfigMap): void;
  /** Surface a StatusBanner message (analysis/separation/connectivity). */
  onStatusMessage?(message: string | null, tone: StatusTone): void;
}

/** Factory seam for the Analysis_Engine (fresh per loaded file). */
export type AnalysisEngineFactory = (args: {
  stream: EmittableStream;
}) => AnalysisEngine;

/** Factory seam for the Demucs client (constructed per separation). */
export type DemucsClientFactory = (options: DemucsClientOptions) => DemucsClient;

/** Construction options for {@link HarmographController}. All seams injectable. */
export interface HarmographControllerOptions {
  /** App configuration; defaults to the module {@link appConfig}. */
  config?: AppConfig;
  /** UI mirroring callbacks. */
  callbacks?: HarmographControllerCallbacks;
  /** Audio_Engine factory; defaults to the Web Audio engine. */
  audioEngineFactory?: () => AudioEngine;
  /** Timeline_Stream factory; defaults to a fresh {@link TimelineStream}. */
  timelineFactory?: () => TimelineStream;
  /** Coordinate_System factory; defaults to {@link createCoordinateSystem}. */
  coordinateFactory?: () => CoordinateSystem;
  /** Analysis_Engine factory; defaults to {@link createAnalysisEngine}. */
  analysisEngineFactory?: AnalysisEngineFactory;
  /** Graph_Renderer factory; defaults to {@link createGraphRenderer}. */
  graphRendererFactory?: (renderer: {
    timeSource: () => number;
    coordinateSystem: CoordinateSystem;
    timeline: TimelineStream;
    p5Factory?: P5Factory;
  }) => GraphRendererImpl;
  /** Demucs client factory; defaults to {@link createDemucsClient}. */
  demucsClientFactory?: DemucsClientFactory;
  /** Optional injected feature extractor for the Analysis_Engine (tests). */
  analysisExtractor?: FeatureExtractor;
  /** Injectable fetch (separation + stem download); defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable p5 factory passed to the Graph_Renderer (tests supply a stub). */
  p5Factory?: P5Factory;
  /**
   * Injectable stem decoder: download + decode a separated stem into an
   * AudioBuffer for its per-stem analysis pass. Defaults to a fetch + Web Audio
   * `decodeAudioData` implementation. Tests inject a stub to stay under jsdom.
   */
  decodeStem?: (source: SeparatedStem) => Promise<AudioBuffer | null>;
  /** Provide the requestAnimationFrame used by the playback poll loop (tests). */
  raf?: (cb: () => void) => number;
  /** Provide the cancelAnimationFrame paired with {@link raf}. */
  cancelRaf?: (handle: number) => void;
}

/** The outcome of {@link HarmographController.handleUpload}. */
export type UploadOutcome =
  | { ok: true }
  | { ok: false; stage: "validation"; reason: string }
  | { ok: false; stage: "decode" };

/**
 * Coordinates the Frontend engines for the full upload → render flow.
 */
export class HarmographController {
  private readonly config: AppConfig;
  private readonly callbacks: HarmographControllerCallbacks;

  private readonly audioEngine: AudioEngine;
  private readonly timeline: TimelineStream;
  private readonly coordinateSystem: CoordinateSystem;
  private readonly graphRenderer: GraphRendererImpl;

  private readonly analysisEngineFactory: AnalysisEngineFactory;
  private readonly demucsClientFactory: DemucsClientFactory;
  private readonly fetchFn: typeof fetch;
  private readonly decodeStemFn: (source: SeparatedStem) => Promise<AudioBuffer | null>;
  private readonly raf?: (cb: () => void) => number;
  private readonly cancelRaf?: (handle: number) => void;

  /** Re-created per loaded file so its status starts clean. */
  private analysisEngine: AnalysisEngine;

  private isPlaying = false;
  private rafHandle: number | null = null;
  private lastPushedTime = -1;

  /** Latest analysis/separation messages combined for the StatusBanner. */
  private analysisMessage: string | null = null;
  private separationMessage: string | null = null;

  private decodeContext: AudioContext | null = null;

  constructor(options: HarmographControllerOptions = {}) {
    this.config = options.config ?? defaultAppConfig;
    this.callbacks = options.callbacks ?? {};
    this.fetchFn =
      options.fetchFn ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (undefined as unknown as typeof fetch));
    this.raf = options.raf;
    this.cancelRaf = options.cancelRaf;

    this.audioEngine = (options.audioEngineFactory ?? (() => createAudioEngine()))();
    this.timeline = (options.timelineFactory ?? (() => new TimelineStream()))();
    this.coordinateSystem = (options.coordinateFactory ?? createCoordinateSystem)();

    this.analysisEngineFactory =
      options.analysisEngineFactory ??
      (({ stream }) =>
        createAnalysisEngine({
          stream,
          extractor: options.analysisExtractor,
          maxAnalysisMs: this.config.maxAnalysisMs,
        }));
    this.demucsClientFactory = options.demucsClientFactory ?? createDemucsClient;

    this.decodeStemFn =
      options.decodeStem ?? ((source) => this.defaultDecodeStem(source));

    // The Graph_Renderer reads the live playback time from the Audio_Engine, so
    // the rendered playhead tracks playback while playing and holds while paused
    // (Req 5.1, 5.8) — a single time source satisfies both.
    const rendererFactory =
      options.graphRendererFactory ??
      ((args) => createGraphRenderer(args));
    this.graphRenderer = rendererFactory({
      timeSource: () => this.audioEngine.getCurrentTime(),
      coordinateSystem: this.coordinateSystem,
      timeline: this.timeline,
      p5Factory: options.p5Factory,
    });

    // Fresh engine even before the first load so headless callers can introspect.
    this.analysisEngine = this.analysisEngineFactory({ stream: this.timeline });

    // A natural end-of-song suspends playback at the duration (Req 2.7); mirror it.
    this.audioEngine.onEnded(() => {
      this.isPlaying = false;
      this.pushPlayback();
    });
  }

  // --- engine accessors (used by tests and the React wrapper) --------------

  getAudioEngine(): AudioEngine {
    return this.audioEngine;
  }

  getTimeline(): TimelineStream {
    return this.timeline;
  }

  getCoordinateSystem(): CoordinateSystem {
    return this.coordinateSystem;
  }

  getGraphRenderer(): GraphRendererImpl {
    return this.graphRenderer;
  }

  getAnalysisEngine(): AnalysisEngine {
    return this.analysisEngine;
  }

  // --- renderer lifecycle --------------------------------------------------

  /** Mount the Graph_Renderer into `container` and start the playback poll. */
  async mountRenderer(container: HTMLElement): Promise<void> {
    try {
      await this.graphRenderer.mount(container);
      this.startPlaybackLoop();
    } catch (err) {
      // The p5 canvas could not be created (e.g. no Canvas/WebGL backing under
      // a non-browser environment). The rest of the app — audio, analysis, the
      // overlay — still functions, so we log rather than propagate.
      if (typeof console !== "undefined") {
        console.error("Graph_Renderer mount failed", err);
      }
    }
  }

  /** Tear down the renderer and stop the playback poll. */
  unmount(): void {
    this.stopPlaybackLoop();
    this.graphRenderer.destroy();
  }

  // --- playback controls (drive the Audio_Engine, mirror to the UI) --------

  play(): void {
    this.audioEngine.play();
    this.isPlaying = this.audioEngine.isLoaded();
    this.pushPlayback();
  }

  pause(): void {
    this.audioEngine.pause();
    this.isPlaying = false;
    this.pushPlayback();
  }

  seek(timeSeconds: number): void {
    this.audioEngine.seek(timeSeconds);
    this.pushPlayback();
  }

  // --- overlay-driven renderer/coordinate changes --------------------------

  /** Enable/disable a stem's renderer (Req 6.1, 6.2). */
  setStemEnabled(stem: StemType, enabled: boolean): void {
    this.graphRenderer.getStemRenderer(stem).setEnabled(enabled);
  }

  /** Select a stem's Graph_Style; applied from the next frame (Req 7.2). */
  setStemStyle(stem: StemType, style: GraphStyle): void {
    this.graphRenderer.getStemRenderer(stem).setStyle(style);
  }

  /** Select the y-axis unit; the next frame uses the new mapping (Req 9.4, 9.6). */
  setYUnit(unit: YUnit): void {
    this.coordinateSystem.setYUnit(unit);
  }

  // --- the full upload → analyze → separate → render flow ------------------

  /**
   * Handle a candidate upload end to end. Validates the file, loads it into the
   * Audio_Engine, runs an in-browser mix analysis pass that emits
   * Timeline_Points into the shared stream (so the Graph_Renderer ingests them),
   * then triggers Demucs separation, per-stem analysis, and chord derivation,
   * surfacing status through the StatusBanner.
   */
  async handleUpload(file: File): Promise<UploadOutcome> {
    this.analysisMessage = null;
    this.separationMessage = null;
    this.emitStatusMessage();

    // 1) Pure validation (Req 1.1-1.4).
    const validation = validateUpload(file, this.config.maxUploadBytes);
    if (!validation.ok) {
      this.callbacks.onStatusMessage?.(validation.message, "error");
      return { ok: false, stage: "validation", reason: validation.reason };
    }

    // 2) Decode + load into the Audio_Engine (Req 1.1, 1.5, 1.6).
    const load = await this.audioEngine.load(file);
    if (!load.ok) {
      this.callbacks.onStatusMessage?.(DECODE_FAILED_MESSAGE, "error");
      this.callbacks.onPlayback?.({
        isLoaded: false,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      });
      return { ok: false, stage: "decode" };
    }

    const duration = load.durationSeconds;

    // Reset per-file state: clear the timeline + renderer buffers and the
    // accumulated analysis status so the new song starts clean.
    this.timeline.reset();
    this.graphRenderer.resetStems();
    this.timeline.setSongDuration(duration);
    this.coordinateSystem.setSongDuration(duration);
    this.isPlaying = false;
    this.lastPushedTime = -1;
    this.analysisEngine = this.analysisEngineFactory({ stream: this.timeline });

    // Reset overlay state: every stem enabled on load (Req 6.4) with defaults.
    this.callbacks.onStemConfig?.(createInitialStemConfig());
    this.syncStemDefaults();

    this.pushPlayback({ isLoaded: true, isPlaying: false, currentTime: 0, duration });
    this.pushPointCounts();
    this.pushAnalysisStatus();

    // 3) In-browser mix analysis (Req 3.4, 12.4): emits Timeline_Points into the
    // shared stream; the Graph_Renderer's per-stem subscriptions ingest them.
    const mixBuffer = this.audioEngine.getBuffer();
    if (mixBuffer) {
      await this.analysisEngine.analyze(mixBuffer, "mix");
    }
    this.refresh();

    // 4) Stem separation + per-stem analysis + chords (Req 4.8-4.10, 12.5, 12.6).
    await this.runSeparation(file, mixBuffer);

    return { ok: true };
  }

  // --- internals -----------------------------------------------------------

  /**
   * Trigger Demucs separation. On success, the client dispatches exactly one
   * analysis pass per returned stem (Req 4.8) via the injected stem analyzer
   * (`other → melody`, Req 4.9), after which chords are derived from the mix
   * only (Req 4.10). An unreachable service surfaces the "unavailable" message
   * while the loaded file and its in-browser analysis are retained (Req 12.6).
   */
  private async runSeparation(file: File, mixBuffer: AudioBuffer | null): Promise<void> {
    const client = this.demucsClientFactory({
      endpoint: this.config.demucsEndpoint,
      fetchFn: this.fetchFn,
      analyzer: this.stemAnalyzer(),
    });

    const result = await client.separate(file);

    if (result.ok) {
      // Chords come from harmonic analysis of the mix, never separation (Req 4.10).
      if (mixBuffer) {
        await this.analysisEngine.deriveChords(mixBuffer);
      }
      this.separationMessage = null;
    } else if (result.kind === "unavailable") {
      // Req 12.6: surface the message; do nothing destructive — the loaded file
      // and its in-browser analysis remain intact.
      this.separationMessage = STEM_SEPARATION_UNAVAILABLE_MESSAGE;
    } else {
      this.separationMessage = result.message;
    }

    this.refresh();
  }

  /**
   * The Analysis_Engine dispatcher handed to the Demucs client: download +
   * decode each returned stem and run exactly one analysis pass tagged with the
   * routed Stem_Type (Req 4.8). Decode failures skip the pass without throwing.
   */
  private stemAnalyzer(): StemAnalysisDispatcher {
    return {
      analyzeStem: async (stem: StemType, source: SeparatedStem) => {
        const buffer = await this.decodeStemFn(source);
        if (buffer) {
          await this.analysisEngine.analyze(buffer, stem);
        }
      },
    };
  }

  /** Set every stem renderer to enabled + its default style on a new load. */
  private syncStemDefaults(): void {
    const config = createInitialStemConfig();
    for (const stem of STEM_TYPES) {
      const renderer = this.graphRenderer.getStemRenderer(stem);
      renderer.setEnabled(config[stem].enabled);
      renderer.setStyle(config[stem].style);
    }
  }

  /** Push analysis status + point counts and recompute the status message. */
  private refresh(): void {
    this.pushAnalysisStatus();
    this.pushPointCounts();
    this.updateAnalysisMessage();
    this.emitStatusMessage();
  }

  private pushAnalysisStatus(): void {
    this.callbacks.onAnalysisStatus?.(this.analysisEngine.getStatus());
  }

  private pushPointCounts(): void {
    const counts = createEmptyPointCounts();
    for (const stem of STEM_TYPES) {
      counts[stem] = this.timeline.getPoints(stem).length;
    }
    this.callbacks.onPointCounts?.(counts);
  }

  private pushPlayback(snapshot?: PlaybackSnapshot): void {
    this.callbacks.onPlayback?.(
      snapshot ?? {
        isLoaded: this.audioEngine.isLoaded(),
        isPlaying: this.isPlaying,
        currentTime: this.audioEngine.getCurrentTime(),
        duration: this.audioEngine.getDuration(),
      },
    );
  }

  /** Derive the analysis StatusBanner message from the engine status. */
  private updateAnalysisMessage(): void {
    const status = this.analysisEngine.getStatus();
    const { failed, succeeded, pending } = status;
    if (failed.length > 0 && succeeded.length === 0 && pending.length === 0) {
      // Full failure / timeout (Req 3.5). Audio stays playable (Req 3.8).
      this.analysisMessage = "Analysis failed.";
    } else if (failed.length > 0) {
      // Partial failure — report which features failed (Req 3.6).
      this.analysisMessage = `Some features could not be analyzed: ${failed.join(", ")}.`;
    } else {
      this.analysisMessage = null;
    }
  }

  /** Combine analysis + separation messages into a single StatusBanner string. */
  private emitStatusMessage(): void {
    const parts: string[] = [];
    if (this.analysisMessage) parts.push(this.analysisMessage);
    if (this.separationMessage) parts.push(this.separationMessage);
    const message = parts.length > 0 ? parts.join(" ") : null;
    const tone: StatusTone = message ? "error" : "info";
    this.callbacks.onStatusMessage?.(message, tone);
  }

  /** Lazily create (and cache) an AudioContext used solely to decode stems. */
  private ensureDecodeContext(): AudioContext | null {
    if (this.decodeContext) return this.decodeContext;
    const g = globalThis as unknown as {
      AudioContext?: new () => AudioContext;
      webkitAudioContext?: new () => AudioContext;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return null;
    this.decodeContext = new Ctor();
    return this.decodeContext;
  }

  /** Resolve a (possibly relative) stem URL against the configured endpoint. */
  private resolveStemUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const base = this.config.demucsEndpoint.replace(/\/+$/, "");
    return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  /** Default stem decoder: fetch the stem URL and decode it via Web Audio. */
  private async defaultDecodeStem(source: SeparatedStem): Promise<AudioBuffer | null> {
    if (!this.fetchFn) return null;
    try {
      const response = await this.fetchFn(this.resolveStemUrl(source.url));
      if (!response.ok) return null;
      const data = await response.arrayBuffer();
      const context = this.ensureDecodeContext();
      if (!context) return null;
      return await context.decodeAudioData(data);
    } catch {
      return null;
    }
  }

  // --- playback poll loop (mirrors live currentTime to the UI, Req 2.4) ----

  private startPlaybackLoop(): void {
    const schedule =
      this.raf ??
      (typeof requestAnimationFrame !== "undefined"
        ? (cb: () => void) => requestAnimationFrame(cb)
        : null);
    if (!schedule) return; // headless: no loop (tests poll directly)
    if (this.rafHandle !== null) return;

    const tick = () => {
      const currentTime = this.audioEngine.getCurrentTime();
      // Throttle React updates: only push on a meaningful time change or while
      // playing so the slider/readout stay live without re-rendering every frame.
      if (
        this.isPlaying ||
        Math.abs(currentTime - this.lastPushedTime) >= 0.03
      ) {
        this.lastPushedTime = currentTime;
        this.pushPlayback();
      }
      this.rafHandle = schedule(tick);
    };
    this.rafHandle = schedule(tick);
  }

  private stopPlaybackLoop(): void {
    if (this.rafHandle === null) return;
    const cancel =
      this.cancelRaf ??
      (typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : null);
    cancel?.(this.rafHandle);
    this.rafHandle = null;
  }
}

/** Factory for a {@link HarmographController}. */
export function createHarmographController(
  options?: HarmographControllerOptions,
): HarmographController {
  return new HarmographController(options);
}
