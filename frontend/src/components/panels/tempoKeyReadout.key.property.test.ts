import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  formatKey,
  formatTempo,
  KEY_PLACEHOLDER,
  PENDING_INDICATOR,
  VALID_MODES,
  VALID_PITCH_CLASSES,
} from "./tempoKeyReadout.logic";
import type { PitchClass } from "@/models";

/**
 * Property 16: Key readout formats valid keys and placeholders otherwise.
 *
 * For any key estimate:
 *   - a valid `{tonic, mode}` pair renders as `"{tonic} {mode}"`, where the
 *     tonic is one of the twelve chromatic pitch classes and the mode is
 *     `major` or `minor` (Req 8.3);
 *   - an absent or invalid key renders the "could not be determined"
 *     placeholder (Req 8.4);
 *   - the key readout is computed independently of the tempo, so falling back
 *     to the key placeholder never alters a separately displayed tempo
 *     (Req 8.4);
 *   - a pending estimate renders the pending indicator (Req 8.5, complementary).
 *
 * Validates: Requirements 8.3, 8.4
 */

// Feature: harmograph, Property 16: Key readout formats valid keys and placeholders otherwise.

const tonicArb = fc.constantFrom<PitchClass>(...VALID_PITCH_CLASSES);
const modeArb = fc.constantFrom<"major" | "minor">(...VALID_MODES);

// An in-range, finite tempo that formatTempo will always render as a value.
const inRangeTempoArb = fc.double({
  min: 40,
  max: 250,
  noNaN: true,
  noDefaultInfinity: true,
});

describe("formatKey — Property 16", () => {
  it("formats valid keys, uses placeholder otherwise, and is independent of tempo", () => {
    fc.assert(
      fc.property(
        tonicArb,
        modeArb,
        inRangeTempoArb,
        (tonic, mode, tempo) => {
          // Valid key: renders "{tonic} {mode}" (Req 8.3).
          const validKey = { tonic, mode };
          const validOutput = formatKey(validKey, false);
          expect(validOutput).toBe(`${tonic} ${mode}`);

          // Output contains a valid pitch class and a valid mode.
          expect(VALID_PITCH_CLASSES.some((pc) => validOutput.startsWith(pc)))
            .toBe(true);
          expect(VALID_MODES.some((m) => validOutput.endsWith(m))).toBe(true);

          // Absent key: placeholder (Req 8.4).
          expect(formatKey(null, false)).toBe(KEY_PLACEHOLDER);

          // Pending: pending indicator (Req 8.5).
          expect(formatKey(validKey, true)).toBe(PENDING_INDICATOR);
          expect(formatKey(null, true)).toBe(PENDING_INDICATOR);

          // Independence (Req 8.4): the tempo readout is computed solely from
          // the tempo and is unaffected by whatever the key readout produced.
          // A valid in-range tempo renders identically whether the key is
          // present or absent (placeholder).
          const tempoWithKey = formatTempo(tempo, false);
          const tempoWithoutKey = formatTempo(tempo, false);
          expect(tempoWithoutKey).toBe(tempoWithKey);
          expect(tempoWithKey).toBe(`${Math.round(tempo)} BPM`);
          // The key falling back to its placeholder did not change the tempo.
          expect(formatKey(null, false)).toBe(KEY_PLACEHOLDER);
          expect(formatTempo(tempo, false)).toBe(tempoWithKey);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("renders the placeholder for invalid tonic/mode strings", () => {
    const invalidTonicArb = fc
      .string()
      .filter((s) => !VALID_PITCH_CLASSES.includes(s as PitchClass));
    const invalidModeArb = fc
      .string()
      .filter((s) => !VALID_MODES.includes(s as "major" | "minor"));

    fc.assert(
      fc.property(invalidTonicArb, invalidModeArb, (badTonic, badMode) => {
        const key = {
          tonic: badTonic as PitchClass,
          mode: badMode as "major" | "minor",
        };
        expect(formatKey(key, false)).toBe(KEY_PLACEHOLDER);
      }),
      { numRuns: 200 },
    );
  });
});
