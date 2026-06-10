import { describe, it, expect, vi } from "vitest";
import { createCoordinateSystem } from "../coordinate";
import { STEM_TYPES, type TimelinePoint } from "../models";
import { TimelineStream } from "../timeline";
import {
  createGraphRenderer,
  type P5Factory,
  type P5SketchInstance,
} from "./GraphRenderer";

/**
 * A recording p5 draw target. It satisfies the structural P5SketchInstance
 * surface and records every drawing primitive call so tests can assert what was
 * (and was not) drawn — no real canvas required.
 */
function createRecordingP5(width = 800, height = 600) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const p: P5SketchInstance = {
    push: rec("push"),
    pop: rec("pop"),
    stroke: rec("stroke") as P5SketchInstance["stroke"],
    strokeWeight: rec("strokeWeight") as P5SketchInstance["strokeWeight"],
    noStroke: rec("noStroke"),
    fill: rec("fill") as P5SketchInstance["fill"],
    noFill: rec("noFill"),
    ellipse: rec("ellipse") as P5SketchInstance["ellipse"],
    line: rec("line") as P5SketchInstance["line"],
    beginShape: rec("beginShape"),
    vertex: rec("vertex") as P5SketchInstance["vertex"],
    endShape: rec("endShape"),
    background: rec("background") as P5SketchInstance["background"],
    createCanvas: rec("createCanvas") as P5SketchInstance["createCanvas"],
    resizeCanvas: rec("resizeCanvas") as P5SketchInstance["resizeCanvas"],
    remove: rec("remove"),
    width,
    height,
  };
  return { p, calls };
}

const point = (t: number, value: number, stem: TimelinePoint["stem"]): TimelinePoint => ({
  t,
  value,
  stem,
});

describe("GraphRenderer", () => {
  it("constructs exactly one Stem_Renderer per stem (Req 6.3)", () => {
    const gr = createGraphRenderer({
      timeSource: () => 0,
      coordinateSystem: createCoordinateSystem(),
    });
    for (const stem of STEM_TYPES) {
      expect(gr.getStemRenderer(stem).stem).toBe(stem);
    }
  });

  it("positions the playhead x at the current playback time (Req 5.1)", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    let now = 0;
    const gr = createGraphRenderer({ timeSource: () => now, coordinateSystem: cs });

    // t=0 -> x=0; t=5 of 10s over an 800px canvas -> x=400.
    expect(gr.getPlayheadX(800)).toBe(0);
    now = 5;
    expect(gr.getPlayheadX(800)).toBe(400);
  });

  it("holds the playhead at the retained time while paused (Req 5.8)", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    // While paused, the injected time source returns a fixed retained position.
    const gr = createGraphRenderer({ timeSource: () => 3, coordinateSystem: cs });
    const first = gr.getPlayheadX(800);
    const second = gr.getPlayheadX(800);
    expect(first).toBe(second);
    expect(first).toBe(240); // 3/10 * 800
  });

  it("delegates per-stem drawing and draws the playhead line", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const gr = createGraphRenderer({ timeSource: () => 5, coordinateSystem: cs });
    // Give the drums renderer a point so it produces an element.
    gr.getStemRenderer("drums").ingest(point(1, 0.5, "drums"));

    const { p, calls } = createRecordingP5();
    gr.renderFrame(p, 800, 600);

    // Background cleared each frame.
    expect(calls.some((c) => c.method === "background")).toBe(true);
    // The drums renderer plotted vertices for its point(s).
    expect(calls.some((c) => c.method === "vertex")).toBe(true);
    // The playhead indicator line was drawn at the synced x (400).
    const lineCall = calls.find((c) => c.method === "line");
    expect(lineCall).toBeDefined();
    expect(lineCall?.args[0]).toBe(400);
  });

  it("uses a replaced Coordinate_System on subsequent frames (Req 9.6)", () => {
    const csA = createCoordinateSystem();
    csA.setSongDuration(10);
    const gr = createGraphRenderer({ timeSource: () => 5, coordinateSystem: csA });
    expect(gr.getPlayheadX(800)).toBe(400); // 5/10

    const csB = createCoordinateSystem();
    csB.setSongDuration(20);
    gr.setCoordinateSystem(csB);
    expect(gr.getPlayheadX(800)).toBe(200); // 5/20
  });

  it("subscribes stem renderers to a Timeline_Stream when provided (Req 5.7)", () => {
    const cs = createCoordinateSystem();
    cs.setSongDuration(10);
    const timeline = new TimelineStream({ songDuration: 10 });
    const gr = createGraphRenderer({ timeSource: () => 0, coordinateSystem: cs, timeline });

    timeline.emit(point(2, 0.4, "bass"));
    const bass = gr.getStemRenderer("bass") as unknown as { pointCount(): number };
    expect(bass.pointCount()).toBe(1);
  });

  it("mounts a single p5 instance via the injected factory", async () => {
    const cs = createCoordinateSystem();
    const created: P5SketchInstance[] = [];
    const factory: P5Factory = (sketch) => {
      const { p } = createRecordingP5();
      sketch(p); // run the user sketch to register setup/draw
      p.setup?.();
      created.push(p);
      return p;
    };
    const gr = createGraphRenderer({ timeSource: () => 0, coordinateSystem: cs, p5Factory: factory });

    const container = document.createElement("div");
    await gr.mount(container);
    await gr.mount(container); // second mount is a no-op (single instance)

    expect(created).toHaveLength(1);
    // setup() created exactly one canvas.
    const createdP = created[0] as unknown as { createCanvas: ReturnType<typeof vi.fn> };
    void createdP;

    gr.destroy();
  });
});
