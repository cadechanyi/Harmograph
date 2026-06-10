import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { resolveStyle } from "./panels/GraphStylePicker";
import {
  DEFAULT_STYLE,
  STEM_TYPES,
  type GraphStyle,
  type StemType,
} from "@/models";

/**
 * Property 14: An unselected stem resolves to its table default style.
 *
 * For any StemType for which the user has made no explicit style selection,
 * the active Graph_Style equals the single default defined for that stem in
 * the Default Graph Styles table (Req 7.5, 7.6). As a complementary check, an
 * explicit selection is always honoured verbatim.
 *
 * Validates: Requirements 7.5, 7.6
 */

// Feature: harmograph, Property 14: An unselected stem resolves to its table default style.

const ALL_STYLES: GraphStyle[] = [
  "bouncing_balls",
  "parametric_curve",
  "sine_wave",
  "rms_envelope",
  "stacked_curves",
];

const stemArb = fc.constantFrom<StemType>(...STEM_TYPES);

// A "selection state" that is sometimes absent (no selection) and sometimes a
// concrete GraphStyle, mirroring how the picker passes `selected?`.
const selectionArb: fc.Arbitrary<GraphStyle | undefined> = fc.oneof(
  fc.constant<GraphStyle | undefined>(undefined),
  fc.constantFrom<GraphStyle>(...ALL_STYLES),
);

describe("GraphStylePicker.resolveStyle — Property 14", () => {
  it("the Default Graph Styles table covers exactly the five stems with documented values", () => {
    // The table maps exactly the five canonical stems (Req 7.6).
    expect(Object.keys(DEFAULT_STYLE).sort()).toEqual(
      [...STEM_TYPES].sort(),
    );
    // Each stem's documented single default style (Req 7.6).
    expect(DEFAULT_STYLE).toEqual({
      drums: "bouncing_balls",
      melody: "parametric_curve",
      bass: "sine_wave",
      vocals: "rms_envelope",
      chords: "stacked_curves",
    });
  });

  it("resolves an unselected stem to its table default, and honours explicit selections", () => {
    fc.assert(
      fc.property(stemArb, selectionArb, (stem, selection) => {
        if (selection === undefined) {
          // No explicit selection → the stem's table default (Req 7.5, 7.6).
          expect(resolveStyle(stem, selection)).toBe(DEFAULT_STYLE[stem]);
          // Calling without the optional argument behaves identically.
          expect(resolveStyle(stem)).toBe(DEFAULT_STYLE[stem]);
        } else {
          // An explicit selection is honoured verbatim.
          expect(resolveStyle(stem, selection)).toBe(selection);
        }
      }),
      { numRuns: 200 },
    );
  });
});
