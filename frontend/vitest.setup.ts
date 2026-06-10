import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Stub the p5 module globally for the test suite. The real p5 constructor needs
 * a browser canvas (it calls `createCanvas` → canvas `scale`) which is not
 * available under jsdom, so any test that mounts the Graph_Renderer through the
 * default factory would otherwise throw. This instance-mode stub hands the
 * sketch a minimal drawing surface and never runs the draw loop.
 *
 * Tests that exercise renderer drawing inject their own `p5Factory` stub and do
 * not import the real module, so this global mock does not affect them.
 */
vi.mock("p5", () => ({
  default: class {
    width = 800;
    height = 600;
    constructor(sketch: (p: unknown) => void) {
      Object.assign(this, {
        createCanvas: () => {},
        background: () => {},
        resizeCanvas: () => {},
        line: () => {},
        push: () => {},
        pop: () => {},
        stroke: () => {},
        strokeWeight: () => {},
        noStroke: () => {},
        fill: () => {},
        noFill: () => {},
        ellipse: () => {},
        beginShape: () => {},
        vertex: () => {},
        endShape: () => {},
        remove: () => {},
      });
      sketch(this);
    }
  },
}));
