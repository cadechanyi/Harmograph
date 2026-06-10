import { describe, it, expect } from "vitest";
import { createCoordinateSystem } from "../coordinate";
import type { StemType, TimelinePoint } from "../models";
import type { P5DrawTarget } from "./StemRenderer";
import {
  MelodyStemRenderer,
  createMelodyStemRenderer,
  buildCurvePoints,
} from "./MelodyStemRenderer";
import {
  BassStemRenderer,
  createBassStemRenderer,
  lowBandEnergy,
  amplitudeForEnergy,
  sineWaveSample,
} from "./BassStemRenderer";
import {
  VocalsStemRenderer,
  createVocalsStemRenderer,
  buildEnvelopePoints,
  envelopeY,
} from "./VocalsStemRenderer";
import {
  ChordsStemRenderer,
  createChordsStemRenderer,
  stackedLayerOffsets,
  buildStackedLayers,
} from "./ChordsStemRenderer";

/** A draw target that records every primitive call for assertions. */
function createRecordingTarget() {
  const calls: Record<string, number> = {};
  const vertices: Array<{ x: number; y: number }> = [];
  let beginShapes = 0;
  const bump = (name: string) => () => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const target: P5DrawTarget = {
    push: bump("push"),
    pop: bump("pop"),
    stroke: bump("stroke") as P5DrawTarget["stroke"],
    strokeWeight: bump("strokeWeight") as P5DrawTarget["strokeWeight"],
    noStroke: bump("noStroke"),
    fill: bump("fill") as P5DrawTarget["fill"],
    noFill: bump("noFill"),
    ellipse: bump("ellipse") as P5DrawTarget["ellipse"],
    line: bump("line") as P5DrawTarget["line"],
    beginShape: () => {
      beginShapes += 1;
    },
    vertex: ((x: number, y: number) => {
      vertices.push({ x, y });
    }) as P5DrawTarget["vertex"],
    endShape: bump("endShape"),
  };
  return {
    target,
    calls,
    vertices,
    getBeginShapes: () => beginShapes,
    drawCount: () => Object.values(calls).reduce((a, b) => a + b, 0) + beginShapes,
  };
}

const pt = (t: number, value: number, stem: StemType): TimelinePoint => ({
  t,
  value,
  stem,
});

describe("MelodyStemRenderer (parametric_curve, Req 5.3)", () => {
  it("buildCurvePoints maps each point through the coordinate system", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const points = [pt(0, -1, "melody"), pt(5, 0, "melody"), pt(10, 1, "melody")];
    const curve = buildCurvePoints(points, cs, 800, 600);
    expect(curve).toHaveLength(3);
    // t=0 => x=0, t=10 (xMax) => x=width.
    expect(curve[0].x).toBeCloseTo(0);
    expect(curve[2].x).toBeCloseTo(800);
    // Larger value renders higher (smaller canvas y, top-left origin).
    expect(curve[2].y).toBeLessThan(curve[1].y);
    expect(curve[1].y).toBeLessThan(curve[0].y);
  });

  it("draws nothing while its received-point buffer is empty (Req 5.10)", () => {
    const r = createMelodyStemRenderer();
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });

  it("draws one vertex per ingested point as a connected curve", () => {
    const r = new MelodyStemRenderer();
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    r.ingest(pt(0, 0.2, "melody"));
    r.ingest(pt(5, 0.6, "melody"));
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.getBeginShapes()).toBe(1);
    expect(rec.vertices).toHaveLength(2);
    expect(rec.calls.endShape).toBe(1);
  });

  it("does not draw while disabled even with points", () => {
    const r = createMelodyStemRenderer();
    r.ingest(pt(0, 0.5, "melody"));
    r.setEnabled(false);
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });
});

