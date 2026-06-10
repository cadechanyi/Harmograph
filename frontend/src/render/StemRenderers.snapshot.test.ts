/**
 * Task 13.4 — complementary unit/example/snapshot tests for the four non-drum
 * Stem_Renderers (melody=parametric_curve, bass=sine_wave, vocals=rms_envelope,
 * chords=stacked_curves).
 *
 * This file deliberately complements (does not duplicate)
 * `MelodyBassVocalsChordsStemRenderer.test.ts`. It focuses on:
 *   - Deterministic canvas-space snapshots of each renderer's output for a
 *     known set of Timeline_Points + a fixed Coordinate_System/canvas size
 *     (Req 5.3-5.6).
 *   - Timeline_Point ingestion progressively updating each renderer's
 *     state/output as more points arrive (Req 5.7).
 *   - Style identity: each renderer defaults to its design Graph_Style (Req 7.6).
 */
import { describe, it, expect } from "vitest";
import { createCoordinateSystem } from "../coordinate";
import { DEFAULT_STYLE, type StemType, type TimelinePoint } from "../models";
import type { P5DrawTarget } from "./StemRenderer";
import { MelodyStemRenderer, createMelodyStemRenderer } from "./MelodyStemRenderer";
import { BassStemRenderer, createBassStemRenderer } from "./BassStemRenderer";
import { VocalsStemRenderer, createVocalsStemRenderer } from "./VocalsStemRenderer";
import { ChordsStemRenderer, createChordsStemRenderer } from "./ChordsStemRenderer";

const pt = (t: number, value: number, stem: StemType): TimelinePoint => ({
  t,
  value,
  stem,
});

/** A draw target that records the exact sequence of `vertex` calls. */
function createVertexRecorder() {
  const vertices: Array<{ x: number; y: number }> = [];
  const noop = () => {};
  const target: P5DrawTarget = {
    push: noop,
    pop: noop,
    stroke: noop as P5DrawTarget["stroke"],
    strokeWeight: noop as P5DrawTarget["strokeWeight"],
    noStroke: noop,
    fill: noop as P5DrawTarget["fill"],
    noFill: noop,
    ellipse: noop as P5DrawTarget["ellipse"],
    line: noop as P5DrawTarget["line"],
    beginShape: noop,
    vertex: ((x: number, y: number) => {
      vertices.push({ x, y });
    }) as P5DrawTarget["vertex"],
    endShape: noop as P5DrawTarget["endShape"],
  };
  return { target, vertices };
}

// Fixed canvas size used across the deterministic snapshots below.
const WIDTH = 800;
const HEIGHT = 600;

describe("Style identity — each renderer defaults to its design Graph_Style (Req 7.6)", () => {
  it("melody defaults to parametric_curve", () => {
    expect(createMelodyStemRenderer().getStyle()).toBe("parametric_curve");
    expect(createMelodyStemRenderer().getStyle()).toBe(DEFAULT_STYLE.melody);
  });

  it("bass defaults to sine_wave", () => {
    expect(createBassStemRenderer().getStyle()).toBe("sine_wave");
    expect(createBassStemRenderer().getStyle()).toBe(DEFAULT_STYLE.bass);
  });

  it("vocals defaults to rms_envelope", () => {
    expect(createVocalsStemRenderer().getStyle()).toBe("rms_envelope");
    expect(createVocalsStemRenderer().getStyle()).toBe(DEFAULT_STYLE.vocals);
  });

  it("chords defaults to stacked_curves", () => {
    expect(createChordsStemRenderer().getStyle()).toBe("stacked_curves");
    expect(createChordsStemRenderer().getStyle()).toBe(DEFAULT_STYLE.chords);
  });
});

describe("Melody parametric_curve — deterministic snapshot (Req 5.3)", () => {
  it("projects a known point set to exact canvas vertices", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const r = new MelodyStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, -1, "melody"));
    r.ingest(pt(5, 0, "melody"));
    r.ingest(pt(10, 1, "melody"));

    // Snapshot via the pure getter: t->x across [0,10], value->y (top-left origin).
    expect(r.getCurvePoints(cs)).toEqual([
      { x: 0, y: 600 },
      { x: 400, y: 300 },
      { x: 800, y: 0 },
    ]);
  });

  it("draws the same vertex sequence to the canvas as the getter reports", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const r = new MelodyStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, -1, "melody"));
    r.ingest(pt(5, 0, "melody"));
    r.ingest(pt(10, 1, "melody"));
    const rec = createVertexRecorder();
    r.draw(rec.target, cs, 0);
    expect(rec.vertices).toEqual(r.getCurvePoints(cs));
  });
});

