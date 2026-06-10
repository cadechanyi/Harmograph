/**
 * Graph_Renderer — owns a single p5 instance and the per-frame draw loop.
 *
 * Mirrors the design's "Graph_Renderer and Stem_Renderers" interface. A single
 * p5 instance (instance mode) drives the animation loop; each frame the
 * renderer:
 *   1. positions the graph's x at the playback time so the rendered playhead x
 *      corresponds to the current playback time while playing (within 100 ms)
 *      and holds at the retained time while paused (Req 5.1, 5.8), and
 *   2. delegates per-stem drawing to the five Stem_Renderers using the active
 *      Coordinate_System (Req 9.6).
 *
 * Playhead synchronisation reads the playback time from an injected time source
 * (e.g. `() => audioEngine.getCurrentTime()`). Because the draw loop polls that
 * source every frame (>= 30 Hz) and `getCurrentTime()` returns the live time
 * while playing and the retained position while paused, the single source
 * satisfies both the playing-tracking tolerance (Req 5.1) and the paused-hold
 * behaviour (Req 5.8) without any extra state.
 *
 * The pure draw logic ({@link GraphRendererImpl.renderFrame}) is kept separate
 * from p5 mounting so it can be exercised under jsdom with a mock draw target —
 * no real canvas is required. Mounting (which constructs a `p5` instance and a
 * canvas) is isolated in {@link GraphRendererImpl.mount} and lazily imports p5,
 * so importing this module never touches the DOM.
 */

import type { CoordinateSystem } from "../coordinate";
import { STEM_TYPES, type StemType } from "../models";
import type { TimelineStream } from "../timeline";
import {
  BaseStemRenderer,
  type P5DrawTarget,
  type StemRenderer,
} from "./StemRenderer";

/** The Graph_Renderer surface (design interface). */
export interface GraphRenderer {
  /** The Stem_Renderer for a given stem (always one of the five). */
  getStemRenderer(stem: StemType): StemRenderer;
  /** Set or replace the Coordinate_System; subsequent frames use it (Req 9.6). */
  setCoordinateSystem(cs: CoordinateSystem): void;
}

/**
 * A p5 sketch instance as used here: the {@link P5DrawTarget} drawing surface
 * plus the lifecycle/setup hooks and canvas sizing the renderer drives.
 */
export interface P5SketchInstance extends P5DrawTarget {
  setup?: () => void;
  draw?: () => void;
  createCanvas(width: number, height: number): unknown;
  background(...args: number[]): void;
  resizeCanvas(width: number, height: number): void;
  width: number;
  height: number;
  remove(): void;
}

/**
 * Factory that constructs a p5 instance in instance mode. Injectable so the
 * renderer can be mounted with a stub in tests and so the real p5 import stays
 * lazy. Matches the `new p5(sketch, node)` constructor shape.
 */
export type P5Factory = (
  sketch: (p: P5SketchInstance) => void,
  node?: HTMLElement,
) => P5SketchInstance;

export interface GraphRendererOptions {
  /** Reads the current playback time in seconds (e.g. audioEngine.getCurrentTime). */
  timeSource: () => number;
  /** The active Coordinate_System used to map data and the playhead to canvas. */
  coordinateSystem: CoordinateSystem;
  /**
   * Optional Timeline_Stream. When provided, each Stem_Renderer is subscribed to
   * its stem so points flow into the renderers automatically (Req 5.7).
   */
  timeline?: TimelineStream;
  /**
   * Optional p5 factory. When omitted, {@link GraphRendererImpl.mount} lazily
   * imports the real `p5` package. Provide a stub in tests to avoid a real
   * canvas.
   */
  p5Factory?: P5Factory;
}

/** Lazily import the real p5 constructor and wrap it as a {@link P5Factory}. */
async function defaultP5Factory(): Promise<P5Factory> {
  const mod = (await import("p5")) as unknown as {
    default: new (
      sketch: (p: P5SketchInstance) => void,
      node?: HTMLElement,
    ) => P5SketchInstance;
  };
  const P5 = mod.default;
  return (sketch, node) => new P5(sketch, node);
}

/**
 * Concrete Graph_Renderer. Constructs the five Stem_Renderers up front (the
 * toggle set always covers exactly the five stems, Req 6.3) and runs the draw
 * loop once mounted.
 */
