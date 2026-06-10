import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TimelineStream } from "./TimelineStream";
import { STEM_TYPES, type StemType, type TimelinePoint } from "../models/types";

/**
 * Property-based test for Property 4 of the Harmograph design.
 *
 * // Feature: harmograph, Property 4: Invalid candidates are excluded and prior points retained
 *
 * Validates: Requirements 10.4
 *
 * Strategy: generate a mixed sequence of valid and deliberately-invalid
 * candidates, independently compute the expected set of valid points using the
 * same acceptance rule as the implementation, emit every candidate, and assert
 *  (a) the union of getPoints across all stems equals exactly the expected
 *      valid set (as a multiset), and
 *  (b) emitting any candidate (invalid or valid) never removes a previously
 *      accepted point — the accepted multiset only ever grows and the prior
 *      multiset is always retained as a subset.
 */

const VALID_STEMS: ReadonlySet<string> = new Set(STEM_TYPES);

/** Mirrors TimelineStream's private numeric guard (rejects NaN/±Infinity/non-number). */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Reference acceptance rule, independent of the implementation. Returns the
 * normalized point when a candidate should be accepted for the given duration,
 * or null when it must be excluded.
 */
function referenceValidate(
  candidate: unknown,
  songDuration: number,
): TimelinePoint | null {
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
  if (t < 0 || t > songDuration) {
    return null;
  }
  if (value < -1 || value > 1) {
    return null;
  }
  return { t, value, stem: stem as StemType };
}

/** A stable multiset key for a point. */
function pointKey(p: TimelinePoint): string {
  return `${p.stem}|${p.t}|${p.value}`;
}

/** Build a multiset (key -> count) from a list of points. */
function toMultiset(points: readonly TimelinePoint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of points) {
    const k = pointKey(p);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** All currently-accepted points across every stem. */
function allPoints(stream: TimelineStream): TimelinePoint[] {
  return STEM_TYPES.flatMap((stem) => [...stream.getPoints(stem)]);
}

/** True when multiset `sub` is contained (with counts) in multiset `sup`. */
function isSubMultiset(
  sub: Map<string, number>,
  sup: Map<string, number>,
): boolean {
  for (const [k, count] of sub) {
    if ((sup.get(k) ?? 0) < count) {
      return false;
    }
  }
  return true;
}

/**
 * Candidate generator for a given duration: a mix of well-formed points and a
 * variety of deliberately-malformed candidates so each run exercises both the
 * accept and exclude paths.
 */
function candidateArb(songDuration: number): fc.Arbitrary<unknown> {
  const validValue = fc.double({ min: -1, max: 1, noNaN: true });
  const validT = fc.double({ min: 0, max: songDuration, noNaN: true });
  const anyStem = fc.constantFrom(...STEM_TYPES);

  const valid = fc.record({ t: validT, value: validValue, stem: anyStem });

  const missingT = fc.record({ value: validValue, stem: anyStem });
  const missingValue = fc.record({ t: validT, stem: anyStem });
  const missingStem = fc.record({ t: validT, value: validValue });

  const badStem = fc.record({
    t: validT,
    value: validValue,
    // Arbitrary string (may rarely coincide with a real stem — the reference
    // rule decides correctness either way) plus explicit non-stem labels.
    stem: fc.oneof(fc.string(), fc.constantFrom("guitar", "piano", "", "DRUMS")),
  });

  const outOfRangeT = fc.record({
    t: fc.oneof(
      fc.double({ min: -1000, max: -0.0001, noNaN: true }),
      fc.double({
        min: songDuration + 0.0001,
        max: songDuration + 1000,
        noNaN: true,
      }),
    ),
    value: validValue,
    stem: anyStem,
  });

  const outOfRangeValue = fc.record({
    t: validT,
    value: fc.oneof(
      fc.double({ min: -1000, max: -1.0001, noNaN: true }),
      fc.double({ min: 1.0001, max: 1000, noNaN: true }),
    ),
    stem: anyStem,
  });

  const nonFiniteNumeric = fc.record({
    t: fc.constantFrom(NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    value: validValue,
    stem: anyStem,
  });

  const wrongType = fc.record({
    t: fc.oneof(fc.string(), fc.boolean()),
    value: validValue,
    stem: anyStem,
  });

  const notAnObject = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.string(),
    fc.boolean(),
  );

  return fc.oneof(
    { weight: 5, arbitrary: valid },
    { weight: 1, arbitrary: missingT },
    { weight: 1, arbitrary: missingValue },
    { weight: 1, arbitrary: missingStem },
    { weight: 1, arbitrary: badStem },
    { weight: 1, arbitrary: outOfRangeT },
    { weight: 1, arbitrary: outOfRangeValue },
    { weight: 1, arbitrary: nonFiniteNumeric },
    { weight: 1, arbitrary: wrongType },
    { weight: 1, arbitrary: notAnObject },
  );
}

/** Generates a duration plus a mixed sequence of candidates for that duration. */
const scenarioArb = fc
  .double({ min: 1, max: 10_000, noNaN: true })
  .chain((songDuration) =>
    fc
      .array(candidateArb(songDuration), { minLength: 0, maxLength: 200 })
      .map((candidates) => ({ songDuration, candidates })),
  );

describe("TimelineStream — Property 4: invalid-candidate exclusion (Req 10.4)", () => {
  // Feature: harmograph, Property 4: Invalid candidates are excluded and prior points retained
  it("excludes exactly the invalid candidates and never removes a prior point", () => {
    fc.assert(
      fc.property(scenarioArb, ({ songDuration, candidates }) => {
        const stream = new TimelineStream({ songDuration });

        // Independently computed expected accepted set (same rule as impl).
        const expected: TimelinePoint[] = [];
        let prev = toMultiset([]);

        for (const candidate of candidates) {
          const ref = referenceValidate(candidate, songDuration);
          if (ref !== null) {
            expected.push(ref);
          }

          stream.emit(candidate);

          // (b) Monotonic growth: the prior accepted multiset must remain a
          // subset of the current one — no previously accepted point is ever
          // dropped, whether the just-emitted candidate was valid or invalid.
          const current = toMultiset(allPoints(stream));
          expect(isSubMultiset(prev, current)).toBe(true);

          // The running accepted count matches the running expected count.
          expect(allPoints(stream).length).toBe(expected.length);

          prev = current;
        }

        // (a) Final state: union across all stems == expected valid multiset.
        const finalMultiset = toMultiset(allPoints(stream));
        const expectedMultiset = toMultiset(expected);
        expect(finalMultiset.size).toBe(expectedMultiset.size);
        expect(isSubMultiset(finalMultiset, expectedMultiset)).toBe(true);
        expect(isSubMultiset(expectedMultiset, finalMultiset)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
