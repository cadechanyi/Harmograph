import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createCoordinateSystem } from "../coordinate";
import { STEM_TYPES, type StemType, type TimelinePoint } from "../models";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/**
 * Property 11: A stem with no points renders no element.
 *
 * For any Stem_Renderer whose received-point buffer is empty — whether never
 * populated, or enabled before any point arrived — drawing produces no
 * graphical element for that stem. The gating keys off the empty buffer alone:
 * regardless of the stem, enabled state, playhead position, or canvas
 * dimensions, `draw` must issue ZERO drawing primitives.
 *
 * To show the gating is specifically about the empty buffer (and not about
 * draw being a no-op in general), a complementary check confirms that once at
 * least one point has been ingested AND the stem is enabled, `draw` issues at
 * least one drawing primitive.
 *
 * Validates: Requirements 5.10, 6.5
 */

// Feature: harmograph, Property 11: A stem with no points renders no element.

/** A draw target that counts how many drawing primitives were issued. */
function createCountingTarget() {
  let drawCalls = 0;
  const bump = () => {
    drawCalls += 1;
  };
  const noop = () => {};
  const target: P5DrawTarget = {
    push: noop,
    pop: noop,
    stroke: bump as P5DrawTarget["stroke"],
    strokeWeight: bump as P5DrawTarget["strokeWeight"],
    noStroke: bump,
    fill: bump as P5DrawTarget["fill"],
    noFill: bump,
    ellipse: bump as P5DrawTarget["ellipse"],
    line: bump as P5DrawTarget["line"],
    beginShape: bump,
    vertex: bump as P5DrawTarget["vertex"],
    endShape: bump,
  };
  return { target, getDrawCalls: () => drawCalls };
}

const stemArb = fc.constantFrom<StemType>(...STEM_TYPES);
const enabledArb = fc.boolean();

// Arbitrary finite playhead positions and canvas dimensions.
const finiteArb = fc.double({
  min: -1e5,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});
const dimensionArb = fc.double({
  min: 1,
  max: 1e4,
  noNaN: true,
  noDefaultInfinity: true,
});

// Arbitrary normalized point payload (value in [-1, 1], t >= 0); the `stem`
// field is attached at use sites to match the renderer's stem.
const pointPayloadArb = fc.record({
  t: fc.double({ min: 0, max: 1e4, noNaN: true, noDefaultInfinity: true }),
  value: fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
});

describe("BaseStemRenderer — Property 11 (empty-buffer render gating)", () => {
  it("issues no draw call for any stem with an empty received-point buffer", () => {
    fc.assert(
      fc.property(
        stemArb,
        enabledArb,
        finiteArb,
        dimensionArb,
        dimensionArb,
        (stem, enabled, playheadX, canvasWidth, canvasHeight) => {
          // A renderer that has NEVER received a point (empty buffer).
          const r = new BaseStemRenderer(stem);
          r.setEnabled(enabled);
          r.setCanvasSize(canvasWidth, canvasHeight);

          const cs = createCoordinateSystem();
          const { target, getDrawCalls } = createCountingTarget();

          r.draw(target, cs, playheadX);

          // Empty buffer => no graphical element, regardless of enabled state,
          // stem, playhead, or canvas size (Req 5.10, 6.5).
          expect(r.hasPoints()).toBe(false);
          expect(getDrawCalls()).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("issues at least one draw call once enabled with a non-empty buffer", () => {
    fc.assert(
      fc.property(
        stemArb,
        pointPayloadArb,
        finiteArb,
        dimensionArb,
        dimensionArb,
        (stem, payload, playheadX, canvasWidth, canvasHeight) => {
          const r = new BaseStemRenderer(stem);
          r.setEnabled(true);
          r.setCanvasSize(canvasWidth, canvasHeight);
          const point: TimelinePoint = { ...payload, stem };
          r.ingest(point);

          const cs = createCoordinateSystem();
          const { target, getDrawCalls } = createCountingTarget();

          r.draw(target, cs, playheadX);

          expect(r.hasPoints()).toBe(true);
          expect(getDrawCalls()).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