export class GraphRendererImpl implements GraphRenderer {
  private readonly stemRenderers: Map<StemType, BaseStemRenderer> = new Map();
  private readonly timeSource: () => number;
  private coordinateSystem: CoordinateSystem;
  private readonly timeline?: TimelineStream;
  private readonly p5Factory?: P5Factory;

  private p5Instance: P5SketchInstance | null = null;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(options: GraphRendererOptions) {
    this.timeSource = options.timeSource;
    this.coordinateSystem = options.coordinateSystem;
    this.timeline = options.timeline;
    this.p5Factory = options.p5Factory;

    for (const stem of STEM_TYPES) {
      const renderer = new BaseStemRenderer(stem);
      this.stemRenderers.set(stem, renderer);
      // Wire the renderer to its stem's Timeline_Points when a stream is given.
      if (this.timeline) {
        const unsub = this.timeline.subscribe(stem, (point) =>
          renderer.ingest(point),
        );
        this.unsubscribes.push(unsub);
      }
    }
  }

  getStemRenderer(stem: StemType): StemRenderer {
    const renderer = this.stemRenderers.get(stem);
    if (!renderer) {
      // Unreachable: every StemType is constructed above.
      throw new Error(`No Stem_Renderer for stem '${stem}'`);
    }
    return renderer;
  }

  setCoordinateSystem(cs: CoordinateSystem): void {
    // Replace the mapping; the next and all subsequent frames use it (Req 9.6).
    this.coordinateSystem = cs;
  }

  /**
   * Clear every Stem_Renderer's received-point buffer so nothing renders until
   * fresh points arrive (Req 5.10). Used when a new file is loaded; the
   * Timeline_Stream's buffers should be reset in tandem.
   */
  resetStems(): void {
    for (const renderer of this.stemRenderers.values()) {
      renderer.clearPoints();
    }
  }

  /**
   * Compute the playhead x position (canvas pixels) for the current frame by
   * mapping the playback time through the Coordinate_System (Req 5.1, 5.8).
   */
  getPlayheadX(canvasWidth: number): number {
    return this.coordinateSystem.xToCanvas(this.timeSource(), canvasWidth);
  }

  /**
   * Render a single frame onto `p`. Pure with respect to p5 mounting: it clears
   * the canvas, computes the playhead x from the injected time source, and
   * delegates to each Stem_Renderer (each of which gates itself on having
   * points). Safe to call directly from tests with a mock draw target.
   */
  renderFrame(p: P5SketchInstance, canvasWidth: number, canvasHeight: number): void {
    p.background(23, 23, 23);
    const playheadX = this.getPlayheadX(canvasWidth);

    for (const stem of STEM_TYPES) {
      const renderer = this.stemRenderers.get(stem);
      if (!renderer) continue;
      renderer.setCanvasSize(canvasWidth, canvasHeight);
      renderer.draw(p, this.coordinateSystem, playheadX);
    }

    // Draw the playhead indicator line at the synced x position.
    p.push();
    p.stroke(120, 200, 255);
    p.strokeWeight(1);
    p.line(playheadX, 0, playheadX, canvasHeight);
    p.pop();
  }

  /**
   * Mount the single p5 instance into `container` (instance mode) and start the
   * draw loop. Lazily imports p5 when no factory was injected, keeping module
   * import free of DOM/canvas side effects so it loads under jsdom.
   */
  async mount(container: HTMLElement): Promise<void> {
    if (this.p5Instance) return; // single instance only

    const factory = this.p5Factory ?? (await defaultP5Factory());
    const sizeOf = () => {
      const rect = container.getBoundingClientRect?.();
      const width = Math.max(1, Math.floor(rect?.width || container.clientWidth || 800));
      const height = Math.max(1, Math.floor(rect?.height || container.clientHeight || 600));
      return { width, height };
    };

    this.p5Instance = factory((p) => {
      p.setup = () => {
        const { width, height } = sizeOf();
        p.createCanvas(width, height);
      };
      p.draw = () => {
        this.renderFrame(p, p.width, p.height);
      };
    }, container);
  }

  /** Tear down the p5 instance and detach Timeline_Stream subscriptions. */
  destroy(): void {
    for (const unsub of this.unsubscribes.splice(0)) {
      unsub();
    }
    if (this.p5Instance) {
      this.p5Instance.remove();
      this.p5Instance = null;
    }
  }
}

/** Factory for a fresh Graph_Renderer. */
export function createGraphRenderer(
  options: GraphRendererOptions,
): GraphRendererImpl {
  return new GraphRendererImpl(options);
}
