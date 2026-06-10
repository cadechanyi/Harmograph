"use client";

/**
 * CoordinateUnitPicker — selects the y-axis unit mapping for the
 * Coordinate_System: normalized | Hz | MIDI | dB (Req 9.3, 9.4).
 *
 * The Coordinate_System mapping itself lands in task 9; this control only
 * holds and reports the selected unit.
 */
import type { YUnit } from "@/models";

const UNIT_LABELS: Record<YUnit, string> = {
  normalized: "Normalized [-1, 1]",
  hz: "Hz [20, 20000]",
  midi: "MIDI [0, 127]",
  db: "dB [-60, 0]",
};

export const Y_UNITS: readonly YUnit[] = ["normalized", "hz", "midi", "db"];

export interface CoordinateUnitPickerProps {
  unit: YUnit;
  onSelect: (unit: YUnit) => void;
}

export function CoordinateUnitPicker({
  unit,
  onSelect,
}: CoordinateUnitPickerProps) {
  return (
    <section
      className="pointer-events-auto rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Y-axis unit"
    >
      <label className="flex items-center justify-between gap-2">
        <span className="font-medium">Y-axis unit</span>
        <select
          className="bg-white/10 text-xs"
          value={unit}
          onChange={(e) => onSelect(e.target.value as YUnit)}
          aria-label="Y-axis unit"
          data-testid="coordinate-unit-picker"
        >
          {Y_UNITS.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
