import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TimelineStream } from "./TimelineStream";
import { STEM_TYPES, type StemType } from "../models/types";

/**
 * Property-based test for the normalized Timeline_Point data model.
 *
 * This file is intentionally dedicated to Property 3 alone (a distinct filename
 * from the sibling timeline property tests for tasks 7.3/7.4/7.5) so the
 * orchestrator can run each property independently.
 */

const VALID_STEMS = new Set<string>(STEM_TYPES);

/**
 * Generator for candidate feature samples that mixes well-formed points with a
 * wide variety of malformed ones (out-of-range `t`/`value`, non-numeric fields,
 * unknown/garbage stems, and missing fields). This exercises both the accept
 * and reject paths of the stream so the invariant is checked against real data
 * that survives validation.
 */
function candidateArb(songDuration: number): fc.Arbitrary<unknown> {
  // A `t` that is sometimes in-range, sometimes out, and sometimes not a number.
  const tArb = fc.oneof(
    fc.double({ min: 0, max: songDuration, noNaN: true }), // in range
    fc.double(), // any double, incl. NaN/Infinity/out-of-range
    fc.constantFrom("0", null, undefined),
  );
  // A `value` that is sometimes in [-1, 1], sometimes out, sometimes not numeric.
  const valueArb = fc.oneof(
    fc.double({ min: -1, max: 1, noNaN: true }), // in range
    fc.double(), // any double, incl. NaN/Infinity/out-of-range
    fc.constantFrom("0.5", null, undefined),
  );
  // A `stem` that is sometimes valid, sometimes a garbage string.
  const stemArb = fc.oneof(
    fc.constantFrom<string>(...STEM_TYPES),
    fc.string(),
    fc.constantFrom("guitar", "", "DRUMS"),
  );

  return fc.oneof(
    // Structured candidates (the common case): each field independently varied.
    fc.record({ t: tArb, value: valueArb, stem: stemArb }),
    // Records missing one or more fields.
    fc.record({ value: valueArb, stem: stemArb }),
    fc.record({ t: tArb, stem: stemArb }),
    fc.record({ t: tArb, value: valueArb }),
    // Entirely non-object candidates.
    fc.constantFrom(null, undefined, 42, "point", true),
  );
}

describe("TimelineStream normalized data model (Property 3)", () => {
  // Feature: harmograph, Property 3: Every emitted Timeline_Point satisfies the normalized data model
  // Validates: Requirements 3.4, 10.1, 10.2
  it("every accepted point has numeric t in [0, songDuration], numeric value in [-1, 1], and a valid stem", () => {
    // A scenario couples a songDuration with a batch of candidate samples
    // generated against that same duration, so in-range candidates line up with
    // the stream's accept bound.
    const scenarioArb = fc
      .double({ min: 0.001, max: 100_000, noNaN: true })
      .chain((songDuration) =>
        fc
          .array(candidateArb(songDuration), { maxLength: 50 })
          .map((candidates) => ({ songDuration, candidates })),
      );

    fc.assert(
      fc.property(scenarioArb, ({ songDuration, candidates }) => {
        const stream = new TimelineStream({ songDuration });

        for (const candidate of candidates) {
          stream.emit(candidate);
        }

        for (const stem of STEM_TYPES) {
          const points = stream.getPoints(stem);
          for (const p of points) {
            // t: numeric and within [0, songDuration].
            expect(typeof p.t).toBe("number");
            expect(Number.isFinite(p.t)).toBe(true);
            expect(p.t).toBeGreaterThanOrEqual(0);
            expect(p.t).toBeLessThanOrEqual(songDuration);

            // value: numeric and within [-1, 1].
            expect(typeof p.value).toBe("number");
            expect(Number.isFinite(p.value)).toBe(true);
            expect(p.value).toBeGreaterThanOrEqual(-1);
            expect(p.value).toBeLessThanOrEqual(1);

            // stem: exactly one of the five StemTypes, and matches the bucket
            // it was routed into.
            expect(VALID_STEMS.has(p.stem)).toBe(true);
            expect(p.stem).toBe(stem as StemType);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
