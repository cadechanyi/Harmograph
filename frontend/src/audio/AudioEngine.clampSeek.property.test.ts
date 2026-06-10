import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { clampSeek } from "./AudioEngine";

/**
 * Property 2: Seek position is always clamped into the playback range.
 *
 * For any requested seek time and song duration, the resulting playback
 * position lies within `[0, duration]`, equals the requested time when the
 * requested time is already inside the range, and equals the nearest boundary
 * otherwise. The implementation collapses a non-positive or non-finite
 * duration to an upper bound of 0, so the result is always 0 in that case.
 *
 * Validates: Requirements 2.3, 2.5
 */

// Feature: harmograph, Property 2: Seek position is always clamped into the playback range.

// Arbitrary finite requested times, including negatives and values well beyond
// any plausible duration.
const requestedTimeArb = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

// Arbitrary durations including 0 and positive finite values.
const durationArb = fc.double({
  min: 0,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("clampSeek — Property 2", () => {
  it("clamps the requested seek time into the playback range", () => {
    fc.assert(
      fc.property(requestedTimeArb, durationArb, (requested, duration) => {
        const result = clampSeek(requested, duration);

        if (duration > 0) {
          // Result always lies within the playback range.
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(duration);

          if (requested < 0) {
            // Below the range: clamp to the lower boundary.
            expect(result).toBe(0);
          } else if (requested > duration) {
            // Above the range: clamp to the upper boundary.
            expect(result).toBe(duration);
          } else {
            // Already inside the range: returned unchanged.
            expect(result).toBe(requested);
          }
        } else {
          // Non-positive duration collapses the range to [0, 0].
          expect(result).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });
});
