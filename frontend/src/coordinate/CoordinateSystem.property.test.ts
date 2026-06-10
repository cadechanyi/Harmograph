import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createCoordinateSystem } from "./CoordinateSystem";
import type { YUnit } from "../models";

/**
 * Property 10: Coordinate mapping selects correct ranges and clamps to canvas.
 *
 * For any data value, song duration, active y-unit, and canvas dimensions:
 *   - the active y-range matches the selected unit (Req 9.3, 9.4);
 *   - the x-range is `[0, duration]` when `duration >= 1` and `[0, 1]` when
 *     `duration < 1` (Req 9.1, 9.2);
 *   - `yToCanvas(value)` equals `yToCanvas(clamp(value, activeYRange))`,
 *     i.e. clamping happens before mapping (Req 9.5);
 *   - every mapped x and y coordinate lies within the canvas bounds
 *     `[0, canvasWidth]` / `[0, canvasHeight]`.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

// Feature: harmograph, Property 10: Coordinate mapping selects correct ranges and clamps to canvas.

const Y_UNITS: YUnit[] = ["normalized", "hz", "midi", "db"];

const EXPECTED_RANGE: Record<YUnit, [number, number]> = {
  normalized: [-1, 1],
  hz: [20, 20000],
  midi: [0, 127],
  db: [-60, 0],
};

const yUnitArb = fc.constantFrom<YUnit>(...Y_UNITS);

// Arbitrary finite data values, including far out-of-range magnitudes.
const finiteValueArb = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

// Durations including 0, sub-second (< 1), and >= 1 values.
const durationArb = fc.double({
  min: 0,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

// Positive, finite canvas dimensions.
const dimensionArb = fc.double({
  min: 1,
  max: 1e4,
  noNaN: true,
  noDefaultInfinity: true,
});

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

describe("CoordinateSystem — Property 10", () => {
  it("selects correct ranges, clamps before mapping, and stays on-canvas", () => {
    fc.assert(
      fc.property(
        yUnitArb,
        durationArb,
        finiteValueArb,
        finiteValueArb,
        dimensionArb,
        dimensionArb,
        (unit, duration, value, tSeconds, canvasWidth, canvasHeight) => {
          const cs = createCoordinateSystem();
          cs.setSongDuration(duration);
          cs.setYUnit(unit);

          // --- Active y-range matches the selected unit (Req 9.3, 9.4) ---
          const [min, max] = cs.activeYRange();
          expect([min, max]).toEqual(EXPECTED_RANGE[unit]);

          // --- x-range selection (Req 9.1, 9.2) ---
          // xMax is `max(duration, 1)`: the upper bound of the x-range maps to
          // the full canvas width. When duration >= 1 the bound is `duration`;
          // when duration < 1 the bound is `1`.
          const xMax = Math.max(duration, 1);
          // The x-range upper bound maps exactly to canvasWidth.
          expect(cs.xToCanvas(xMax, canvasWidth)).toBeCloseTo(canvasWidth, 6);
          // t = 0 maps to the canvas origin.
          expect(cs.xToCanvas(0, canvasWidth)).toBe(0);
          if (duration < 1) {
            // Sub-second/zero durations floor to [0, 1]: t = 1 maps to full width.
            expect(cs.xToCanvas(1, canvasWidth)).toBeCloseTo(canvasWidth, 6);
          }

          // --- Clamp-before-map for y (Req 9.5) ---
          // yToCanvas(value) must equal yToCanvas(clamp(value, range)).
          const clampedValue = clamp(value, min, max);
          expect(cs.yToCanvas(value, canvasHeight)).toBe(
            cs.yToCanvas(clampedValue, canvasHeight),
          );

          // --- Every mapped coordinate lies within the canvas bounds ---
          const x = cs.xToCanvas(tSeconds, canvasWidth);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(canvasWidth);

          const y = cs.yToCanvas(value, canvasHeight);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(canvasHeight);
        },
      ),
      { numRuns: 200 },
    );
  });
});
