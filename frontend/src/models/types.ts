/**
 * Core data-model types and constants for the Harmograph Frontend.
 *
 * Mirrors the design's "Data Models" section. These types form the single
 * normalized data model that lets any Stem_Renderer consume any stem through
 * one consistent interface (Req 10).
 */

/**
 * The five enumerated stem identifiers rendered by the app (Req 10.2).
 */
export type StemType = "drums" | "melody" | "bass" | "vocals" | "chords";

/**
 * Canonical ordering of the five Stem_Types. The UI presents exactly one
 * control per entry (Req 6.3).
 */
export const STEM_TYPES: readonly StemType[] = [
  "drums",
  "melody",
  "bass",
  "vocals",
  "chords",
] as const;

/**
 * Selectable y-axis unit mappings for the Coordinate_System (Req 9.3, 9.4).
 */
export type YUnit = "normalized" | "hz" | "midi" | "db";

/**
 * The four stems produced by the Demucs_Service stem separation model.
 * Note `chords` is NOT a Demucs stem — it is derived from harmonic analysis
 * (Req 4.10).
 */
export type DemucsStem = "drums" | "bass" | "vocals" | "other";

/**
 * A single normalized data element on the Timeline_Stream (Req 10.1).
 */
export interface TimelinePoint {
  /** Time in seconds, in `[0, songDuration]`. */
  t: number;
  /** Value normalized to `[-1, 1]`. */
  value: number;
  /** The stem this point belongs to. */
  stem: StemType;
}

/**
 * The twelve chromatic pitch classes used for the key tonic readout (Req 8.3).
 */
export type PitchClass =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

/**
 * The selectable visual representations for stems. The MVP defines exactly one
 * default style per stem (Req 7.6).
 */
export type GraphStyle =
  | "bouncing_balls" // drums
  | "parametric_curve" // melody
  | "sine_wave" // bass
  | "rms_envelope" // vocals
  | "stacked_curves"; // chords

/**
 * Stem routing map: Demucs `other` maps to `melody`; chords are NOT produced by
 * separation (Req 4.9, 4.10).
 */
export const DEMUCS_TO_STEM: Record<DemucsStem, StemType> = {
  drums: "drums",
  bass: "bass",
  vocals: "vocals",
  other: "melody",
};

/**
 * The single default Graph_Style per Stem_Type for the MVP, matching the
 * design's Default Graph Styles table (Req 7.6).
 */
export const DEFAULT_STYLE: Record<StemType, GraphStyle> = {
  drums: "bouncing_balls", // Req 5.2, 5.9
  melody: "parametric_curve", // Req 5.3
  bass: "sine_wave", // Req 5.4
  vocals: "rms_envelope", // Req 5.5
  chords: "stacked_curves", // Req 5.6
};

/**
 * Per-stem UI configuration. Enabled defaults to true on load (Req 6.4); style
 * defaults per `DEFAULT_STYLE` (Req 7.5).
 */
export interface StemConfig {
  enabled: boolean;
  style: GraphStyle;
}

/**
 * The full per-stem configuration map — exactly five entries, one per
 * Stem_Type (Req 6.3).
 */
export type StemConfigMap = Record<StemType, StemConfig>;
