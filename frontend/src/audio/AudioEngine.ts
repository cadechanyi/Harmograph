/**
 * Audio_Engine — Web Audio decode/playback wrapper (Req 1.1, 1.5, 1.6, 2.1-2.7).
 *
 * Mirrors the design's "Audio_Engine" interface. It wraps the Web Audio API
 * (`AudioContext`, `decodeAudioData`, `AudioBufferSourceNode`) and owns the
 * authoritative playback position and song duration.
 *
 * Responsibilities:
 *   - `load(file)`        decode the file to an `AudioBuffer`; duration must be
 *                         `> 0` on success, otherwise `decode_failed`
 *                         (Req 1.1, 1.5, 1.6).
 *   - `play()`            begin playback from the current position (defaults to
 *                         0); does nothing when no file is loaded
 *                         (Req 2.1, 2.6).
 *   - `pause()`           suspend playback and retain the current position
 *                         (Req 2.2).
 *   - `seek(t)`           set the position, clamping `t` into `[0, duration]`
 *                         (Req 2.3, 2.5).
 *   - `getCurrentTime()`  the live playback time in seconds; computed from the
 *                         context clock so callers polling at >= 30 Hz always
 *                         read a fresh value (Req 2.4).
 *   - `getDuration()`     the decoded song duration in seconds (Req 1.6).
 *   - `isLoaded()`        whether a file is loaded (Req 2.6).
 *   - `onEnded(cb)`       register a callback fired when playback reaches the
 *                         song duration; the position is retained at the
 *                         duration (Req 2.7).
 *
 * The `clampSeek` helper is exported as a pure function so the seek-clamp
 * property (design Property 2) can target it directly.
 */

/** The result of attempting to load and decode an audio file. */
export type LoadResult =
  | { ok: true; durationSeconds: number }
  | { ok: false; reason: "decode_failed" };

/** The public Audio_Engine surface consumed by the Frontend. */
export interface AudioEngine {
  /** Decode `file` into an AudioBuffer; `decode_failed` when undecodable. */
  load(file: File): Promise<LoadResult>;
  /** Begin playback from the current position; no-op when no file is loaded. */
  play(): void;
  /** Suspend playback, retaining the current position. */
  pause(): void;
  /** Set the playback position, clamped into `[0, duration]`. */
  seek(timeSeconds: number): void;
  /** The current playback time in seconds. */
  getCurrentTime(): number;
  /** The decoded song duration in seconds (0 until a file is loaded). */
  getDuration(): number;
  /** Whether an audio file is loaded. */
  isLoaded(): boolean;
  /** Register a callback fired when playback reaches the song duration. */
  onEnded(cb: () => void): void;
  /**
   * The decoded mix AudioBuffer for the loaded file, or `null` when no file is
   * loaded. Exposed so the Analysis_Engine can run an in-browser pass on the
   * decoded mix without re-decoding the file (Req 3.4, 12.4).
   */
  getBuffer(): AudioBuffer | null;
}

/**
 * Clamp a requested seek time into the playback range `[0, duration]`
 * (Req 2.3, 2.5).
 *
 * Pure and total: returns the requested time when it already lies inside the
 * range, the nearest boundary otherwise, and is robust to non-finite inputs.
 * A non-positive or non-finite `duration` collapses the range to `[0, 0]`, so
 * the result is always `0` (e.g. before a file is loaded).
 *
 * @param timeSeconds - The requested playback position in seconds.
 * @param duration - The song duration in seconds.
 * @returns A position within `[0, max(duration, 0)]`.
 */
export function clampSeek(timeSeconds: number, duration: number): number {
  const upper = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const t = Number.isFinite(timeSeconds) ? timeSeconds : 0;
  if (t < 0) return 0;
  if (t > upper) return upper;
  return t;
}

/** Factory for the global AudioContext constructor, if available. */
type AudioContextFactory = () => AudioContext;

/** Options for {@link WebAudioEngine}, primarily to inject a context in tests. */
export interface AudioEngineOptions {
  /**
   * Supplies the `AudioContext`. Defaults to the browser global
   * (`AudioContext` or the legacy `webkitAudioContext`). Injectable so the
   * engine can be exercised under jsdom with a lightweight stub.
   */
  audioContextFactory?: AudioContextFactory;
}

/** Resolve the default browser AudioContext constructor. */
function defaultAudioContextFactory(): AudioContext {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) {
    throw new Error("Web Audio API is not available in this environment");
  }
  return new Ctor();
}

/**
 * Decode an ArrayBuffer to an AudioBuffer, supporting both the modern
 * promise-returning `decodeAudioData` and the legacy callback form.
 */
function decodeAudio(
  context: AudioContext,
  data: ArrayBuffer,
): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const onOk = (buffer: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(buffer);
      }
    };
    const onErr = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error("decode_failed"));
      }
    };
    try {
      const maybePromise = context.decodeAudioData(data, onOk, onErr);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(onOk, onErr);
      }
    } catch (err) {
      onErr(err);
    }
  });
}

