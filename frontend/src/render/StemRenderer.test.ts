import { describe, it, expect } from "vitest";
import { createCoordinateSystem } from "../coordinate";
import { DEFAULT_STYLE, type TimelinePoint } from "../models";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

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

const point = (t: number, value: number): TimelinePoint => ({ t, value, stem: "melody" });

describe("BaseStemRenderer", () => {
  it("defaults to enabled with the per-stem default style (Req 6.4, 7.5)", () => {
    const r = new BaseStemRenderer("melody");
    expect(r.isEnabled()).toBe(true);
    expect(r.getStyle()).toBe(DEFAULT_STYLE.melody);
    expect(r.hasPoints()).toBe(false);
  });

  it("ingests Timeline_Points into its received-point buffer (Req 5.7)", () => {
    const r = new BaseStemRenderer("melody");
    r.ingest(point(1, 0.2));
    r.ingest(point(2, 0.4));
    expect(r.pointCount()).toBe(2);
    expect(r.hasPoints()).toBe(true);
  });

  it("draws no element when its buffer is empty (Req 5.10 — example)", () => {
    const r = new BaseStemRenderer("melody");
    const cs = createCoordinateSystem();
    const { target, getDrawCalls } = createCountingTarget();
    r.draw(target, cs, 0);
    expect(getDrawCalls()).toBe(0);
  });

  it("draws an element once it has points", () => {
    const r = new BaseStemRenderer("melody");
    r.ingest(point(1, 0.5));
    const cs = createCoordinateSystem();
    const { target, getDrawCalls } = createCountingTarget();
    r.draw(target, cs, 0);
    expect(getDrawCalls()).toBeGreaterThan(0);
  });

  it("draws no element while disabled even with points", () => {
    const r = new BaseStemRenderer("melody");
    r.ingest(point(1, 0.5));
    r.setEnabled(false);
    const cs = createCoordinateSystem();
    const { target, getDrawCalls } = createCountingTarget();
    r.draw(target, cs, 0);
    expect(getDrawCalls()).toBe(0);
  });
});
