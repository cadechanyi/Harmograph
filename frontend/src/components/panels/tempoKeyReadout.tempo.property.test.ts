import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  formatTempo,
  PENDING_INDICATOR,
  TEMPO_PLACEHOLDER,
} from "./tempoKeyReadout.logic";

/**
 * Property 15: Tempo readout reflects plausibility.
 *
 * For any estimated tempo, the readout equals the tempo rounded to the nearest
 * integer beats per minute when the tempo is within `[40, 250]` (the default
 * plausible range), and equals the "could not be determined" placeholder
 * otherwise (Req 8.1, 8.2). The plausibility check applies to the RAW tempo
 * value; rounding happens only for display, so e.g. a raw value of 249.6 is
 * in range and renders as "250 BPM".
 *
 * Validates: Requirements 8.1, 8.2
 */

// Feature: harmograph, Property 15: Tempo readout reflects plausibility.

const [MIN, MAX] = [40, 250];

// Arbitrary tempo inputs spanning well below 40, within [40, 250], and well
// above 250, plus null and non-finite specials, so both branches and the
// inclusive boundaries are exercised.
const tempoArb: fc.Arbitrary<number | null> = fc.oneof(
  // Broad finite range covering far below MIN through far above MAX.
  fc.double({ min: -100, max: 400, noNaN: true, noDefaultInfinity: true }),
  // Concentrate samples near the inclusive boundaries (incl. rounding edges).
  fc.double({ min: 39, max: 41, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: 249, max: 251, noNaN: true, noDefaultInfinity: true }),
  // Non-plausible specials that must yield the placeholder.
  fc.constantFrom<number | null>(
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

describe("formatTempo — Property 15", () => {
  it("renders rounded BPM within [40, 250] and the placeholder otherwise", () => {
    fc.assert(
      fc.property(tempoArb, (tempoBpm) => {
        const result = formatTempo(tempoBpm, false);

        const inRange =
          tempoBpm !== null &&
          Number.isFinite(tempoBpm) &&
          tempoBpm >= MIN &&
          tempoBpm <= MAX;

        if (inRange) {
          // Range check is on the raw value; display rounds to nearest integer.
          expect(result).toBe(`${Math.round(tempoBpm as number)} BPM`);
        } else {
          expect(result).toBe(TEMPO_PLACEHOLDER);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("always yields the pending indicator when pending is true", () => {
    fc.assert(
      fc.property(tempoArb, (tempoBpm) => {
        expect(formatTempo(tempoBpm, true)).toBe(PENDING_INDICATOR);
      }),
      { numRuns: 200 },
    );
  });
});