/**
 * Concrete Audio_Engine backed by the Web Audio API.
 *
 * Playback uses a fresh `AudioBufferSourceNode` per play/seek (source nodes are
 * single-use). The current position is derived from the context clock while
 * playing and from the retained `pausedAt` offset while paused, so
 * {@link WebAudioEngine.getCurrentTime} is always live.
 */
export class WebAudioEngine implements AudioEngine {
  private readonly audioContextFactory: AudioContextFactory;

  private context: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private activeSource: AudioBufferSourceNode | null = null;

  private durationSeconds = 0;
  private loaded = false;
  private playing = false;

  /** Retained playback position in seconds; defaults to 0 (Req 2.1, 2.2). */
  private pausedAt = 0;
  /** Context clock time captured when the active source started. */
  private startContextTime = 0;
  /** Buffer offset (seconds) the active source started from. */
  private startOffset = 0;

  private readonly endedCallbacks: Array<() => void> = [];

  constructor(options: AudioEngineOptions = {}) {
    this.audioContextFactory =
      options.audioContextFactory ?? defaultAudioContextFactory;
  }

  async load(file: File): Promise<LoadResult> {
    // Tear down any in-flight playback from a previous file.
    this.stopSource();
    this.playing = false;
    this.pausedAt = 0;

    const context = this.ensureContext();

    let decoded: AudioBuffer;
    try {
      const data = await file.arrayBuffer();
      decoded = await decodeAudio(context, data);
    } catch {
      // Undecodable contents: the file is not loaded (Req 1.5).
      this.loaded = false;
      this.buffer = null;
      this.durationSeconds = 0;
      return { ok: false, reason: "decode_failed" };
    }

    // A successful decode must yield a positive duration (Req 1.6). A
    // degenerate zero-length buffer is treated as undecodable.
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) {
      this.loaded = false;
      this.buffer = null;
      this.durationSeconds = 0;
      return { ok: false, reason: "decode_failed" };
    }

    this.buffer = decoded;
    this.durationSeconds = decoded.duration;
    this.loaded = true;
    this.pausedAt = 0; // current position defaults to 0 (Req 2.1)
    return { ok: true, durationSeconds: this.durationSeconds };
  }

  play(): void {
    // No file loaded: do not begin playback (Req 2.6). The "no audio loaded"
    // message is surfaced by the UI layer.
    if (!this.loaded || !this.buffer || !this.context) return;
    if (this.playing) return;

    // The context may start suspended under autoplay policies; resume it.
    void this.context.resume?.();
    this.startSource(this.pausedAt);
  }

  pause(): void {
    if (!this.playing) return;
    // Capture the live position before stopping, then retain it (Req 2.2).
    const position = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
    this.pausedAt = position;
  }

  seek(timeSeconds: number): void {
    const target = clampSeek(timeSeconds, this.durationSeconds);
    if (this.playing) {
      // Restart the source from the new position (source nodes are single-use).
      this.stopSource();
      this.pausedAt = target;
      this.startSource(target);
    } else {
      this.pausedAt = target;
    }
  }

  getCurrentTime(): number {
    if (this.playing && this.context && this.activeSource) {
      const elapsed = this.context.currentTime - this.startContextTime;
      return clampSeek(this.startOffset + elapsed, this.durationSeconds);
    }
    return this.pausedAt;
  }

  getDuration(): number {
    return this.durationSeconds;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  onEnded(cb: () => void): void {
    this.endedCallbacks.push(cb);
  }

  /** Lazily create (and cache) the AudioContext. */
  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = this.audioContextFactory();
    }
    return this.context;
  }

  /** Start a fresh source node playing from `offset` seconds. */
  private startSource(offset: number): void {
    const context = this.context;
    const buffer = this.buffer;
    if (!context || !buffer) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      // Ignore the 'ended' event from a source we deliberately stopped; only a
      // natural end (still the active source) should suspend at duration.
      if (this.activeSource !== source) return;
      this.handleNaturalEnd();
    };

    this.activeSource = source;
    this.startOffset = offset;
    this.startContextTime = context.currentTime;
    this.playing = true;
    source.start(0, offset);
  }

  /** Stop and detach the active source without firing the ended callbacks. */
  private stopSource(): void {
    const source = this.activeSource;
    // Clear first so the source's onended handler treats this as a manual stop.
    this.activeSource = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // start()-less or already-stopped nodes throw; safe to ignore.
    }
    try {
      source.disconnect();
    } catch {
      // Disconnecting an unconnected node throws on some implementations.
    }
  }

  /** Handle a natural end-of-playback: suspend and retain at duration (Req 2.7). */
  private handleNaturalEnd(): void {
    this.activeSource = null;
    this.playing = false;
    this.pausedAt = this.durationSeconds;
    for (const cb of this.endedCallbacks) {
      cb();
    }
  }
}

/** Factory for a fresh Audio_Engine. */
export function createAudioEngine(options?: AudioEngineOptions): AudioEngine {
  return new WebAudioEngine(options);
}
