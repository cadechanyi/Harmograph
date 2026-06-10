/**
 * Vocals Stem_Renderer — the "rms_envelope" Graph_Style (Req 5.5).
 *
 * The vocals stem renders an RMS envelope that INCREASES in vertical value as
 * vocal presence (RMS) increases. Each Timeline_Point's `value` (the normalized
 * RMS / vocal presence) maps to a vertical envelope position via the
 * {@link CoordinateSystem}; because the canvas uses a top-left origin, a larger
 * value yields a SMALLER canvas y (drawn higher up). The envelope is filled
 * translucently from a baseline up to the curve so the rising/falling presence
 * reads as a silhouette. New points grow the envelope to the right (Req 5.7).
 *
 * Design note — pure mapping core: {@link buildEnvelopePoints} projects the
 * point buffer to canvas-space envelope vertices, and {@link envelopeY} maps a
 * single value; both are pure and verify the monotonic "higher RMS => higher"
 * relationship for task 13.4 without a canvas.
 */

import type { CoordinateSystem } from "../coordinate";
import type { GraphStyle, StemType, TimelinePoint } from "../models";
import type { CurvePoint } from "./MelodyStemRenderer";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/** Default stroke colour (RGB) for the vocals envelope outline. */
export const DEFAULT_VOCALS_STROKE: readonly [number, number, number] = [
  255, 170, 90,
];

/** Default translucent fill colour (RGBA) for the vocals envelope body. */
export const DEFAULT_VOCALS_FILL: readonly [number, number, number, number] = [
  255, 170, 90, 80,
];

/** Default stroke weight in canvas pixels for the envelope outline. */
export const DEFAULT_VOCALS_STROKE_WEIGHT = 2;

/**
 * Map a single vocal-presence `value` to its envelope canvas y. Delegates to the
 * Coordinate_System, which (top-left origin) returns a SMALLER y for a LARGER
 * value — i.e. the envelope rises as vocal presence increases (Req 5.5). Pure.
 */
export function envelopeY(
  value: number,
  cs: CoordinateSystem,
  height: number,
): number {
  return cs.yToCanvas(value, height);
}

/**
 * Project a buffer of Timeline_Points into canvas-space envelope vertices. Each
 * point's `t` maps to x and `value` (vocal presence) maps to y via {@link envelopeY}.
 * Pure: returns a new array and mutates nothing (Req 5.5).
 */
export function buildEnvelopePoints(
  points: readonly TimelinePoint[],
  cs: CoordinateSystem,
  width: number,
  height: number,
): CurvePoint[] {
  return points.map((point) => ({
    x: cs.xToCanvas(point.t, width),
    y: envelopeY(point.value, cs, height),
  }));
}

/** Construction options for the vocals renderer. */
export interface VocalsStemRendererOptions {
  stroke?: readonly [number, number, number];
  fill?: readonly [number, number, number, number];
  strokeWeight?: number;
}

/**
 * Vocals Stem_Renderer: subclass of {@link BaseStemRenderer} overriding
 * {@link VocalsStemRenderer.drawElement} with the RMS-envelope style.
 *
 * It inherits the render-gating rule from the base class — {@link BaseStemRenderer.draw}
 * early-returns when disabled or when its received-point buffer is empty, so
 * `drawElement` never runs without points (Req 5.10, 6.5).
 */
export class VocalsStemRenderer extends BaseStemRenderer {
  private readonly strokeColor: readonly [number, number, number];
  private readonly fillColor: readonly [number, number, number, number];
  private readonly weight: number;

  constructor(
    stem: StemType = "vocals",
    style?: GraphStyle,
    options: VocalsStemRendererOptions = {},
  ) {
    super(stem, style);
    this.strokeColor = options.stroke ?? DEFAULT_VOCALS_STROKE;
    this.fillColor = options.fill ?? DEFAULT_VOCALS_FILL;
    this.weight = options.strokeWeight ?? DEFAULT_VOCALS_STROKE_WEIGHT;
  }

  /** The current envelope vertices in canvas space (exposed for testing). */
  getEnvelopePoints(cs: CoordinateSystem): CurvePoint[] {
    return buildEnvelopePoints(
      this.points,
      cs,
      this.canvasWidth,
      this.canvasHeight,
    );
  }

  /**
   * Draw the vocals RMS envelope for the current frame. Only reached after the
   * base gating check, so the buffer is guaranteed non-empty here (Req 5.10).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    const envelope = buildEnvelopePoints(this.points, cs, width, height);

    // Baseline is the bottom of the canvas; the filled body rises toward the
    // curve as vocal presence increases.
    const baseline = height;
    const firstX = envelope[0].x;
    const lastX = envelope[envelope.length - 1].x;

    p.push();
    // Translucent filled body (stacked silhouette).
    p.noStroke();
    p.fill(
      this.fillColor[0],
      this.fillColor[1],
      this.fillColor[2],
      this.fillColor[3],
    );
    p.beginShape();
    p.vertex(firstX, baseline);
    for (const point of envelope) {
      p.vertex(point.x, point.y);
    }
    p.vertex(lastX, baseline);
    p.endShape();

    // Envelope outline on top.
    p.noFill();
    p.stroke(this.strokeColor[0], this.strokeColor[1], this.strokeColor[2]);
    p.strokeWeight(this.weight);
    p.beginShape();
    for (const point of envelope) {
      p.vertex(point.x, point.y);
    }
    p.endShape();
    p.pop();
  }
}

/** Factory for a fresh vocals Stem_Renderer. */
export function createVocalsStemRenderer(
  options?: VocalsStemRendererOptions,
): VocalsStemRenderer {
  return new VocalsStemRenderer("vocals", undefined, options);
}
