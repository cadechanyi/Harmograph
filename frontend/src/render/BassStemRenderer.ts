/**
 * Bass Stem_Renderer — the "sine_wave" Graph_Style (Req 5.4).
 *
 * The bass stem renders a sine wave whose AMPLITUDE represents the low-frequency
 * band energy carried by its Timeline_Points. Higher low-band energy => a taller
 * wave; silence => a flat line. The wave is sampled across the full canvas width
 * and animated by advancing its phase each frame, so the wave appears to travel
 * while the amplitude tracks the most recently ingested point (Req 5.7).
 *
 * Design note — pure wave core: amplitude derivation ({@link lowBandEnergy},
 * {@link amplitudeForEnergy}) and the wave shape ({@link sineWaveSample}) are
 * pure functions, so the amplitude↔energy relationship can be verified directly
 * by task 13.4 without a canvas.
 */

import type { CoordinateSystem } from "../coordinate";
import type { GraphStyle, StemType, TimelinePoint } from "../models";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/** Default stroke colour (RGB) for the bass sine wave. */
export const DEFAULT_BASS_STROKE: readonly [number, number, number] = [
  90, 150, 255,
];

/** Default stroke weight in canvas pixels for the bass wave. */
export const DEFAULT_BASS_STROKE_WEIGHT = 2;

/** Default number of full sine cycles drawn across the canvas width. */
export const DEFAULT_BASS_CYCLES = 4;

/** Default fraction of half the canvas height used at full (unit) energy. */
export const DEFAULT_BASS_AMPLITUDE_FRACTION = 0.4;

/** Default phase advance per frame in radians (animation speed). */
export const DEFAULT_BASS_PHASE_STEP = 0.15;

/** Default horizontal sampling step in canvas pixels for the wave polyline. */
export const DEFAULT_BASS_SAMPLE_STEP = 4;

/**
 * The low-frequency band energy represented by the most recent Timeline_Point,
 * as a magnitude in `[0, 1]` (the normalized `value`'s absolute value). An empty
 * buffer yields `0` (silence => flat wave). Pure (Req 5.4).
 */
export function lowBandEnergy(points: readonly TimelinePoint[]): number {
  if (points.length === 0) return 0;
  const v = points[points.length - 1].value;
  if (!Number.isFinite(v)) return 0;
  const mag = Math.abs(v);
  return mag > 1 ? 1 : mag;
}

/**
 * Map a low-band energy in `[0, 1]` to a wave amplitude in canvas pixels. The
 * amplitude is `energy * fraction * (height / 2)`, so it is strictly increasing
 * in energy and zero at silence — the wave's amplitude represents the low-band
 * energy (Req 5.4). Pure.
 */
export function amplitudeForEnergy(
  energy: number,
  height: number,
  fraction: number = DEFAULT_BASS_AMPLITUDE_FRACTION,
): number {
  const e = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0;
  return e * fraction * (height / 2);
}

/**
 * Sample the sine wave at canvas x `x`. The wave oscillates around `centerY`
 * with the given pixel `amplitude`, completing `cycles` full periods across
 * `width`, offset by `phase` radians. Pure.
 */
export function sineWaveSample(
  x: number,
  width: number,
  amplitude: number,
  centerY: number,
  cycles: number = DEFAULT_BASS_CYCLES,
  phase = 0,
): number {
  const safeWidth = width > 0 ? width : 1;
  const theta = (x / safeWidth) * cycles * 2 * Math.PI + phase;
  return centerY - amplitude * Math.sin(theta);
}

/** Construction options for the bass renderer. */
export interface BassStemRendererOptions {
  stroke?: readonly [number, number, number];
  strokeWeight?: number;
  /** Number of full sine cycles across the width (defaults to {@link DEFAULT_BASS_CYCLES}). */
  cycles?: number;
  /** Half-height fraction used at unit energy (defaults to {@link DEFAULT_BASS_AMPLITUDE_FRACTION}). */
  amplitudeFraction?: number;
  /** Radians of phase advance per frame (defaults to {@link DEFAULT_BASS_PHASE_STEP}). */
  phaseStep?: number;
  /** Horizontal sample step in px (defaults to {@link DEFAULT_BASS_SAMPLE_STEP}). */
  sampleStep?: number;
}

/**
 * Bass Stem_Renderer: subclass of {@link BaseStemRenderer} overriding
 * {@link BassStemRenderer.drawElement} with the sine-wave style.
 *
 * It inherits the render-gating rule from the base class — {@link BaseStemRenderer.draw}
 * early-returns when disabled or when its received-point buffer is empty, so
 * `drawElement` never runs without points (Req 5.10, 6.5).
 */
export class BassStemRenderer extends BaseStemRenderer {
  private readonly strokeColor: readonly [number, number, number];
  private readonly weight: number;
  private readonly cycles: number;
  private readonly amplitudeFraction: number;
  private readonly phaseStep: number;
  private readonly sampleStep: number;

  /** Animated phase in radians, advanced once per drawn frame. */
  private phase = 0;

  /** The amplitude (px) used on the most recent draw (exposed for testing). */
  private amplitude = 0;

  constructor(
    stem: StemType = "bass",
    style?: GraphStyle,
    options: BassStemRendererOptions = {},
  ) {
    super(stem, style);
    this.strokeColor = options.stroke ?? DEFAULT_BASS_STROKE;
    this.weight = options.strokeWeight ?? DEFAULT_BASS_STROKE_WEIGHT;
    this.cycles = options.cycles ?? DEFAULT_BASS_CYCLES;
    this.amplitudeFraction =
      options.amplitudeFraction ?? DEFAULT_BASS_AMPLITUDE_FRACTION;
    this.phaseStep = options.phaseStep ?? DEFAULT_BASS_PHASE_STEP;
    this.sampleStep = options.sampleStep ?? DEFAULT_BASS_SAMPLE_STEP;
  }

  /** The wave amplitude in px used on the most recent draw. */
  getAmplitude(): number {
    return this.amplitude;
  }

  /** The current animation phase in radians. */
  getPhase(): number {
    return this.phase;
  }

  /**
   * Draw the bass sine wave for the current frame. Only reached after the base
   * gating check, so the buffer is guaranteed non-empty here (Req 5.10).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const width = this.canvasWidth;
    const height = this.canvasHeight;

    // Amplitude tracks the low-frequency band energy of the latest point.
    const energy = lowBandEnergy(this.points);
    this.amplitude = amplitudeForEnergy(
      energy,
      height,
      this.amplitudeFraction,
    );

    // Oscillate around the canvas y of value 0 in the active y-range.
    const centerY = cs.yToCanvas(0, height);

    p.push();
    p.noFill();
    p.stroke(this.strokeColor[0], this.strokeColor[1], this.strokeColor[2]);
    p.strokeWeight(this.weight);
    p.beginShape();
    const step = this.sampleStep > 0 ? this.sampleStep : 1;
    for (let x = 0; x <= width; x += step) {
      const y = sineWaveSample(
        x,
        width,
        this.amplitude,
        centerY,
        this.cycles,
        this.phase,
      );
      p.vertex(x, y);
    }
    p.endShape();
    p.pop();

    // Advance the animation phase for the next frame (Req 5.7).
    this.phase += this.phaseStep;
  }
}

/** Factory for a fresh bass Stem_Renderer. */
export function createBassStemRenderer(
  options?: BassStemRendererOptions,
): BassStemRenderer {
  return new BassStemRenderer("bass", undefined, options);
}