describe("BassStemRenderer (sine_wave, Req 5.4)", () => {
  it("lowBandEnergy reads the latest point magnitude in [0, 1]", () => {
    expect(lowBandEnergy([])).toBe(0);
    expect(lowBandEnergy([pt(0, -0.7, "bass")])).toBeCloseTo(0.7);
    expect(lowBandEnergy([pt(0, 0.2, "bass"), pt(1, 0.9, "bass")])).toBeCloseTo(
      0.9,
    );
  });

  it("amplitudeForEnergy increases with energy and is zero at silence", () => {
    const a0 = amplitudeForEnergy(0, 600);
    const aMid = amplitudeForEnergy(0.5, 600);
    const aFull = amplitudeForEnergy(1, 600);
    expect(a0).toBe(0);
    expect(aMid).toBeGreaterThan(a0);
    expect(aFull).toBeGreaterThan(aMid);
  });

  it("sineWaveSample oscillates about the centre by the amplitude", () => {
    const centerY = 300;
    const amp = 50;
    // At phase 0, x=0 => sin(0)=0 => centre.
    expect(sineWaveSample(0, 800, amp, centerY, 4, 0)).toBeCloseTo(centerY);
    // Quarter cycle into the first period sits one amplitude above centre.
    const quarter = 800 / 4 / 4; // width / cycles / 4
    expect(sineWaveSample(quarter, 800, amp, centerY, 4, 0)).toBeCloseTo(
      centerY - amp,
    );
  });

  it("draws nothing while its received-point buffer is empty (Req 5.10)", () => {
    const r = createBassStemRenderer();
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });

  it("renders a taller wave for higher low-band energy", () => {
    const cs = createCoordinateSystem();
    const quiet = createBassStemRenderer();
    quiet.ingest(pt(0, 0.1, "bass"));
    const loud = createBassStemRenderer();
    loud.ingest(pt(0, 0.9, "bass"));
    const rec = createRecordingTarget();
    quiet.draw(rec.target, cs, 0);
    loud.draw(rec.target, cs, 0);
    expect(loud.getAmplitude()).toBeGreaterThan(quiet.getAmplitude());
  });

  it("advances its animation phase each frame (Req 5.7)", () => {
    const r = createBassStemRenderer();
    r.ingest(pt(0, 0.5, "bass"));
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    const before = r.getPhase();
    r.draw(rec.target, cs, 0);
    expect(r.getPhase()).toBeGreaterThan(before);
  });
});

describe("VocalsStemRenderer (rms_envelope, Req 5.5)", () => {
  it("envelopeY rises (smaller canvas y) as vocal presence increases", () => {
    const cs = createCoordinateSystem();
    const low = envelopeY(0.1, cs, 600);
    const high = envelopeY(0.9, cs, 600);
    expect(high).toBeLessThan(low);
  });

  it("buildEnvelopePoints projects points through the coordinate system", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    const points = [pt(0, 0.1, "vocals"), pt(4, 0.8, "vocals")];
    const env = buildEnvelopePoints(points, cs, 800, 600);
    expect(env).toHaveLength(2);
    expect(env[1].x).toBeCloseTo(800);
    expect(env[1].y).toBeLessThan(env[0].y);
  });

  it("draws nothing while its received-point buffer is empty (Req 5.10)", () => {
    const r = createVocalsStemRenderer();
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });

  it("draws a translucent filled envelope plus an outline", () => {
    const r = new VocalsStemRenderer();
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    r.ingest(pt(0, 0.2, "vocals"));
    r.ingest(pt(4, 0.7, "vocals"));
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    // Fill body + outline => two shapes.
    expect(rec.getBeginShapes()).toBe(2);
    expect(rec.calls.fill).toBeGreaterThanOrEqual(1);
    expect(rec.calls.stroke).toBeGreaterThanOrEqual(1);
  });
});

describe("ChordsStemRenderer (stacked_curves, Req 5.6)", () => {
  it("stackedLayerOffsets are symmetric about zero", () => {
    const offsets = stackedLayerOffsets(3, 600);
    expect(offsets).toHaveLength(3);
    expect(offsets[1]).toBeCloseTo(0);
    expect(offsets[0]).toBeCloseTo(-offsets[2]);
    expect(stackedLayerOffsets(1, 600)).toEqual([0]);
  });

  it("buildStackedLayers produces one curve per layer, vertically offset", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    const points = [pt(0, 0, "chords"), pt(4, 0.5, "chords")];
    const layers = buildStackedLayers(points, cs, 800, 600, 3);
    expect(layers).toHaveLength(3);
    for (const layer of layers) expect(layer).toHaveLength(2);
    // Same x across layers, different y (the vertical offset).
    expect(layers[0][0].x).toBeCloseTo(layers[2][0].x);
    expect(layers[0][0].y).not.toBeCloseTo(layers[2][0].y);
  });

  it("draws nothing while its received-point buffer is empty (Req 5.10)", () => {
    const r = createChordsStemRenderer();
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });

  it("draws one translucent shape per stacked layer", () => {
    const r = new ChordsStemRenderer("chords", undefined, { layerCount: 4 });
    const cs = createCoordinateSystem();
    cs.setSongDuration(4);
    r.ingest(pt(0, 0.1, "chords"));
    r.ingest(pt(4, 0.4, "chords"));
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.getBeginShapes()).toBe(4);
    expect(rec.calls.endShape).toBe(4);
    expect(rec.calls.fill).toBe(4);
  });

  it("does not draw while disabled even with points", () => {
    const r = createChordsStemRenderer();
    r.ingest(pt(0, 0.5, "chords"));
    r.setEnabled(false);
    const cs = createCoordinateSystem();
    const rec = createRecordingTarget();
    r.draw(rec.target, cs, 0);
    expect(rec.drawCount()).toBe(0);
  });
});
