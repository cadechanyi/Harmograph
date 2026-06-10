import { describe, it, expect } from "vitest";
import { createCoordinateSystem } from "./CoordinateSystem";

describe("CoordinateSystem", () => {
  describe("x-axis mapping (Req 9.1, 9.2)", () => {
    it("maps t across [0, duration] when duration >= 1", () => {
      const cs = createCoordinateSystem();
      cs.setSongDuration(10);
      expect(cs.xToCanvas(0, 800)).toBe(0);
      expect(cs.xToCanvas(5, 800)).toBe(400);
      expect(cs.xToCanvas(10, 800)).toBe(800);
    });

    it("floors the x range at [0, 1] when duration is 0 or < 1s (Req 9.2)", () => {
      const cs = createCoordinateSystem();
      cs.setSongDuration(0);
      expect(cs.xToCanvas(0, 800)).toBe(0);
      expect(cs.xToCanvas(1, 800)).toBe(800);

      cs.setSongDuration(0.5);
      expect(cs.xToCanvas(0.5, 800)).toBe(400);
      expect(cs.xToCanvas(1, 800)).toBe(800);
    });

    it("clamps out-of-range times so x stays on-canvas", () => {
      const cs = createCoordinateSystem();
      cs.setSongDuration(10);
      expect(cs.xToCanvas(-5, 800)).toBe(0);
      expect(cs.xToCanvas(20, 800)).toBe(800);
    });
  });

  describe("activeYRange (Req 9.3, 9.4)", () => {
    it("defaults to the normalized range [-1, 1]", () => {
      const cs = createCoordinateSystem();
      expect(cs.activeYRange()).toEqual([-1, 1]);
    });

    it("selects the correct range per musical unit", () => {
      const cs = createCoordinateSystem();
      cs.setYUnit("hz");
      expect(cs.activeYRange()).toEqual([20, 20000]);
      cs.setYUnit("midi");
      expect(cs.activeYRange()).toEqual([0, 127]);
      cs.setYUnit("db");
      expect(cs.activeYRange()).toEqual([-60, 0]);
      cs.setYUnit("normalized");
      expect(cs.activeYRange()).toEqual([-1, 1]);
    });
  });

  describe("yToCanvas mapping and clamping (Req 9.5)", () => {
    it("maps the range max to the top (y=0) and the min to the bottom", () => {
      const cs = createCoordinateSystem();
      expect(cs.yToCanvas(1, 600)).toBe(0); // max -> top
      expect(cs.yToCanvas(-1, 600)).toBe(600); // min -> bottom
      expect(cs.yToCanvas(0, 600)).toBe(300); // midpoint -> middle
    });

    it("clamps values into the active range before mapping (Req 9.5)", () => {
      const cs = createCoordinateSystem();
      // Above-range value clamps to max -> top; below-range clamps to min -> bottom.
      expect(cs.yToCanvas(5, 600)).toBe(cs.yToCanvas(1, 600));
      expect(cs.yToCanvas(-5, 600)).toBe(cs.yToCanvas(-1, 600));
    });

    it("maps within the selected musical unit range", () => {
      const cs = createCoordinateSystem();
      cs.setYUnit("midi");
      expect(cs.yToCanvas(127, 600)).toBe(0);
      expect(cs.yToCanvas(0, 600)).toBe(600);
      // Out-of-range MIDI clamps to bounds.
      expect(cs.yToCanvas(200, 600)).toBe(0);
      expect(cs.yToCanvas(-50, 600)).toBe(600);
    });
  });
});
