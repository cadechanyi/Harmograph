import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { routeStems, type SeparatedStem } from "./DemucsClient";
import { DEMUCS_TO_STEM, type DemucsStem, type StemType } from "../models";

/**
 * Property-based test for Property 5 of the Harmograph design.
 *
 * // Feature: harmograph, Property 5: Demucs stems route correctly and chords never come from separation
 *
 * Validates: Requirements 4.9, 4.10
 *
 * For any Demucs stem in `{drums, bass, vocals, other}`, the stem-routing map
 * (`DEMUCS_TO_STEM`) yields a `Stem_Type` in `{drums, bass, vocals, melody}`,
 * with `other` always mapping to `melody` (Req 4.9); no Demucs stem maps to
 * `chords` — `chords` is derived from harmonic analysis, never from separation
 * (Req 4.10).
 *
 * Two complementary checks:
 *  (a) the pure routing map `DEMUCS_TO_STEM` for an arbitrary Demucs stem, and
 *  (b) the pure `routeStems` function over arbitrary well-formed stem maps,
 *      asserting every routed entry obeys the same routing rule.
 */

/** The four Demucs stems Demucs can return (Req 4.1). */
const DEMUCS_STEMS: readonly DemucsStem[] = ["drums", "bass", "vocals", "other"];

/** The Stem_Types separation is allowed to produce. Never includes `chords`. */
const ALLOWED_ROUTED_STEMS: ReadonlySet<StemType> = new Set<StemType>([
  "drums",
  "melody",
  "bass",
  "vocals",
]);

/** A generator for a well-formed SeparatedStem descriptor. */
const separatedStemArb: fc.Arbitrary<SeparatedStem> = fc.record({
  url: fc.webUrl(),
  bytes: fc.integer({ min: 0, max: 5_000_000_000 }),
});

describe("DemucsClient — Property 5: Demucs stem routing (Req 4.9, 4.10)", () => {
  // Feature: harmograph, Property 5: Demucs stems route correctly and chords never come from separation
  it("routes every Demucs stem into the allowed Stem_Types, other→melody, never chords", () => {
    fc.assert(
      fc.property(
        // An arbitrary single Demucs stem ...
        fc.constantFrom(...DEMUCS_STEMS),
        // ... and an arbitrary well-formed subset of present stem files.
        fc.dictionary(
          fc.constantFrom(...DEMUCS_STEMS),
          separatedStemArb,
        ),
        (demucsStem, stemMap) => {
          // (a) The raw routing map for a single stem.
          const routedType = DEMUCS_TO_STEM[demucsStem];
          expect(ALLOWED_ROUTED_STEMS.has(routedType)).toBe(true);
          expect(routedType).not.toBe("chords");
          if (demucsStem === "other") {
            expect(routedType).toBe("melody");
          } else {
            // The other three are identity mappings.
            expect(routedType).toBe(demucsStem);
          }

          // (b) routeStems over an arbitrary well-formed stem map.
          const routed = routeStems(stemMap);

          // One routed entry per present, well-formed stem — no more.
          const presentKeys = Object.keys(stemMap);
          expect(routed.length).toBe(presentKeys.length);

          for (const entry of routed) {
            // The resolved Stem_Type matches the routing map exactly ...
            expect(entry.stem).toBe(DEMUCS_TO_STEM[entry.demucsStem]);
            // ... is always within the allowed set ...
            expect(ALLOWED_ROUTED_STEMS.has(entry.stem)).toBe(true);
            // ... is never `chords` (Req 4.10) ...
            expect(entry.stem).not.toBe("chords");
            // ... and `other` always resolves to `melody` (Req 4.9).
            if (entry.demucsStem === "other") {
              expect(entry.stem).toBe("melody");
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
