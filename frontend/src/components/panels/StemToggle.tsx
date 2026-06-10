"use client";

/**
 * StemToggle — enables or disables rendering of a single stem (Req 6.1, 6.2).
 */
import type { StemType } from "@/models";

export interface StemToggleProps {
  stem: StemType;
  enabled: boolean;
  onToggle: (stem: StemType) => void;
}

export function StemToggle({ stem, enabled, onToggle }: StemToggleProps) {
  return (
    <label
      className="pointer-events-auto flex items-center gap-2 capitalize"
      data-testid="stem-toggle"
      data-stem={stem}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={() => onToggle(stem)}
        aria-label={`Toggle ${stem}`}
      />
      {stem}
    </label>
  );
}
