/**
 * Stem_Renderer — the per-stem drawing unit owned by the Graph_Renderer.
 *
 * Mirrors the design's "Graph_Renderer and Stem_Renderers" interface. Each
 * Stem_Renderer subscribes (conceptually) to one stem's Timeline_Points,
 * accumulates them in a received-point buffer, and draws a graphical element
 * for that stem each frame.
 *
 * This module deliberately keeps the *pure draw-gating logic* separate from any
 * real p5 canvas. Drawing targets a small structural {@link P5DrawTarget}
 * surface rather than a concrete `p5` instance, so the gating behaviour can be
 * exercised under jsdom with a mock that records draw calls (no canvas needed).
 *
 * Render gating (Req 5.10, 6.5): a Stem_Renderer whose received-point buffer is
 * empty — whether never populated, or enabled before any point arrived — draws
 * NO graphical element. The base {@link BaseStemRenderer.draw} early-returns
 * before issuing a single draw call in that case. Disabled stems also draw
 * nothing.
 *
 * Concrete per-stem visual styles (bouncing balls, parametric curve, sine wave,
 * RMS envelope, stacked curves) are implemented in tasks 13.x. The base class
 * here provides a default style draw that simply respects the gating rule and
 * plots the accumulated points; subclasses override {@link BaseStemRenderer.drawElement}.
 */

import type { CoordinateSystem } from "../coordinate";
import { DEFAULT_STYLE, type GraphStyle, type StemType, type TimelinePoint } from "../models";

/**
 * The minimal subset of the p5 drawing API used by the renderers. A real p5
 * instance is structurally assignable to this interface, while tests can supply
 * a lightweight mock that records which methods were called (and how often) to
 * assert the render-gating property without a real canvas.
 */
export interface P5DrawTarget {
  push(): void;
  pop(): void;
  stroke(...args: number[]): void;
  strokeWeight(weight: number): void;
  noStroke(): void;
  fill(...args: number[]): void;
  noFill(): void;
  ellipse(x: number, y: number, w: number, h?: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  beginShape(): void;
  vertex(x: number, y: number): void;
  endShape(...args: unknown[]): void;
}

/**
 * The Stem_Renderer surface consumed by the Graph_Renderer (design interface).
 */
export interface StemRenderer {
  /** The stem this renderer is responsible for. */
  readonly stem: StemType;
  /** Enable or disable rendering of this stem (Req 6.1, 6.2). */
  setEnabled(on: boolean): void;
  /** Select the visual Graph_Style for this stem (Req 7.2, 7.5). */
  setStyle(style: GraphStyle): void;
  /** Accumulate one Timeline_Point for this stem (Req 5.7). */
  ingest(point: TimelinePoint): void;
  /** Draw this stem's element for the current frame (Req 5.2-5.6, 5.10). */
  draw(p: P5DrawTarget, cs: CoordinateSystem, playheadX: number): void;
}

/**
 * Base Stem_Renderer providing point accumulation, enable/style state, and the
 * critical render-gating rule. Concrete stems (task 13.x) extend this and
 * override {@link BaseStemRenderer.drawElement} with their visual style.
 */
export class BaseStemRenderer implements StemRenderer {
  readonly stem: StemType;

  /** Enabled by default on load (Req 6.4). */
  private enabled = true;

  /** Defaults to the per-stem default Graph_Style (Req 7.5, 7.6). */
  private style: GraphStyle;

  /** The received-point buffer for this stem. Empty until a point is ingested. */
  protected readonly points: TimelinePoint[] = [];

  constructor(stem: StemType, style: GraphStyle = DEFAULT_STYLE[stem]) {
    this.stem = stem;
    this.style = style;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setStyle(style: GraphStyle): void {
    this.style = style;
  }

  /** The active Graph_Style for this stem. */
  getStyle(): GraphStyle {
    return this.style;
  }

  /** Whether this stem is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  ingest(point: TimelinePoint): void {
    this.points.push(point);
  }

  /**
   * Discard every received point so the stem renders nothing until new points
   * arrive (Req 5.10). Used when a new file is loaded.
   */
  clearPoints(): void {
    this.points.length = 0;
  }

  /**
   * Whether this renderer has received at least one Timeline_Point. The
   * render-gating rule keys off this: an empty buffer means no element is drawn
   * (Req 5.10, 6.5).
   */
  hasPoints(): boolean {
    return this.points.length > 0;
  }

  /** The number of received points (exposed for testing the gating rule). */
  pointCount(): number {
    return this.points.length;
  }

  /**
   * Draw this stem's element for the current frame.
   *
   * Gating (Req 5.10, 6.5): if the stem is disabled, or its received-point
   * buffer is empty, this returns immediately WITHOUT issuing any draw call —
   * no graphical element is produced. Otherwise it delegates to
   * {@link BaseStemRenderer.drawElement}.
   */
  draw(p: P5DrawTarget, cs: CoordinateSystem, playheadX: number): void {
    if (!this.enabled) return;
    // Render-gating: an empty received-point buffer draws no element.
    if (this.points.length === 0) return;
    this.drawElement(p, cs, playheadX);
  }

  /**
   * Default style draw: plot the accumulated points as a connected polyline
   * mapped through the Coordinate_System. This is intentionally generic — the
   * five concrete visual styles (task 13.x) override this method. It is only
   * reached after the gating check in {@link BaseStemRenderer.draw}, so it never
   * runs for an empty buffer.
   *
   * @param p - The p5 drawing target (real instance or mock).
   * @param cs - The active Coordinate_System for value→canvas mapping.
   * @param playheadX - The current playhead x position in canvas pixels
   *   (currently informational for the default style; concrete styles use it to
   *   scroll/position their elements relative to the playhead).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    p.push();
    p.noFill();
    p.stroke(200, 200, 200);
    p.strokeWeight(1);
    p.beginShape();
    for (const point of this.points) {
      const x = cs.xToCanvas(point.t, width);
      const y = cs.yToCanvas(point.value, height);
      p.vertex(x, y);
    }
    p.endShape();
    p.pop();
  }

  /**
   * Canvas dimensions used by the default draw. The Graph_Renderer updates these
   * each frame via {@link BaseStemRenderer.setCanvasSize}; defaults keep the
   * renderer usable when driven directly in tests.
   */
  protected canvasWidth = 800;
  protected canvasHeight = 600;

  /** Update the canvas dimensions used for coordinate mapping. */
  setCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }
}
