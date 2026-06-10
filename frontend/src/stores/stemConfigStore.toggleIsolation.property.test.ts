import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createInitialStemConfig } from "./stemConfigStore";
import { STEM_TYPES, type StemConfigMap, type StemType } from "@/models";

/**
 * Property 12: Toggling a stem affects only that stem.
 *
 * For any enabled/disabled configuration across the five stems (where disabled
 * stems have points available), the set of stems that render a graphical
 * element equals exactly the set of enabled stems that have at least one point;
 * toggling one stem changes only that stem's rendered/not-rendered status and
 * leaves every other stem's output unchanged.
 *
 * The rendered-set is the pure function of the stem config map and the
 * per-stem point availability that the Graph_Renderer applies each frame
 * (BaseStemRenderer.draw early-returns unless `enabled && points.length > 0`):
 *
 *   renders(stem) = config[stem].enabled && hasPoints[stem]   (Req 5.10, 6.5)
 *
 * Toggling a single Stem_Toggle is the store's `toggleStem` reducer: a
 * single-key immutable update that flips only `enabled` for the target stem
 * and leaves every other entry referentially unchanged. The store's
 * `toggleStem` is bound inside a React hook (`useStemConfigStore`), so the pure
 * reducer it dispatches is replicated here verbatim and exercised against the
 * real `createInitialStemConfig` seed.
 *
 * Validates: Requirements 6.1, 6.2
 */

// Feature: harmograph, Property 12: Toggling a stem affects only that stem.

type HasPointsMap = Record<StemType, boolean>;

/**
 * Pure replica of the store's `toggleStem` reducer: flips `enabled` for exactly
 * the target stem via a single-key immutable update, preserving every other
 * entry (same reference). Mirrors `useStemConfigStore`'s `toggleStem`.
 */
function toggleStemReducer(prev: StemConfigMap, stem: StemType): StemConfigMap {
  return {
    ...prev,
    [stem]: { ...prev[stem], enabled: !prev[stem].enabled },
  };
}

/** The set of stems that render an element: enabled AND has at least one point. */
function renderedSet(config: StemConfigMap, hasPoints: HasPointsMap): Set<StemType> {
  return new Set(STEM_TYPES.filter((s) => config[s].enabled && hasPoints[s]));
}

const stemArb = fc.constantFrom<StemType>(...STEM_TYPES);

// Arbitrary enabled flags per stem.
const enabledMapArb = fc.record(
  STEM_TYPES.reduce(
    (acc, s) => {
      acc[s] = fc.boolean();
      return acc;
    },
    {} as Record<StemType, fc.Arbitrary<boolean>>,
  ),
) as fc.Arbitrary<Record<StemType, boolean>>;

// Arbitrary point-availability per stem (disabled stems may still have points).
const hasPointsMapArb = fc.record(
  STEM_TYPES.reduce(
    (acc, s) => {
      acc[s] = fc.boolean();
      return acc;
    },
    {} as Record<StemType, fc.Arbitrary<boolean>>,
  ),
) as fc.Arbitrary<HasPointsMap>;

/** Build a StemConfigMap from the real seed, applying the arbitrary enabled flags. */
function buildConfig(enabled: Record<StemType, boolean>): StemConfigMap {
  const config = createInitialStemConfig();
  for (const s of STEM_TYPES) {
    config[s] = { ...config[s], enabled: enabled[s] };
  }
  return config;
}

describe("stemConfigStore — Property 12 (toggle isolation)", () => {
  it("toggling one stem changes only that stem's rendered status; rendered set = enabled ∩ hasPoints", () => {
    fc.assert(
      fc.property(
        enabledMapArb,
        hasPointsMapArb,
        stemArb,
        (enabled, hasPoints, target) => {
          const before = buildConfig(enabled);

          // --- Rendered set equals exactly { stem | enabled[stem] && hasPoints[stem] } ---
          const renderedBefore = renderedSet(before, hasPoints);
          for (const s of STEM_TYPES) {
            expect(renderedBefore.has(s)).toBe(before[s].enabled && hasPoints[s]);
          }

          // --- Toggle ONLY the target stem via the store's single-key reducer ---
          const after = toggleStemReducer(before, target);
          const renderedAfter = renderedSet(after, hasPoints);

          // Single-key update: only the target's enabled flag flips; every other
          // entry is preserved by reference (Req 6.1, 6.2 — "unchanged").
          expect(after[target].enabled).toBe(!before[target].enabled);
          for (const s of STEM_TYPES) {
            if (s === target) continue;
            expect(after[s]).toBe(before[s]);
          }

          // --- Every OTHER stem's rendered status is identical before and after ---
          for (const s of STEM_TYPES) {
            if (s === target) continue;
            expect(renderedAfter.has(s)).toBe(renderedBefore.has(s));
          }

          // --- The target's rendered status follows enabled ∩ hasPoints ---
          expect(renderedAfter.has(target)).toBe(
            after[target].enabled && hasPoints[target],
          );

          // The only possible difference between the rendered sets is the target.
          const symmetricDiff = STEM_TYPES.filter(
            (s) => renderedBefore.has(s) !== renderedAfter.has(s),
          );
          expect(symmetricDiff.every((s) => s === target)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
