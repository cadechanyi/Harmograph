/**
 * Pure formatting logic for the Tempo and Key readout (Req 8.1-8.5).
 *
 * These functions hold every display decision the {@link TempoKeyReadout}
 * component renders, extracted as side-effect-free pure functions so they can
 * be exercised directly by example and property tests (Properties 15 and 16).
 *
 *  - {@link formatTempo} — plausibility + rounding for the tempo readout.
 *  - {@link formatKey}   — tonic/mode formatting for the key readout.
 *
 * Tempo and key are formatted independently: an absent or invalid key never
 * affects the tempo readout, so a displayed tempo is retained when the key
 * falls back to its placeholder (Req 8.4).
 */
import type { PitchClass } from "@/models";
import type { KeyEstimate } from "@/stores";

/** Indicator shown while an estimate is still pending (Req 8.5). */
export const PENDING_INDICATOR = "…";

/** Placeholder shown when the tempo could not be determined (Req 8.2). */
export const TEMPO_PLACEHOLDER = "could not be determined";

/** Placeholder shown when the key could not be determined (Req 8.4). */
export const KEY_PLACEHOLDER = "could not be determined";

/** The twelve chromatic pitch classes accepted as a key tonic (Req 8.3). */
export const VALID_PITCH_CLASSES: readonly PitchClass[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/** The two musical modes accepted for a key (Req 8.3). */
export const VALID_MODES: readonly KeyEstimate["mode"][] = ["major", "minor"];

/**
 * Format the tempo readout text (Req 8.1, 8.2, 8.5).
 *
 * @param tempoBpm The estimated tempo in beats per minute, or `null`.
 * @param pending  Whether the tempo estimate is still pending.
 * @param range    The inclusive plausible tempo range, defaulting to [40, 250].
 * @returns
 *  - the {@link PENDING_INDICATOR} when `pending` is true (Req 8.5);
 *  - otherwise the tempo rounded to the nearest integer BPM when it is a finite
 *    number within `range` inclusive (Req 8.1);
 *  - otherwise the {@link TEMPO_PLACEHOLDER} (Req 8.2).
 */
export function formatTempo(
  tempoBpm: number | null,
  pending: boolean,
  range: [number, number] = [40, 250],
): string {
  if (pending) return PENDING_INDICATOR;

  const [min, max] = range;
  if (
    tempoBpm !== null &&
    Number.isFinite(tempoBpm) &&
    tempoBpm >= min &&
    tempoBpm <= max
  ) {
    return `${Math.round(tempoBpm)} BPM`;
  }

  return TEMPO_PLACEHOLDER;
}

/**
 * Format the key readout text (Req 8.3, 8.4, 8.5).
 *
 * Formatted independently of the tempo so an absent or invalid key never clears
 * a displayed tempo (Req 8.4).
 *
 * @param key     The estimated key, or `null` when it could not be determined.
 * @param pending Whether the key estimate is still pending.
 * @returns
 *  - the {@link PENDING_INDICATOR} when `pending` is true (Req 8.5);
 *  - otherwise `"{tonic} {mode}"` when `key` is a valid pitch class + mode pair
 *    (Req 8.3);
 *  - otherwise the {@link KEY_PLACEHOLDER} (Req 8.4).
 */
export function formatKey(
  key: { tonic: PitchClass; mode: "major" | "minor" } | null,
  pending: boolean,
): string {
  if (pending) return PENDING_INDICATOR;

  if (
    key !== null &&
    VALID_PITCH_CLASSES.includes(key.tonic) &&
    VALID_MODES.includes(key.mode)
  ) {
    return `${key.tonic} ${key.mode}`;
  }

  return KEY_PLACEHOLDER;
}
