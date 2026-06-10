"use client";

/**
 * GraphStylePicker — selects the Graph_Style for one stem (Req 7.1, 7.2, 7.3, 7.4).
 *
 * For the MVP each stem defines exactly one Graph_Style (Req 7.6). The picker
 * lists every defined style for the stem (Req 7.3) and shows a style as
 * disabled and non-selectable while its required analysis data has not yet
 * been produced (Req 7.4). For the MVP, a style's required data is that stem's
 * own Timeline_Points, so a style becomes selectable once the stem has at least
 * one point on the Timeline_Stream.
 */
import { DEFAULT_STYLE, type GraphStyle, type StemType } from "@/models";

export interface GraphStylePickerProps {
  stem: StemType;
  /** The stem's currently active Graph_Style. */
  style: GraphStyle;
  /** Whether the stem has Timeline_Points available (data produced) (Req 7.4). */
  hasData: boolean;
  onSelect: (stem: StemType, style: GraphStyle) => void;
}

export interface StyleOption {
  style: GraphStyle;
  /** Whether this style's required analysis data has been produced (Req 7.4). */
  available: boolean;
}

/** Styles defined for a stem. MVP: one default style per stem (Req 7.6). */
export function availableStyles(stem: StemType): GraphStyle[] {
  return [DEFAULT_STYLE[stem]];
}

/**
 * Build the selectable options for a stem's picker. Every defined style is
 * listed (Req 7.3); a style is `available` (selectable) only once the stem's
 * required analysis data exists (Req 7.4). For the MVP that data is the stem's
 * own Timeline_Points.
 */
export function styleOptions(stem: StemType, hasData: boolean): StyleOption[] {
  return availableStyles(stem).map((style) => ({ style, available: hasData }));
}

/**
 * Resolve the active style for a stem: the user's explicit selection, or the
 * stem's table default when none has been selected (Req 7.5, 7.6).
 */
export function resolveStyle(stem: StemType, selected?: GraphStyle): GraphStyle {
  return selected ?? DEFAULT_STYLE[stem];
}

export function GraphStylePicker({
  stem,
  style,
  hasData,
  onSelect,
}: GraphStylePickerProps) {
  const options = styleOptions(stem, hasData);
  const noneSelectable = options.every((opt) => !opt.available);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as GraphStyle;
    const option = options.find((opt) => opt.style === next);
    // Never apply a style whose required data is unavailable (Req 7.4).
    if (!option || !option.available) return;
    onSelect(stem, next);
  };

  return (
    <label
      className="pointer-events-auto flex items-center justify-between gap-2 capitalize"
      data-testid="graph-style-picker"
      data-stem={stem}
    >
      <span>{stem}</span>
      <select
        className="bg-white/10 text-xs disabled:opacity-50"
        value={style}
        onChange={handleChange}
        disabled={noneSelectable}
        aria-label={`Graph style for ${stem}`}
      >
        {options.map(({ style: opt, available }) => (
          <option key={opt} value={opt} disabled={!available}>
            {opt.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
