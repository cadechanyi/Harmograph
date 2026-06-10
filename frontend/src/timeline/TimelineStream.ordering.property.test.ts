import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TimelineStream } from "./TimelineStream";
import { STEM_TYPES, type StemType, type TimelinePoint } from "../models/types";

/**
 * Property-based test for Property 8 of the Harmograph design.
 *
 * // Feature: harmograph, Property 8: Points are delivered in non-decreasing time order
 *
 * Validates: Requirements 10.5
 *
 * Design statement (Property 8):
 *   For any emission order of valid Timeline_Points for a stem, the points
 *   delivered to (and stored for) that stem's subscriber are ordered
 *   non-decreasing by their `t` field.
 *
 * Strategy: generate valid Timeline_Points for a single stem and emit them in
 * an ARBITRARY (frequently unsorted) `t` order. The design's ordering
 * guarantee applies to the stored buffer and to subscribe-replay (the points
 * delivered to a subscriber that joins after emission), so we assert:
 *  (a) getPoints(stem) is non-decreasing in `t`, and
 *  (b) a subscriber added after emission replays the points in non-decreasing
 *      `t` order, and that replay equals getPoints(stem) exactly.
 * We also confirm no points are lost (counts match) and that points are routed
 * only to their own stem.
 */

/** True when a list of points is non-decreasing in `t`. */
function isNonDecreasingByT(points: readonly TimelinePoint[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (points[i].t < points[i - 1].t) {
      return false;
    }
  }
  return true;
}

/** Generates a valid Timeline_Point for the given stem within `[0, duration]`. */
function validPointArb(
  stem: StemType,
  songDuration: number,
): fc.Arbitrary<TimelinePoint> {
  return fc.record({
    t: fc.double({ min: 0, max: songDuration, noNaN: true }),
    value: fc.double({ min: -1, max: 1, noNaN: true }),
    stem: fc.constant(stem),
  });
}

/**
 * Generates a duration, a target stem, and a sequence of valid points for that
 * stem emitted in arbitrary order.
 */
const scenarioArb = fc
  .record({
    songDuration: fc.double({ min: 1, max: 10_000, noNaN: true }),
    stem: fc.constantFrom(...STEM_TYPES),
  })
  .chain(({ songDuration, stem }) =>
    fc
      .array(validPointArb(stem, songDuration), { minLength: 0, maxLength: 200 })
      .map((points) => ({ songDuration, stem, points })),
  );

describe("TimelineStream — Property 8: non-decreasing delivery order (Req 10.5)", () => {
  // Feature: harmograph, Property 8: Points are delivered in non-decreasing time order
  it("stores and replays a stem's points in non-decreasing t order regardless of emission order", () => {
    fc.assert(
      fc.property(scenarioArb, ({ songDuration, stem, points }) => {
        const stream = new TimelineStream({ songDuration });

        // Emit valid points in arbitrary (often unsorted) t order.
        for (const point of points) {
          stream.emit(point);
        }

        // (a) The stored buffer is non-decreasing in t.
        const stored = stream.getPoints(stem);
        expect(isNonDecreasingByT(stored)).toBe(true);

        // No points are lost: every emitted point is retained.
        expect(stored.length).toBe(points.length);

        // (b) A subscriber joining after emission replays in non-decreasing t
        // order, and the replay matches getPoints exactly.
        const replayed: TimelinePoint[] = [];
        const unsubscribe = stream.subscribe(stem, (p) => replayed.push(p));
        unsubscribe();

        expect(isNonDecreasingByT(replayed)).toBe(true);
        expect(replayed).toEqual([...stored]);

        // Points are routed only to their own stem: every other stem is empty.
        for (const other of STEM_TYPES) {
          if (other !== stem) {
            expect(stream.getPoints(other).length).toBe(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
