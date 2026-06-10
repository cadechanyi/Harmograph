import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DemucsClient, type SeparatedStem, type SeparateSuccessBody } from "./DemucsClient";
import {
  DEMUCS_TO_STEM,
  type DemucsStem,
  type StemType,
} from "../models/types";

/**
 * Property-based test for Property 6 of the Harmograph design.
 *
 * // Feature: harmograph, Property 6: Each returned stem triggers exactly one analysis pass
 *
 * Validates: Requirements 4.8
 *
 * For any set of stems returned by the Demucs_Service, the Frontend dispatches
 * exactly one Analysis_Engine pass per returned stem, each tagged with the
 * routed `Stem_Type` (`other → melody`, Req 4.9). `chords` is never produced by
 * separation (Req 4.10), so it never appears among the dispatched stems.
 *
 * Strategy: generate an arbitrary non-empty subset of the four Demucs stems
 * {drums, bass, vocals, other}, build a 200 success body containing exactly
 * that subset (each with a well-formed {url, bytes} descriptor), inject a mock
 * fetchFn that returns it and a mock analyzer that records every
 * `analyzeStem(stem, source)` call, run `separate`, and assert:
 *   (a) `analyzeStem` was called exactly once per returned stem
 *       (call count === number of returned stems), and
 *   (b) the multiset of dispatched Stem_Types equals the returned Demucs stems
 *       mapped via `DEMUCS_TO_STEM` — with no `chords` and no duplicates beyond
 *       what the returned set implies (the four Demucs stems map injectively to
 *       four distinct Stem_Types, so exactly one pass per type).
 */

const DEMUCS_STEMS: readonly DemucsStem[] = ["drums", "bass", "vocals", "other"];

/** A minimal JSON Response stub matching the shape DemucsClient consumes. */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

/** A well-formed stem descriptor generator. */
const separatedStemArb: fc.Arbitrary<SeparatedStem> = fc.record({
  url: fc.webUrl(),
  bytes: fc.integer({ min: 0, max: 1_000_000_000 }),
});

/** A non-empty subset of the four Demucs stems, in arbitrary membership. */
const stemSubsetArb: fc.Arbitrary<DemucsStem[]> = fc
  .subarray([...DEMUCS_STEMS], { minLength: 1 })
  .map((s) => [...s]);

describe("DemucsClient — Property 6: one analysis pass per returned stem (Req 4.8)", () => {
  // Feature: harmograph, Property 6: Each returned stem triggers exactly one analysis pass
  it("dispatches exactly one analysis pass per returned stem, tagged with the routed Stem_Type", async () => {
    await fc.assert(
      fc.asyncProperty(
        stemSubsetArb,
        fc.dictionary(fc.constantFrom(...DEMUCS_STEMS), separatedStemArb),
        async (returnedStems, descriptorPool) => {
          // Build a success body whose `stems` contains exactly the returned
          // subset, each with a well-formed descriptor.
          const stems: Partial<Record<DemucsStem, SeparatedStem>> = {};
          for (const s of returnedStems) {
            stems[s] = descriptorPool[s] ?? { url: `/stems/${s}.wav`, bytes: 1 };
          }
          const body: SeparateSuccessBody = {
            job_id: "job",
            duration_seconds: 1,
            format: "wav",
            stems: stems as SeparateSuccessBody["stems"],
          };

          // Record every analysis pass dispatched by the client.
          const calls: Array<{ stem: StemType; source: SeparatedStem }> = [];
          const analyzer = {
            analyzeStem(stem: StemType, source: SeparatedStem): void {
              calls.push({ stem, source });
            },
          };

          const client = new DemucsClient({
            endpoint: "http://svc",
            fetchFn: (async () => jsonResponse(body)) as unknown as typeof fetch,
            analyzer,
          });

          const result = await client.separate(new File(["x"], "song.wav"));
          expect(result.ok).toBe(true);

          const expectedStemTypes = returnedStems.map((s) => DEMUCS_TO_STEM[s]);

          // (a) Exactly one pass per returned stem.
          expect(calls).toHaveLength(returnedStems.length);

          // (b) Dispatched Stem_Types equal the routed returned stems as a
          // multiset — no chords, no duplicates beyond the returned set.
          const dispatched = calls.map((c) => c.stem).sort();
          expect(dispatched).toEqual([...expectedStemTypes].sort());
          expect(dispatched).not.toContain("chords");

          // Each pass is tagged with the Stem_Type routed from its descriptor:
          // the source for a dispatched type matches the body descriptor for the
          // Demucs stem that maps to it.
          for (const { stem, source } of calls) {
            const origin = returnedStems.find((s) => DEMUCS_TO_STEM[s] === stem);
            expect(origin).toBeDefined();
            expect(source).toEqual(stems[origin as DemucsStem]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
