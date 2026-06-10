import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { StemTogglePanel } from "./StemTogglePanel";
import {
  STEM_TYPES,
  DEFAULT_STYLE,
  type StemConfigMap,
  type StemType,
} from "@/models";
import { createInitialStemConfig } from "@/stores";

/**
 * Property 13: The toggle set always covers exactly the five stems.
 *
 * For any separation and analysis state — arbitrary per-stem enabled flags,
 * arbitrary "has points" / "analysis succeeded" maps, and arbitrary subsets of
 * stems that have been "separated" — the set of Stem_Toggles presented by the
 * StemTogglePanel has exactly one entry per StemType and no others (Req 6.3).
 *
 * None of the generated state may change the toggle set: the panel always
 * presents exactly the five canonical stems, one toggle each, regardless of
 * whether a stem is enabled, separated, or has analysis data.
 *
 * Validates: Requirements 6.3
 */

// Feature: harmograph, Property 13: The toggle set always covers exactly the five stems.

const SORTED_STEMS = [...STEM_TYPES].sort();

/** Arbitrary boolean map keyed by every StemType. */
const stemBoolMapArb = fc.record<Record<StemType, boolean>>(
  STEM_TYPES.reduce(
    (acc, stem) => {
      acc[stem] = fc.boolean();
      return acc;
    },
    {} as Record<StemType, fc.Arbitrary<boolean>>,
  ),
);

/** Arbitrary subset of stems considered "separated". */
const separatedSubsetArb = fc.subarray([...STEM_TYPES]);

/**
 * Build a StemConfigMap that reflects an arbitrary per-stem enabled state while
 * keeping exactly five entries (one per StemType) with their default styles.
 */
function configFromEnabled(enabled: Record<StemType, boolean>): StemConfigMap {
  return STEM_TYPES.reduce((acc, stem) => {
    acc[stem] = { enabled: enabled[stem], style: DEFAULT_STYLE[stem] };
    return acc;
  }, {} as StemConfigMap);
}

describe("StemTogglePanel — Property 13", () => {
  afterEach(cleanup);

  it("always presents exactly one toggle per StemType across any state", () => {
    fc.assert(
      fc.property(
        stemBoolMapArb, // enabled state
        stemBoolMapArb, // hasPoints (analysis data present)
        stemBoolMapArb, // analysis-succeeded
        separatedSubsetArb, // which stems were "separated"
        (enabled, _hasPoints, _analysisSucceeded, _separated) => {
          // Sanity: the canonical config always has exactly the five stems.
          expect(Object.keys(createInitialStemConfig()).sort()).toEqual(
            SORTED_STEMS,
          );

          const config = configFromEnabled(enabled);

          render(
            createElement(StemTogglePanel, {
              config,
              onToggle: () => {},
            }),
          );

          const toggles = screen.getAllByTestId("stem-toggle");

          // Exactly five toggles, matching the StemType count.
          expect(toggles).toHaveLength(5);
          expect(toggles).toHaveLength(STEM_TYPES.length);

          // The multiset of data-stem attributes equals exactly STEM_TYPES:
          // one each, no duplicates, no extras — invariant across all state.
          const renderedStems = toggles
            .map((el) => el.getAttribute("data-stem"))
            .sort();
          expect(renderedStems).toEqual(SORTED_STEMS);

          // Every StemType appears exactly once.
          for (const stem of STEM_TYPES) {
            const matches = toggles.filter(
              (el) => el.getAttribute("data-stem") === stem,
            );
            expect(matches).toHaveLength(1);
          }

          cleanup();
        },
      ),
      { numRuns: 200 },
    );
  });
});
