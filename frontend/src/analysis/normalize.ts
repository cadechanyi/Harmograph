/**
 * Per-feature normalization into the shared `[-1, 1]` value range (Req 3.4,
 * 10.1). Each raw feature has a natural measurement domain (e.g. RMS in
 * `[0, 1]`, melody pitch in Hz); `normalizeToBipolar` maps that domain onto
 * `[-1, 1]` with clamping so the resulting Timeline_Point is always valid and
 * never rejected by the Timeline_Stream.
 */

import type { StemType } from "../models/types";

/** A raw measurement domain `[min, max]` for a feature, in its natural units. */
export type Domain = readonly [min: number, max: number];

/**
 * Default raw domains per stem, used to map raw samples onto `[-1, 1]`:
 *  - drums:  onset strength, `[0, 1]`
 *  - vocals: RMS magnitude, `[0, 1]`
 *  - bass:   low-band energy, `[0, 1]`
 *  - melody: pitch frequency in Hz, `[20, 2000]`
 *  - chords: harmonic strength, `[0, 1]`
 */
export const DEFAULT_DOMAINS: Record<StemType, Domain> = {
  drums: [0, 1],
  vocals: [0, 1],
  bass: [0, 1],
  melody: [20, 2000],
  chords: [0, 1],
};

/** Clamp `x` into `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Map a raw value within `[min, max]` onto the bipolar range `[-1, 1]`, clamping
 * out-of-domain inputs to the nearest bound first. A degenerate domain
 * (`max <= min`) maps everything to `0`. Returns `null` for a non-finite raw
 * value so the caller can skip it rather than emit a malformed point.
 */
export function normalizeToBipolar(raw: number, domain: Domain): number | null {
  if (!Number.isFinite(raw)) return null;
  const [min, max] = domain;
  if (!(max > min)) return 0;
  const unit = clamp((raw - min) / (max - min), 0, 1); // [0, 1]
  return unit * 2 - 1; // [-1, 1]
}
