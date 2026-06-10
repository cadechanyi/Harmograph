import { describe, it, expect } from "vitest";
import { createCoordinateSystem } from "../coordinate";
import type { TimelinePoint } from "../models";
import type { P5DrawTarget } from "./StemRenderer";
import {
  DrumsStemRenderer,
  createDrumsStemRenderer,
  createBallPhysics,
  advanceBalls,
  resetOnKick,
  withBounds,
  isKickOnset,
} from "./DrumsStemRenderer";

/** A draw target that records ellipse calls (and counts all primitives). */
function createRecordingTarget() {
  let drawCalls = 0;
  const ellipses: Array<{ x: number; y: number; w: number }> = [];
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
    ellipse: ((x: number, y: number, w: number) => {
      drawCalls += 1;
      ellipses.push({ x, y, w });
    }) as P5DrawTarget["ellipse"],
    line: bump as P5DrawTarget["line"],
    beginShape: bump,
    vertex: bump as P5DrawTarget["vertex"],
    endShape: bump,
  };
  return { target, ellipses, getDrawCalls: () => drawCalls };
}

const kick = (t: number): TimelinePoint => ({ t, value: 1, stem: "drums" });
const quiet = (t: number): TimelinePoint => ({ t, value: 0.1, stem: "drums" });

describe("drum ball physics (pure core)", () => {
  it("starts every ball at the top with zero velocity", () => {
    const s = createBallPhysics(3, 0, 600);
    expect(s.balls).toHaveLength(3);
    for (const ball of s.balls) {
      expect(ball.y).toBe(0);
      expect(ball.v).toBe(0);
    }
  });

  it("advances balls downward under constant acceleration", () => {
    let s = createBallPhysics(1, 0, 600, 0.6);
    const first = advanceBalls(s, 1).balls[0];
    s = advanceBalls(s, 1);
    const afterSecond = advanceBalls(s, 1).balls[0];
    // Position increases (moves down) and never goes up.
    expect(first.y).toBeGreaterThan(0);
    expect(afterSecond.y).toBeGreaterThan(first.y);
    expect(afterSecond.v).toBeGreaterThan(first.v);
  });

  it("rests a ball on the floor without overshooting", () => {
    let s = createBallPhysics(1, 0, 50, 5);
    for (let i = 0; i < 20; i += 1) {
      s = advanceBalls(s, 1);
    }
    expect(s.balls[0].y).toBe(50);
    expect(s.balls[0].v).toBe(0);
  });

  it("resets every ball to the top on kick onset", () => {
    let s = createBallPhysics(2, 10, 600, 0.6);
    s = advanceBalls(advanceBalls(s, 1), 1);
    expect(s.balls.every((b) => b.y > 10)).toBe(true);
    s = resetOnKick(s);
    for (const ball of s.balls) {
      expect(ball.y).toBe(10);
      expect(ball.v).toBe(0);
    }
  });

  it("clamps balls into the range when bounds change", () => {
    let s = createBallPhysics(1, 0, 600, 0.6);
    s = { ...s, balls: [{ y: 500, v: 3 }] };
    s = withBounds(s, 0, 100);
    expect(s.balls[0].y).toBe(100);
  });

  it("detects kick onsets by magnitude threshold", () => {
    expect(isKickOnset(0.9, 0.5)).toBe(true);
    expect(isKickOnset(-0.9, 0.5)).toBe(true);
    expect(isKickOnset(0.2, 0.5)).toBe(false);
    expect(isKickOnset(Number.NaN, 0.5)).toBe(false);
  });
});

describe("DrumsStemRenderer", () => {
  it("draws nothing while its received-point buffer is empty (Req 5.10)", () => {
    const r = createDrumsStemRenderer();
    const cs = createCoordinateSystem();
    const { target, getDrawCalls } = createRecordingTarget();
    r.draw(target, cs, 0);
    expect(getDrawCalls()).toBe(0);
  });

  it("draws one ellipse per ball once it has points", () => {
    const r = new DrumsStemRenderer("drums", undefined, { ballCount: 3 });
    r.ingest(quiet(0));
    const cs = createCoordinateSystem();
    const { target, ellipses } = createRecordingTarget();
    r.draw(target, cs, 0);
    expect(ellipses).toHaveLength(3);
  });

  it("resets balls to the top of the active y-range on a kick onset (Req 5.9)", () => {
    const r = new DrumsStemRenderer("drums", undefined, { ballCount: 1 });
    const cs = createCoordinateSystem();
    const { target } = createRecordingTarget();
    // Quiet points: balls fall over several frames.
    r.ingest(quiet(0));
    for (let i = 0; i < 5; i += 1) r.draw(target, cs, 0);
    const fallen = r.getPhysics()!.balls[0].y;
    expect(fallen).toBeGreaterThan(0);
    // A kick onset arrives: the next frame resets the ball to the top (y=0).
    r.ingest(kick(1));
    r.draw(target, cs, 0);
    // After reset the ball is at top, then advanced one small step.
    const topY = cs.yToCanvas(cs.activeYRange()[1], 600);
    expect(r.getPhysics()!.balls[0].y).toBeLessThan(fallen);
    expect(r.getPhysics()!.balls[0].y).toBeGreaterThanOrEqual(topY);
  });

  it("draws nothing while disabled even with points", () => {
    const r = createDrumsStemRenderer();
    r.ingest(quiet(0));
    r.setEnabled(false);
    const cs = createCoordinateSystem();
    const { target, ellipses } = createRecordingTarget();
    r.draw(target, cs, 0);
    expect(ellipses).toHaveLength(0);
  });
});
