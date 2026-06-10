/**
 * Melody Stem_Renderer — the "parametric_curve" Graph_Style (Req 5.3).
 *
 * The melody stem renders a CONTINUOUS parametric curve whose vertical value
 * represents melody pitch frequency. Each ingested Timeline_Point becomes one
 * vertex of a connected polyline drawn with `beginShape`/`vertex`/`endShape`,
 * mapped from data space to canvas space through the {@link CoordinateSystem}.
 * As new points are ingested (Req 5.7) the curve grows to the right, so the
 * animation simply tracks the accumulated buffer.
 *
 * Design note — pure mapping core: the data→canvas projection is factored into
 * the pure {@link buildCurvePoints} helper so it can be exercised directly by
 * task 13.4 without a p5 canvas. The class wires that helper to the
 * {@link P5DrawTarget} surface.
 */

import type { CoordinateSystem } from "../coordinate";
import type { GraphStyle, StemType, TimelinePoint } from "../models";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/** A 2D point in canvas pixel space (top-left origin). */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Default stroke colour (RGB) for the melody parametric curve. */
export const DEFAULT_MELODY_STROKE: readonly [number, number, number] = [
  120, 230, 140,
];

/** Default stroke weight in canvas pixels for the melody curve. */
export const DEFAULT_MELODY_STROKE_WEIGHT = 2;

/**
 * Project a buffer of Timeline_Points into canvas-space curve vertices. Each
 * point's `t` maps to x and `value` (melody pitch frequency, normalized) maps to
 * y via the Coordinate_System (Req 5.3). Pure: allocates and returns a new array
 * and mutates nothing, so it is directly testable without a canvas.
 */
export function buildCurvePoints(
  points: readonly TimelinePoint[],
  cs: CoordinateSystem,
  width: number,
  height: number,
): CurvePoint[] {
  return points.map((point) => ({
    x: cs.xToCanvas(point.t, width),
    y: cs.yToCanvas(point.value, height),
  }));
}

/** Construction options for the melody renderer. */
export interface MelodyStemRendererOptions {
  /** Stroke colour as an RGB triple (defaults to {@link DEFAULT_MELODY_STROKE}). */
  stroke?: readonly [number, number, number];
  /** Stroke weight in canvas pixels (defaults to {@link DEFAULT_MELODY_STROKE_WEIGHT}). */
  strokeWeight?: number;
}

/**
 * Melody Stem_Renderer: subclass of {@link BaseStemRenderer} overriding
 * {@link MelodyStemRenderer.drawElement} with the parametric-curve style.
 *
 * It inherits the render-gating rule from the base class — {@link BaseStemRenderer.draw}
 * early-returns when disabled or when its received-point buffer is empty, so
 * `drawElement` (and thus any `vertex` call) never runs without points
 * (Req 5.10, 6.5).
 */
export class MelodyStemRenderer extends BaseStemRenderer {
  private readonly strokeColor: readonly [number, number, number];
  private readonly weight: number;

  constructor(
    stem: StemType = "melody",
    style?: GraphStyle,
    options: MelodyStemRendererOptions = {},
  ) {
    super(stem, style);
    this.strokeColor = options.stroke ?? DEFAULT_MELODY_STROKE;
    this.weight = options.strokeWeight ?? DEFAULT_MELODY_STROKE_WEIGHT;
  }

  /**
   * The current curve vertices in canvas space (exposed for inspection/testing).
   * Empty until at least one Timeline_Point has been ingested.
   */
  getCurvePoints(cs: CoordinateSystem): CurvePoint[] {
    return buildCurvePoints(
      this.points,
      cs,
      this.canvasWidth,
      this.canvasHeight,
    );
  }

  /**
   * Draw the parametric melody curve for the current frame. Only reached after
   * the base gating check, so the buffer is guaranteed non-empty here (Req 5.10).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const curve = buildCurvePoints(
      this.points,
      cs,
      this.canvasWidth,
      this.canvasHeight,
    );
    p.push();
    p.noFill();
    p.stroke(this.strokeColor[0], this.strokeColor[1], this.strokeColor[2]);
    p.strokeWeight(this.weight);
    p.beginShape();
    for (const vertex of curve) {
      p.vertex(vertex.x, vertex.y);
    }
    p.endShape();
    p.pop();
  }
}

/** Factory for a fresh melody Stem_Renderer. */
export function createMelodyStemRenderer(
  options?: MelodyStemRendererOptions,
): MelodyStemRenderer {
  return new MelodyStemRenderer("melody", undefined, options);
}
