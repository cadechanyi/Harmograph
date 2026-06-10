/**
 * Chords Stem_Renderer — the "stacked_curves" Graph_Style (Req 5.6).
 *
 * The chords stem renders STACKED TRANSLUCENT curves representing the chord
 * segments over time. The ingested Timeline_Points are projected to a base
 * curve, then replicated into several vertically-offset layers drawn with a
 * translucent fill, producing a layered ribbon whose overlap deepens the colour.
 * New points grow every layer to the right (Req 5.7).
 *
 * Design note — pure stacking core: {@link stackedLayerOffsets} computes the
 * per-layer vertical offsets and {@link buildStackedLayers} projects the point
 * buffer into one canvas-space curve per layer; both are pure so the stacking
 * geometry can be verified by task 13.4 without a canvas.
 */

import type { CoordinateSystem } from "../coordinate";
import type { GraphStyle, StemType, TimelinePoint } from "../models";
import type { CurvePoint } from "./MelodyStemRenderer";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/** Default number of stacked curve layers. */
export const DEFAULT_CHORDS_LAYER_COUNT = 3;

/** Default base fill colour (RGB) for each chord layer. */
export const DEFAULT_CHORDS_FILL: readonly [number, number, number] = [
  190, 130, 255,
];

/** Default per-layer fill alpha (0-255) — translucent so overlaps deepen. */
export const DEFAULT_CHORDS_ALPHA = 70;

/**
 * Default total vertical spread of the stack as a fraction of canvas height.
 * Layers are spread symmetrically about each point within this band.
 */
export const DEFAULT_CHORDS_SPREAD_FRACTION = 0.25;

/**
 * Compute the vertical pixel offset of each stacked layer. Offsets are spread
 * symmetrically about `0` across a band of `spreadFraction * height`. A single
 * layer has offset `[0]`. Pure (Req 5.6).
 */
export function stackedLayerOffsets(
  layerCount: number,
  height: number,
  spreadFraction: number = DEFAULT_CHORDS_SPREAD_FRACTION,
): number[] {
  const count = Math.max(1, Math.floor(layerCount));
  if (count === 1) return [0];
  const band = Math.max(0, spreadFraction) * height;
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // Map layer index to [-0.5, 0.5] of the band, centred on 0.
    const frac = i / (count - 1) - 0.5;
    offsets.push(frac * band);
  }
  return offsets;
}

/**
 * Project the point buffer into one canvas-space curve per stacked layer. Layer
 * `k` is the base curve shifted by `offsets[k]` pixels vertically. Pure: returns
 * a new array of arrays and mutates nothing (Req 5.6).
 */
export function buildStackedLayers(
  points: readonly TimelinePoint[],
  cs: CoordinateSystem,
  width: number,
  height: number,
  layerCount: number = DEFAULT_CHORDS_LAYER_COUNT,
  spreadFraction: number = DEFAULT_CHORDS_SPREAD_FRACTION,
): CurvePoint[][] {
  const offsets = stackedLayerOffsets(layerCount, height, spreadFraction);
  const base = points.map((point) => ({
    x: cs.xToCanvas(point.t, width),
    y: cs.yToCanvas(point.value, height),
  }));
  return offsets.map((offset) =>
    base.map((vertex) => ({ x: vertex.x, y: vertex.y + offset })),
  );
}

/** Construction options for the chords renderer. */
export interface ChordsStemRendererOptions {
  /** Number of stacked layers (defaults to {@link DEFAULT_CHORDS_LAYER_COUNT}). */
  layerCount?: number;
  /** Base fill colour as an RGB triple (defaults to {@link DEFAULT_CHORDS_FILL}). */
  fill?: readonly [number, number, number];
  /** Per-layer fill alpha 0-255 (defaults to {@link DEFAULT_CHORDS_ALPHA}). */
  alpha?: number;
  /** Vertical spread fraction (defaults to {@link DEFAULT_CHORDS_SPREAD_FRACTION}). */
  spreadFraction?: number;
}

/**
 * Chords Stem_Renderer: subclass of {@link BaseStemRenderer} overriding
 * {@link ChordsStemRenderer.drawElement} with the stacked-curves style.
 *
 * It inherits the render-gating rule from the base class — {@link BaseStemRenderer.draw}
 * early-returns when disabled or when its received-point buffer is empty, so
 * `drawElement` never runs without points (Req 5.10, 6.5).
 */
export class ChordsStemRenderer extends BaseStemRenderer {
  private readonly layerCount: number;
  private readonly fillColor: readonly [number, number, number];
  private readonly alpha: number;
  private readonly spreadFraction: number;

  constructor(
    stem: StemType = "chords",
    style?: GraphStyle,
    options: ChordsStemRendererOptions = {},
  ) {
    super(stem, style);
    this.layerCount = options.layerCount ?? DEFAULT_CHORDS_LAYER_COUNT;
    this.fillColor = options.fill ?? DEFAULT_CHORDS_FILL;
    this.alpha = options.alpha ?? DEFAULT_CHORDS_ALPHA;
    this.spreadFraction =
      options.spreadFraction ?? DEFAULT_CHORDS_SPREAD_FRACTION;
  }

  /** The number of stacked layers this renderer draws. */
  getLayerCount(): number {
    return this.layerCount;
  }

  /** The current stacked layers in canvas space (exposed for testing). */
  getStackedLayers(cs: CoordinateSystem): CurvePoint[][] {
    return buildStackedLayers(
      this.points,
      cs,
      this.canvasWidth,
      this.canvasHeight,
      this.layerCount,
      this.spreadFraction,
    );
  }

  /**
   * Draw the stacked translucent chord curves for the current frame. Only
   * reached after the base gating check, so the buffer is guaranteed non-empty
   * here (Req 5.10).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const width = this.canvasWidth;
    const height = this.canvasHeight;
    const baseline = height;
    const layers = buildStackedLayers(
      this.points,
      cs,
      width,
      height,
      this.layerCount,
      this.spreadFraction,
    );

    p.push();
    p.noStroke();
    for (const layer of layers) {
      // Translucent fill: overlapping layers accumulate to a deeper colour.
      p.fill(this.fillColor[0], this.fillColor[1], this.fillColor[2], this.alpha);
      p.beginShape();
      p.vertex(layer[0].x, baseline);
      for (const vertex of layer) {
        p.vertex(vertex.x, vertex.y);
      }
      p.vertex(layer[layer.length - 1].x, baseline);
      p.endShape();
    }
    p.pop();
  }
}

/** Factory for a fresh chords Stem_Renderer. */
export function createChordsStemRenderer(
  options?: ChordsStemRendererOptions,
): ChordsStemRenderer {
  return new ChordsStemRenderer("chords", undefined, options);
}
