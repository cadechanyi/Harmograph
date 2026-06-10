/**
 * Coordinate_System — pure mapping from data space to canvas space.
 *
 * Mirrors the design's "Coordinate_System" interface. It is configurable per
 * axis and clamps out-of-range values before mapping so that every produced
 * coordinate lies within the canvas bounds.
 *
 * Axis rules (design "Components and Interfaces" → Coordinate_System):
 *   - x range is `[0, song_duration]`, or `[0, 1]` when duration is `0` or
 *     `< 1s` (Req 9.1, 9.2).
 *   - y range is the active y-unit range: normalized `[-1, 1]`, Hz
 *     `[20, 20000]`, MIDI `[0, 127]`, dB `[-60, 0]` (Req 9.3, 9.4).
 *   - `yToCanvas` clamps the value into the active y-range *before* mapping
 *     (Req 9.5).
 *
 * The canvas uses a top-left origin: the top of the active y-range maps to
 * canvas y `0` and the bottom maps to canvas y `canvasHeight`.
 */

import type { YUnit } from "../models";

/**
 * The y-axis ranges per selectable unit (Req 9.3, 9.4). Each entry is an
 * inclusive `[min, max]` pair with `min < max`.
 */
const Y_RANGES: Record<YUnit, readonly [number, number]> = {
  normalized: [-1, 1],
  hz: [20, 20000],
  midi: [0, 127],
  db: [-60, 0],
};

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export interface CoordinateSystem {
  /** Set the song duration; x range becomes `[0, max(d, 1)]` (Req 9.1, 9.2). */
  setSongDuration(d: number): void;
  /** Select the active y-axis unit mapping (Req 9.4). */
  setYUnit(unit: YUnit): void;
  /** Map a time in seconds to a canvas x coordinate in `[0, canvasWidth]` (Req 9.1). */
  xToCanvas(tSeconds: number, canvasWidth: number): number;
  /** Map a data value to a canvas y coordinate, clamping first (Req 9.5). */
  yToCanvas(value: number, canvasHeight: number): number;
  /** The active y-axis range as `[min, max]`. */
  activeYRange(): [number, number];
}

/**
 * Concrete, pure implementation of the Coordinate_System.
 */
export class CoordinateSystemImpl implements CoordinateSystem {
  /** Upper bound of the x range in seconds; always `>= 1` (Req 9.2). */
  private xMax = 1;
  /** The currently selected y-axis unit; defaults to normalized (Req 9.3). */
  private yUnit: YUnit = "normalized";

  setSongDuration(d: number): void {
    // x range is [0, song_duration], floored at 1 second so that a duration of
    // 0 or < 1s maps to [0, 1] (Req 9.1, 9.2). Guard against non-finite input.
    const safe = Number.isFinite(d) ? d : 0;
    this.xMax = Math.max(safe, 1);
  }

  setYUnit(unit: YUnit): void {
    this.yUnit = unit;
  }

  activeYRange(): [number, number] {
    const [min, max] = Y_RANGES[this.yUnit];
    return [min, max];
  }

  xToCanvas(tSeconds: number, canvasWidth: number): number {
    // Clamp the time into the x range so the result is always on-canvas
    // (Property 10: every mapped x lies within the canvas bounds).
    const t = clamp(Number.isFinite(tSeconds) ? tSeconds : 0, 0, this.xMax);
    return (t / this.xMax) * canvasWidth;
  }

  yToCanvas(value: number, canvasHeight: number): number {
    const [min, max] = this.activeYRange();
    // Clamp the value into the active y-range *before* mapping (Req 9.5).
    const clamped = clamp(Number.isFinite(value) ? value : min, min, max);
    // Top-left origin: the range maximum maps to y = 0 and the minimum maps to
    // y = canvasHeight, so larger data values render higher on the canvas.
    const fractionFromTop = (max - clamped) / (max - min);
    return fractionFromTop * canvasHeight;
  }
}

/** Factory for a fresh Coordinate_System with default configuration. */
export function createCoordinateSystem(): CoordinateSystem {
  return new CoordinateSystemImpl();
}