describe("Bass sine_wave — deterministic snapshot (Req 5.4)", () => {
  it("amplitude reflects the latest point's low-band energy at a fixed canvas size", () => {
    const cs = createCoordinateSystem();
    const r = createBassStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, 0.5, "bass"));
    const rec = createVertexRecorder();
    r.draw(rec.target, cs, 0);
    // amplitude = energy(0.5) * fraction(0.4) * height/2(300) = 60 px.
    expect(r.getAmplitude()).toBeCloseTo(60);
  });

  it("the first frame (phase 0) samples a deterministic single-cycle wave", () => {
    const cs = createCoordinateSystem();
    // cycles=1 + sampleStep=200 yields 5 vertices at the quarter-cycle marks.
    const r = new BassStemRenderer("bass", undefined, {
      cycles: 1,
      sampleStep: 200,
    });
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, 0.5, "bass")); // amplitude 60, centre y = 300
    const rec = createVertexRecorder();
    r.draw(rec.target, cs, 0);

    expect(rec.vertices).toHaveLength(5);
    const expected = [
      { x: 0, y: 300 }, // sin(0)=0 -> centre
      { x: 200, y: 240 }, // sin(pi/2)=1 -> centre - amp (drawn higher)
      { x: 400, y: 300 }, // sin(pi)=0 -> centre
      { x: 600, y: 360 }, // sin(3pi/2)=-1 -> centre + amp (drawn lower)
      { x: 800, y: 300 }, // sin(2pi)=0 -> centre
    ];
    rec.vertices.forEach((v, i) => {
      expect(v.x).toBeCloseTo(expected[i].x);
      expect(v.y).toBeCloseTo(expected[i].y);
    });
  });
});

describe("Vocals rms_envelope — deterministic snapshot (Req 5.5)", () => {
  it("projects a known point set to exact rising envelope vertices", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    const r = new VocalsStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, 0, "vocals"));
    r.ingest(pt(2, 0.5, "vocals"));
    r.ingest(pt(4, 1, "vocals"));

    // Rising presence -> decreasing canvas y (top-left origin).
    expect(r.getEnvelopePoints(cs)).toEqual([
      { x: 0, y: 300 },
      { x: 400, y: 150 },
      { x: 800, y: 0 },
    ]);
  });
});

describe("Chords stacked_curves — deterministic snapshot (Req 5.6)", () => {
  it("produces three symmetric, vertically-offset layers for a known point set", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    const r = new ChordsStemRenderer(); // default 3 layers, spread 0.25
    r.setCanvasSize(WIDTH, HEIGHT);
    r.ingest(pt(0, 0, "chords"));
    r.ingest(pt(4, 0.5, "chords"));

    // band = 0.25 * 600 = 150 -> offsets [-75, 0, +75]; base curve y = [300, 150].
    expect(r.getStackedLayers(cs)).toEqual([
      [
        { x: 0, y: 225 },
        { x: 800, y: 75 },
      ],
      [
        { x: 0, y: 300 },
        { x: 800, y: 150 },
      ],
      [
        { x: 0, y: 375 },
        { x: 800, y: 225 },
      ],
    ]);
  });
});

describe("Timeline_Point ingestion progressively updates renderer state (Req 5.7)", () => {
  it("melody curve grows one vertex per ingested point", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const r = new MelodyStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    expect(r.getCurvePoints(cs)).toHaveLength(0);
    r.ingest(pt(0, 0.1, "melody"));
    expect(r.getCurvePoints(cs)).toHaveLength(1);
    r.ingest(pt(5, 0.2, "melody"));
    r.ingest(pt(10, 0.3, "melody"));
    expect(r.getCurvePoints(cs)).toHaveLength(3);
  });

  it("vocals envelope grows one vertex per ingested point", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const r = new VocalsStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    expect(r.getEnvelopePoints(cs)).toHaveLength(0);
    r.ingest(pt(0, 0.1, "vocals"));
    r.ingest(pt(5, 0.5, "vocals"));
    expect(r.getEnvelopePoints(cs)).toHaveLength(2);
  });

  it("chords grows every layer by one vertex per ingested point", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const r = new ChordsStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    for (const layer of r.getStackedLayers(cs)) expect(layer).toHaveLength(0);
    r.ingest(pt(0, 0.1, "chords"));
    r.ingest(pt(5, 0.2, "chords"));
    r.ingest(pt(10, 0.3, "chords"));
    const layers = r.getStackedLayers(cs);
    expect(layers).toHaveLength(r.getLayerCount());
    for (const layer of layers) expect(layer).toHaveLength(3);
  });

  it("bass amplitude updates to reflect the latest ingested point", () => {
    const cs = createCoordinateSystem();
    const r = createBassStemRenderer();
    r.setCanvasSize(WIDTH, HEIGHT);
    const rec = createVertexRecorder();

    r.ingest(pt(0, 0.2, "bass"));
    r.draw(rec.target, cs, 0);
    const quietAmp = r.getAmplitude();

    // A louder latest point raises the amplitude on the next frame.
    r.ingest(pt(1, 0.9, "bass"));
    r.draw(rec.target, cs, 0);
    const loudAmp = r.getAmplitude();

    expect(loudAmp).toBeGreaterThan(quietAmp);
    // amplitude tracks the latest point (0.9), not an aggregate of all points.
    expect(loudAmp).toBeCloseTo(0.9 * 0.4 * (HEIGHT / 2));
  });
});
