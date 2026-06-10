import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { TimelineStream } from "./TimelineStream";
import { STEM_TYPES, type StemType, type TimelinePoint } from "../models/types";

/**
 * Property-based test for Property 7 of the Harmograph design.
 *
 * // Feature: harmograph, Property 7: Subscribers receive only their stem's points
 *
 * Validates: Requirements 10.3
 *
 * Strategy: generate an arbitrary list of valid Timeline_Points spread across
 * all five stems, plus a target Stem_Type. A collector is subscribed to the
 * target stem and every point is emitted. The collected points must be exactly
 * the subset of emitted points whose `stem` field equals the target (compared
 * as a multiset), and contain no point belonging to any other stem.
 *
 * Routing is exercised through BOTH delivery paths of `subscribe`:
 *  - "live": subscribe first, then emit — the listener path delivers points.
 *  - "replay": emit first, then subscribe — the replay path delivers points.
 * Each run randomly chooses one path so both are covered across iterations.
 */

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

/** True when multisets `a` and `b` are equal (same keys, same counts). */
function multisetsEqual(
  a: Map<string, number>,
  b: Map<string, number>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const [k, count] of a) {
    if (b.get(k) !== count) {
      return false;
    }
  }
  return true;
}

/** A valid Timeline_Point for the given duration, across any of the five stems. */
function validPointArb(songDuration: number): fc.Arbitrary<TimelinePoint> {
  return fc.record({
    t: fc.double({ min: 0, max: songDuration, noNaN: true }),
    value: fc.double({ min: -1, max: 1, noNaN: true }),
    stem: fc.constantFrom(...STEM_TYPES),
  });
}

/** A scenario: a duration, a sequence of points, a target stem, and a delivery mode. */
const scenarioArb = fc
  .double({ min: 1, max: 10_000, noNaN: true })
  .chain((songDuration) =>
    fc.record({
      songDuration: fc.constant(songDuration),
      points: fc.array(validPointArb(songDuration), {
        minLength: 0,
        maxLength: 200,
      }),
      target: fc.constantFrom(...STEM_TYPES),
      mode: fc.constantFrom<"live" | "replay">("live", "replay"),
    }),
  );

describe("TimelineStream — Property 7: per-stem subscriber routing (Req 10.3)", () => {
  // Feature: harmograph, Property 7: Subscribers receive only their stem's points
  it("delivers to a stem subscriber exactly that stem's points and no others", () => {
    fc.assert(
      fc.property(scenarioArb, ({ songDuration, points, target, mode }) => {
        const stream = new TimelineStream({ songDuration });
        const collected: TimelinePoint[] = [];
        const collect = (p: TimelinePoint) => collected.push(p);

        if (mode === "live") {
          // Live path: listener registered before any emit.
          stream.subscribe(target, collect);
          for (const p of points) {
            stream.emit(p);
          }
        } else {
          // Replay path: all points emitted, then subscribe replays them.
          for (const p of points) {
            stream.emit(p);
          }
          stream.subscribe(target, collect);
        }

        // Independently compute the expected subset for the target stem.
        const expected = points.filter((p) => p.stem === target);

        // The subscriber received exactly its stem's points as a multiset.
        expect(
          multisetsEqual(toMultiset(collected), toMultiset(expected)),
        ).toBe(true);

        // And not a single delivered point belongs to another stem.
        for (const p of collected) {
          expect(p.stem).toBe(target);
        }
      }),
      { numRuns: 200 },
    );
  });
});
