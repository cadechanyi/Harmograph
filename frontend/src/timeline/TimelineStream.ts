/**
 * Timeline_Stream — the shared, normalized data stream consumed by the
 * Graph_Renderer's per-stem Stem_Renderers.
 *
 * Responsibilities (design "Timeline_Stream" component, Req 10):
 *  - Validate each emitted candidate and exclude invalid ones while retaining
 *    every previously accepted point (Req 10.1, 10.2, 10.4).
 *  - Route accepted points by `stem` so a subscriber only ever receives points
 *    for the stem it subscribed to (Req 10.3).
 *  - Keep per-stem buffers sorted by `t` (insertion by `t`) so both delivery
 *    and `getPoints` are non-decreasing in `t` (Req 10.5).
 *
 * This is a pure, framework-free module: it holds only in-memory state and has
 * no dependency on React, p5, or the browser audio APIs.
 */

import {
  STEM_TYPES,
  type StemType,
  type TimelinePoint,
} from "../models/types";

/** Callback returned by {@link TimelineStream.subscribe} to detach a listener. */
export type Unsubscribe = () => void;

/** A listener registered for a single stem. */
type Listener = (point: TimelinePoint) => void;

/** Optional construction settings for the stream. */
export interface TimelineStreamOptions {
  /**
   * The song duration in seconds. Accepted points must have `t ∈ [0,
   * songDuration]` (Req 10.1). Defaults to `Number.POSITIVE_INFINITY` so that,
   * before a duration is known, any finite non-negative `t` is accepted; call
   * {@link TimelineStream.setSongDuration} once the Audio_Engine reports the
   * real duration.
   */
  songDuration?: number;
}

const VALID_STEMS: ReadonlySet<string> = new Set(STEM_TYPES);

/**
 * Returns true when `x` is a real, finite number (rejects `NaN`, `±Infinity`,
 * and non-number types).
 */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export class TimelineStream {
  /** The configured upper bound for accepted `t` values, in seconds. */
  private songDuration: number;

  /** Per-stem sorted buffers of accepted points (non-decreasing in `t`). */
  private readonly buffers: Record<StemType, TimelinePoint[]>;

  /** Per-stem live subscribers notified of points accepted after they join. */
  private readonly listeners: Record<StemType, Set<Listener>>;

  constructor(options: TimelineStreamOptions = {}) {
    this.songDuration = options.songDuration ?? Number.POSITIVE_INFINITY;
    this.buffers = {
      drums: [],
      melody: [],
      bass: [],
      vocals: [],
      chords: [],
    };
    this.listeners = {
      drums: new Set(),
      melody: new Set(),
      bass: new Set(),
      vocals: new Set(),
      chords: new Set(),
    };
  }

  /**
   * Update the accepted `t` upper bound. Existing accepted points are retained
   * (Req 10.4); only validation of subsequent {@link emit} calls is affected.
   */
  setSongDuration(durationSeconds: number): void {
    this.songDuration = durationSeconds;
  }

  /** The currently configured song duration, in seconds. */
  getSongDuration(): number {
    return this.songDuration;
  }

  /**
   * Clear every per-stem buffer while retaining live subscribers and the
   * configured song duration. Used when a new file is loaded so points from a
   * previous song do not leak into the new one. Subscribers are NOT replayed;
   * the caller is expected to clear downstream renderer buffers too.
   */
  reset(): void {
    for (const stem of STEM_TYPES) {
      this.buffers[stem].length = 0;
    }
  }

  /**
   * Validate a candidate and, if valid, accept it onto the stream.
   *
   * A candidate is accepted only when it is an object with a numeric `t` in
   * `[0, songDuration]`, a numeric `value` in `[-1, 1]`, and a `stem` equal to
   * one of the five Stem_Types (Req 10.1, 10.2). Invalid candidates are
   * excluded and every previously accepted point is retained (Req 10.4).
   */
  emit(candidate: unknown): void {
    const point = this.validate(candidate);
    if (point === null) {
      return;
    }

    this.insertSorted(this.buffers[point.stem], point);

    for (const listener of this.listeners[point.stem]) {
      listener(point);
    }
  }

  /**
   * Subscribe to a single stem. The callback is invoked once for every point
   * currently stored for that stem (replayed in non-decreasing `t` order, per
   * Req 10.3 and Req 10.5) and once for each subsequently accepted point for
   * that stem. Returns an {@link Unsubscribe} that detaches the listener.
   */
  subscribe(stem: StemType, cb: Listener): Unsubscribe {
    // Replay the already-accepted points in sorted order (Req 10.3, 10.5).
    for (const point of this.buffers[stem]) {
      cb(point);
    }

    this.listeners[stem].add(cb);

    return () => {
      this.listeners[stem].delete(cb);
    };
  }

  /**
   * Returns the accepted points for a stem, sorted non-decreasing by `t`
   * (Req 10.5). The returned array is a defensive copy and is safe for the
   * caller to read without affecting stream state.
   */
  getPoints(stem: StemType): readonly TimelinePoint[] {
    return this.buffers[stem].slice();
  }

  /**
   * Validate an unknown candidate, returning a typed {@link TimelinePoint} when
   * it satisfies the normalized data model, or `null` when it must be excluded.
   */
  private validate(candidate: unknown): TimelinePoint | null {
    if (typeof candidate !== "object" || candidate === null) {
      return null;
    }

    const { t, value, stem } = candidate as {
      t?: unknown;
      value?: unknown;
      stem?: unknown;
    };

    if (!isFiniteNumber(t) || !isFiniteNumber(value)) {
      return null;
    }
    if (typeof stem !== "string" || !VALID_STEMS.has(stem)) {
      return null;
    }
    if (t < 0 || t > this.songDuration) {
      return null;
    }
    if (value < -1 || value > 1) {
      return null;
    }

    return { t, value, stem: stem as StemType };
  }

  /**
   * Insert `point` into `buffer` keeping the buffer non-decreasing by `t`. Ties
   * are inserted after existing equal-`t` points so that, among equal times,
   * emission order is preserved (Req 10.5).
   */
  private insertSorted(buffer: TimelinePoint[], point: TimelinePoint): void {
    let lo = 0;
    let hi = buffer.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (buffer[mid].t <= point.t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    buffer.splice(lo, 0, point);
  }
}
